import { eq } from "drizzle-orm";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runMigrations, seedRules, sites } from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { adminDatabaseUrl } from "../test/integration.js";
import {
  startFixtureServer,
  type FixtureServer,
  type Handler,
} from "../test/fixture-server.js";
import { UrlNotAllowedError } from "../security/ssrf.js";
import { verifySite, type VerifySiteDeps } from "./verify-site.js";

const adminUrl = adminDatabaseUrl();
const TOKEN = "tok_ABC-123";
const PROOF = `clariaccess-verify=${TOKEN}`;
const FILE_PATH = `/.well-known/clariaccess-${TOKEN}.txt`;

describe.skipIf(adminUrl === undefined)("verifySite", () => {
  let test: TestDatabase;
  const servers: FixtureServer[] = [];

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
    await test.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function serve(handler: Handler) {
    const server = await startFixtureServer(handler);
    servers.push(server);
    return server;
  }
  const serveFile = (body: string, status = 200) =>
    serve((req, res) => {
      if (req.url !== FILE_PATH) return false;
      res.writeHead(status, { "content-type": "text/plain" }).end(body);
      return true;
    });

  async function createSite(
    baseUrl: string,
    options: { token?: string | null; verified?: boolean } = {},
  ) {
    const [site] = await test.db
      .insert(sites)
      .values({
        baseUrl,
        verificationToken: options.token === undefined ? TOKEN : options.token,
        verifiedAt: options.verified ? new Date() : null,
        verificationMethod: options.verified ? "dns" : null,
      })
      .returning();
    return site!;
  }
  const siteRow = async (id: string) =>
    (await test.db.select().from(sites).where(eq(sites.id, id)))[0]!;

  function deps(overrides: Partial<VerifySiteDeps> = {}): VerifySiteDeps {
    return {
      db: test.db,
      resolveTxt: vi.fn(async () => []),
      fetch,
      // Loopback fixtures: only tests may open the guard.
      guard: async () => undefined,
      userAgent: "test-bot",
      log,
      ...overrides,
    };
  }

  describe("DNS", () => {
    it("verifies when a TXT record carries the proof", async () => {
      const site = await createSite("https://acme.example");
      const resolveTxt = vi.fn(async () => [["unrelated"], [PROOF]]);

      const outcome = await verifySite(deps({ resolveTxt }), site.id);

      expect(outcome).toBe("verified");
      expect(resolveTxt).toHaveBeenCalledWith("_clariaccess.acme.example");
      const row = await siteRow(site.id);
      expect(row.verificationMethod).toBe("dns");
      expect(row.verifiedAt).toBeInstanceOf(Date);
    });

    it("joins the chunks of a long TXT record", async () => {
      const site = await createSite("https://chunks.example");
      const resolveTxt = vi.fn(async () => [
        [PROOF.slice(0, 10), PROOF.slice(10)],
      ]);

      expect(await verifySite(deps({ resolveTxt }), site.id)).toBe("verified");
    });

    it("does not accept another site's proof", async () => {
      const site = await createSite("https://other.example");
      const resolveTxt = vi.fn(async () => [
        ["clariaccess-verify=someone-else"],
      ]);

      expect(await verifySite(deps({ resolveTxt }), site.id)).toBe(
        "not_verified",
      );
      expect((await siteRow(site.id)).verifiedAt).toBeNull();
    });

    it("falls back to the file when the lookup fails", async () => {
      const server = await serveFile(PROOF);
      const site = await createSite(server.origin);
      const resolveTxt = vi.fn(async () => {
        throw new Error("ENOTFOUND");
      });

      expect(await verifySite(deps({ resolveTxt }), site.id)).toBe("verified");
    });

    it("does not look up DNS for an IP address", async () => {
      const server = await serveFile(PROOF);
      const site = await createSite(server.origin);
      const resolveTxt = vi.fn(async () => []);

      await verifySite(deps({ resolveTxt }), site.id);

      expect(resolveTxt).not.toHaveBeenCalled();
    });
  });

  describe("well-known file", () => {
    it("verifies when the file holds the proof, ignoring surrounding whitespace", async () => {
      const server = await serveFile(`  ${PROOF}\r\n`);
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("verified");
      expect((await siteRow(site.id)).verificationMethod).toBe("file");
    });

    it.each([
      ["a different token", "clariaccess-verify=nope"],
      ["extra content", `${PROOF} and more`],
      ["an empty file", ""],
    ])("does not verify with %s", async (_label, body) => {
      const server = await serveFile(body);
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("not_verified");
    });

    it("does not verify on a 404", async () => {
      const server = await serveFile(PROOF, 404);
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("not_verified");
    });

    it("reads at most a few kilobytes of a hostile response", async () => {
      const server = await serve((req, res) => {
        res.writeHead(200).end(`${PROOF}${"a".repeat(2_000_000)}`);
        return req.url !== undefined;
      });
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("not_verified");
    });

    it("refuses a redirect to another origin, even one that serves the proof", async () => {
      const elsewhere = await serveFile(PROOF);
      const server = await serve((req, res) => {
        res.writeHead(302, { location: `${elsewhere.origin}${req.url}` }).end();
        return true;
      });
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("not_verified");
      expect(elsewhere.hits).toEqual([]);
    });

    it("follows a redirect that stays on the same origin", async () => {
      const server = await serve((req, res) => {
        if (req.url === FILE_PATH) {
          res.writeHead(301, { location: "/proof.txt" }).end();
        } else if (req.url === "/proof.txt") {
          res.writeHead(200).end(PROOF);
        } else {
          res.writeHead(404).end();
        }
        return true;
      });
      const site = await createSite(server.origin);

      expect(await verifySite(deps(), site.id)).toBe("verified");
    });

    it("never requests a URL the guard refuses, and does not throw", async () => {
      const server = await serveFile(PROOF);
      const site = await createSite(server.origin);
      const guard = vi.fn(async (url: string) => {
        throw new UrlNotAllowedError(url, "targets a non-public address");
      });

      expect(await verifySite(deps({ guard }), site.id)).toBe("not_verified");
      expect(guard).toHaveBeenCalled();
      expect(server.hits).toEqual([]);
    });

    it("does not throw when the site is unreachable", async () => {
      const server = await serveFile(PROOF);
      const origin = server.origin;
      await server.close();
      servers.splice(servers.indexOf(server), 1);
      const site = await createSite(origin);

      expect(await verifySite(deps(), site.id)).toBe("not_verified");
    });
  });

  describe("states that are not checked", () => {
    it("leaves an already verified site alone", async () => {
      const site = await createSite("https://done.example", { verified: true });
      const resolveTxt = vi.fn(async () => []);

      expect(await verifySite(deps({ resolveTxt }), site.id)).toBe("skipped");
      expect(resolveTxt).not.toHaveBeenCalled();
      expect((await siteRow(site.id)).verificationMethod).toBe("dns");
    });

    it("skips an anonymous site, which has no token", async () => {
      const site = await createSite("https://anon.example", { token: null });

      expect(await verifySite(deps(), site.id)).toBe("skipped");
    });

    it("skips a site that no longer exists", async () => {
      expect(
        await verifySite(deps(), "00000000-0000-4000-8000-000000000000"),
      ).toBe("skipped");
    });
  });
});
