import { eq } from "drizzle-orm";
import type { Result } from "axe-core";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  audits,
  auditPages,
  issues,
  pages,
  runMigrations,
  seedRules,
  sites,
} from "@accessibility/db";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { computeScore } from "@accessibility/rules";
import { adminDatabaseUrl } from "../test/integration.js";
import { UrlNotAllowedError } from "../security/ssrf.js";
import { runAudit, type RunAuditDeps } from "./run-audit.js";
import type { Scan, ScanResult } from "./scanner.js";

const adminUrl = adminDatabaseUrl();

function violation(id: string, targets: string[]): Result {
  return {
    id,
    impact: "serious",
    tags: [],
    description: id,
    help: `help ${id}`,
    helpUrl: `https://example.test/${id}`,
    nodes: targets.map((target) => ({
      html: `<x data-t="${target}">`,
      target: [target],
      failureSummary: "fix it",
    })),
  } as unknown as Result;
}

function scanResult(violations: Result[]): ScanResult {
  return {
    violations,
    axeVersion: "4.13.0",
    finalUrl: "https://acme.example/",
    blockedRequests: [],
  };
}

describe.skipIf(adminUrl === undefined)("runAudit", () => {
  let test: TestDatabase;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    await runMigrations(test.db);
    await seedRules(test.db);
  });
  afterAll(async () => {
    await test.close();
  });

  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function createAudit(
    status: "queued" | "running" | "completed" = "queued",
  ) {
    const [site] = await test.db
      .insert(sites)
      .values({ baseUrl: "https://acme.example/" })
      .returning();
    const [audit] = await test.db
      .insert(audits)
      .values({ siteId: site!.id, type: "free", status })
      .returning();
    return { site: site!, audit: audit! };
  }

  function deps(overrides: Partial<RunAuditDeps> = {}): RunAuditDeps {
    return {
      db: test.db,
      scan: vi.fn<Scan>(async () => scanResult([])),
      checkRobots: async () => ({ allowed: true }),
      maxIssues: 100,
      log,
      ...overrides,
    };
  }

  const auditRow = async (id: string) =>
    (await test.db.select().from(audits).where(eq(audits.id, id)))[0]!;

  it("stores the issues, the page and completes the audit", async () => {
    const { audit, site } = await createAudit();
    const scan = vi.fn<Scan>(async () =>
      scanResult([
        violation("image-alt", ["img.a", "img.b"]),
        violation("button-name", ["button"]),
      ]),
    );

    await expect(runAudit(deps({ scan }), audit.id)).resolves.toBe("completed");

    expect(scan).toHaveBeenCalledWith(new URL("https://acme.example/"));
    const done = await auditRow(audit.id);
    expect(done.status).toBe("completed");
    expect(done.pagesScanned).toBe(1);
    expect(done.startedAt).not.toBeNull();
    expect(done.finishedAt).not.toBeNull();
    expect(done.engineVersion).toMatch(/^axe-core@4\.13\.0\+rules@/);
    expect(done.failureReason).toBeNull();
    // Three issues, all 'serious'.
    expect(done.score).toBe(
      computeScore([
        { impact: "serious" },
        { impact: "serious" },
        { impact: "serious" },
      ]),
    );

    const stored = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, audit.id));
    expect(stored.map((i) => `${i.ruleId}:${i.selector}`).sort()).toEqual([
      "button-name:button",
      "image-alt:img.a",
      "image-alt:img.b",
    ]);
    expect(stored.every((i) => /^[0-9a-f]{64}$/.test(i.fingerprint))).toBe(
      true,
    );

    const [page] = await test.db
      .select()
      .from(pages)
      .where(eq(pages.siteId, site.id));
    expect(page?.url).toBe("https://acme.example/");
    expect(page?.lastSeenAt).not.toBeNull();
    const links = await test.db
      .select()
      .from(auditPages)
      .where(eq(auditPages.auditId, audit.id));
    expect(links).toHaveLength(1);
  });

  it("keeps the same fingerprint for the same problem across audits", async () => {
    const first = await createAudit();
    const second = await createAudit();
    const scan = async () => scanResult([violation("image-alt", ["img.a"])]);
    await runAudit(deps({ scan }), first.audit.id);
    await runAudit(deps({ scan }), second.audit.id);
    const [a] = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, first.audit.id));
    const [b] = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, second.audit.id));
    expect(a?.fingerprint).toBe(b?.fingerprint);
  });

  it("fails without scanning when robots.txt forbids the page", async () => {
    const { audit } = await createAudit();
    const scan = vi.fn<Scan>();
    const result = await runAudit(
      deps({
        scan,
        checkRobots: async () => ({
          allowed: false,
          reason: "disallowed by robots.txt",
        }),
      }),
      audit.id,
    );
    expect(result).toBe("failed");
    expect(scan).not.toHaveBeenCalled();
    const row = await auditRow(audit.id);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("robots_disallowed");
    expect(row.score).toBeNull();
    expect(row.finishedAt).not.toBeNull();
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("disallowed by robots.txt"),
    );
  });

  it("fails when the target is forbidden (SSRF)", async () => {
    const { audit } = await createAudit();
    const scan = async (): Promise<ScanResult> => {
      throw new UrlNotAllowedError(
        "http://127.0.0.1/",
        "targets a non-public address",
      );
    };
    await expect(runAudit(deps({ scan }), audit.id)).resolves.toBe("failed");
    const row = await auditRow(audit.id);
    expect(row.status).toBe("failed");
    expect(row.failureReason).toBe("forbidden_url");
  });

  it("scores 100 when the page has no issue", async () => {
    const { audit } = await createAudit();
    await runAudit(deps(), audit.id);
    expect((await auditRow(audit.id)).score).toBe(100);
  });

  it("fails and stores nothing when the scan crashes", async () => {
    const { audit } = await createAudit();
    const scan = async (): Promise<ScanResult> => {
      throw new Error("browser crashed");
    };
    await expect(runAudit(deps({ scan }), audit.id)).resolves.toBe("failed");
    expect((await auditRow(audit.id)).failureReason).toBe("scan_failed");
    expect(log.error).toHaveBeenCalledWith(
      expect.stringContaining("browser crashed"),
    );
    const stored = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, audit.id));
    expect(stored).toEqual([]);
  });

  it("does nothing for an audit that already finished", async () => {
    const { audit } = await createAudit("completed");
    const scan = vi.fn<Scan>();
    await expect(runAudit(deps({ scan }), audit.id)).resolves.toBe("skipped");
    expect(scan).not.toHaveBeenCalled();
  });

  it("re-runs an audit left 'running' by a crashed worker without duplicating issues", async () => {
    const { audit } = await createAudit("running");
    const scan = async () => scanResult([violation("image-alt", ["img.a"])]);
    await runAudit(deps({ scan }), audit.id);
    await test.db
      .update(audits)
      .set({ status: "running" })
      .where(eq(audits.id, audit.id));
    await runAudit(deps({ scan }), audit.id);
    const stored = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, audit.id));
    expect(stored).toHaveLength(1);
  });

  it("rejects an unknown audit id", async () => {
    await expect(
      runAudit(deps(), "00000000-0000-4000-8000-000000000000"),
    ).rejects.toThrow(/not found/i);
  });

  it("warns about rules it cannot store and keeps the others", async () => {
    const { audit } = await createAudit();
    const scan = async () =>
      scanResult([
        violation("rule-from-the-future", ["a"]),
        violation("image-alt", ["img"]),
      ]);
    await expect(runAudit(deps({ scan }), audit.id)).resolves.toBe("completed");
    expect(log.warn).toHaveBeenCalledWith(
      expect.stringContaining("rule-from-the-future"),
    );
    const stored = await test.db
      .select()
      .from(issues)
      .where(eq(issues.auditId, audit.id));
    expect(stored.map((i) => i.ruleId)).toEqual(["image-alt"]);
  });
});
