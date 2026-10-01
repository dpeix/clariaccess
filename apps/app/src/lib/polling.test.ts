import { describe, expect, it } from "vitest";
import {
  VERIFICATION_TIMEOUT_MS,
  auditRefetchInterval,
  isAuditActive,
  verificationState,
} from "./polling.js";

describe("isAuditActive", () => {
  it("is true while queued or running", () => {
    expect(isAuditActive("queued")).toBe(true);
    expect(isAuditActive("running")).toBe(true);
    expect(isAuditActive("completed")).toBe(false);
    expect(isAuditActive("failed")).toBe(false);
  });
});

describe("auditRefetchInterval", () => {
  it("polls while an audit is active and stops otherwise", () => {
    expect(auditRefetchInterval(["completed", "running"])).toBeGreaterThan(0);
    expect(auditRefetchInterval(["completed", "failed"])).toBe(false);
    expect(auditRefetchInterval([])).toBe(false);
    expect(auditRefetchInterval(undefined)).toBe(false);
  });
});

describe("verificationState", () => {
  const site = (verifiedAt: string | null) => ({ verifiedAt });

  it("is verified as soon as the site has a verification date", () => {
    expect(verificationState(site("2026-10-01T10:00:00.000Z"), 0)).toBe(
      "verified",
    );
    expect(
      verificationState(
        site("2026-10-01T10:00:00.000Z"),
        10 * VERIFICATION_TIMEOUT_MS,
      ),
    ).toBe("verified");
  });

  it("waits while the proof may still be found", () => {
    expect(verificationState(site(null), 0)).toBe("waiting");
    expect(verificationState(site(null), VERIFICATION_TIMEOUT_MS - 1)).toBe(
      "waiting",
    );
  });

  it("gives up after the timeout: the proof was not found", () => {
    expect(verificationState(site(null), VERIFICATION_TIMEOUT_MS)).toBe(
      "not_found",
    );
  });
});
