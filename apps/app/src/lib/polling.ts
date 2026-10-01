import type { Audit, Site } from "@accessibility/contracts";

export function isAuditActive(status: Audit["status"]): boolean {
  return status === "queued" || status === "running";
}

// Keeps the history fresh while something is running, then stops asking.
export function auditRefetchInterval(
  statuses: Audit["status"][] | undefined,
): number | false {
  return statuses?.some(isAuditActive) ? 3000 : false;
}

// The worker checks DNS and the well-known file within seconds; past this the
// proof is most likely not there (DNS propagation can take longer: the user
// simply tries again).
export const VERIFICATION_TIMEOUT_MS = 30_000;
export const VERIFICATION_POLL_MS = 2000;

export type VerificationState = "verified" | "waiting" | "not_found";

export function verificationState(
  site: Pick<Site, "verifiedAt">,
  elapsedMs: number,
): VerificationState {
  if (site.verifiedAt !== null) return "verified";
  return elapsedMs >= VERIFICATION_TIMEOUT_MS ? "not_found" : "waiting";
}
