import ipaddr from "ipaddr.js";
import { and, eq, isNull } from "drizzle-orm";
import { verificationInstructions } from "@accessibility/contracts";
import { sites, type Database } from "@accessibility/db";
import type { Logger } from "../audit/run-audit.js";
import { followRedirects } from "../security/redirects.js";
import { readCapped, type FetchLike } from "../security/robots.js";
import { UrlNotAllowedError, type UrlGuard } from "../security/ssrf.js";

export type VerifyOutcome = "verified" | "not_verified" | "skipped";

export interface VerifySiteDeps {
  db: Database;
  // TXT records of a name, one array of chunks per record (node:dns shape).
  resolveTxt: (name: string) => Promise<string[][]>;
  fetch: FetchLike;
  // Checked before every request, redirects included (anti-SSRF).
  guard: UrlGuard;
  userAgent: string;
  timeoutMs?: number;
  log: Logger;
}

const DEFAULT_TIMEOUT_MS = 10_000;
// The proof is a short line: anything longer is not it, and a hostile site
// must not be able to make us read a large body.
const MAX_FILE_BYTES = 4096;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function hasDnsProof(
  deps: VerifySiteDeps,
  hostname: string,
  name: string,
  proof: string,
): Promise<boolean> {
  // A TXT record cannot be set on an IP address: only the file applies.
  if (ipaddr.isValid(hostname.replace(/^\[|\]$/g, ""))) return false;
  try {
    const records = await deps.resolveTxt(name);
    // A long value is split into chunks that must be joined back.
    return records.some((chunks) => chunks.join("").trim() === proof);
  } catch (error) {
    deps.log.info(`verify ${name}: no TXT record (${errorMessage(error)})`);
    return false;
  }
}

async function hasFileProof(
  deps: VerifySiteDeps,
  origin: string,
  path: string,
  proof: string,
): Promise<boolean> {
  // Controlling another host proves nothing about this one: the chain may
  // never leave the site's origin, whatever it points at.
  const guard: UrlGuard = async (url) => {
    if (new URL(url).origin !== origin) {
      throw new UrlNotAllowedError(url, "is outside the site being verified");
    }
    await deps.guard(url);
  };
  try {
    const { hop } = await followRedirects(
      new URL(path, origin).href,
      async (url) => {
        const response = await deps.fetch(url, {
          redirect: "manual",
          headers: { "user-agent": deps.userAgent },
          signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
        });
        return {
          status: response.status,
          location: response.headers.get("location"),
          value: response,
        };
      },
      guard,
    );
    if (hop.status < 200 || hop.status >= 300) return false;
    return (await readCapped(hop.value, MAX_FILE_BYTES)).trim() === proof;
  } catch (error) {
    deps.log.info(`verify ${origin}: file not usable (${errorMessage(error)})`);
    return false;
  }
}

// Failing to find the proof is an expected answer, not an error: the customer
// fixes their DNS or file and asks again, so nothing here is retried.
export async function verifySite(
  deps: VerifySiteDeps,
  siteId: string,
): Promise<VerifyOutcome> {
  const { db, log } = deps;
  const [site] = await db.select().from(sites).where(eq(sites.id, siteId));
  if (site === undefined) {
    log.warn(`verify ${siteId}: site not found, skipping`);
    return "skipped";
  }
  if (site.verifiedAt !== null || site.verificationToken === null) {
    return "skipped";
  }

  const { dnsRecord, file } = verificationInstructions(
    site.baseUrl,
    site.verificationToken,
  );
  const url = new URL(site.baseUrl);
  const method = (await hasDnsProof(
    deps,
    url.hostname,
    dnsRecord.name,
    dnsRecord.value,
  ))
    ? "dns"
    : (await hasFileProof(deps, url.origin, file.path, file.content))
      ? "file"
      : null;
  if (method === null) {
    log.info(`verify ${siteId}: proof not found`);
    return "not_verified";
  }

  await db
    .update(sites)
    .set({ verifiedAt: new Date(), verificationMethod: method })
    .where(and(eq(sites.id, siteId), isNull(sites.verifiedAt)));
  log.info(`verify ${siteId}: verified by ${method}`);
  return "verified";
}
