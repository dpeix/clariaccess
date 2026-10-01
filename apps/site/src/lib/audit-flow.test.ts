import { describe, expect, it } from "vitest";
import {
  POLL_TIMEOUT_MS,
  apiErrorMessage,
  auditProgress,
  impactLabel,
  isAuditId,
  leadErrorMessage,
  normalizeAuditUrl,
  parseUtm,
  pollDelayMs,
  safeHttpUrl,
} from "./audit-flow.js";

const audit = (
  patch: Partial<{
    status: "queued" | "running" | "completed" | "failed";
    failureReason: "forbidden_url" | "robots_disallowed" | "scan_failed" | null;
  }>,
) => ({ status: "queued" as const, failureReason: null, ...patch });

describe("isAuditId", () => {
  it("accepts a uuid and rejects anything else", () => {
    expect(isAuditId("6f1c1c1e-5d3b-4c9e-8a57-0b1f2a3c4d5e")).toBe(true);
    expect(isAuditId("")).toBe(false);
    expect(isAuditId("../../etc/passwd")).toBe(false);
    expect(isAuditId(null)).toBe(false);
  });
});

describe("apiErrorMessage", () => {
  it("explains a rate limit and tells the visitor to retry later", () => {
    expect(apiErrorMessage(429)).toMatch(/trop de demandes/i);
  });

  it("reports an invalid request as an address problem", () => {
    expect(apiErrorMessage(400)).toMatch(/adresse/i);
  });

  it("distinguishes a missing audit", () => {
    expect(apiErrorMessage(404)).toMatch(/introuvable/i);
  });

  it("covers server errors and network failures", () => {
    expect(apiErrorMessage(500)).toMatch(/réessayez/i);
    expect(apiErrorMessage(503)).toMatch(/réessayez/i);
    expect(apiErrorMessage("network")).toMatch(/connexion/i);
  });

  it("falls back for unexpected statuses", () => {
    expect(apiErrorMessage(418).length).toBeGreaterThan(0);
  });
});

describe("pollDelayMs", () => {
  it("backs off and is capped", () => {
    const delays = [0, 1, 2, 3, 10, 100].map(pollDelayMs);

    for (let i = 1; i < delays.length; i += 1) {
      expect(delays[i]).toBeGreaterThanOrEqual(delays[i - 1]!);
    }
    expect(delays[0]).toBeGreaterThanOrEqual(1000);
    expect(Math.max(...delays)).toBeLessThanOrEqual(10_000);
  });

  it("gives up well after the worker's own 60 s audit budget", () => {
    expect(POLL_TIMEOUT_MS).toBeGreaterThan(60_000);
  });
});

describe("auditProgress", () => {
  it("keeps waiting while queued or running", () => {
    expect(auditProgress(audit({ status: "queued" })).phase).toBe("waiting");
    expect(auditProgress(audit({ status: "running" })).phase).toBe("waiting");
  });

  it("is done when completed", () => {
    expect(auditProgress(audit({ status: "completed" })).phase).toBe("done");
  });

  it.each([
    ["forbidden_url", /publiquement/],
    ["robots_disallowed", /robots\.txt/],
    ["scan_failed", /analysée/],
  ] as const)("explains the failure reason %s", (failureReason, pattern) => {
    const progress = auditProgress(audit({ status: "failed", failureReason }));

    expect(progress.phase).toBe("failed");
    expect(progress.message).toMatch(pattern);
  });

  it("has a generic message for an unknown failure", () => {
    const progress = auditProgress(
      audit({ status: "failed", failureReason: null }),
    );

    expect(progress.phase).toBe("failed");
    expect(progress.message.length).toBeGreaterThan(0);
  });
});

describe("parseUtm", () => {
  it("keeps only utm_ parameters", () => {
    expect(
      parseUtm("?utm_source=linkedin&utm_campaign=eaa&id=abc&email=a@b.fr"),
    ).toEqual({ utm_source: "linkedin", utm_campaign: "eaa" });
  });

  it("returns an empty object without parameters", () => {
    expect(parseUtm("")).toEqual({});
  });

  it("bounds the number and length of values", () => {
    const search =
      "?" +
      Array.from({ length: 30 }, (_, i) => `utm_k${i}=${"x".repeat(500)}`).join(
        "&",
      );
    const utm = parseUtm(search);

    expect(Object.keys(utm).length).toBeLessThanOrEqual(10);
    for (const value of Object.values(utm)) {
      expect(value.length).toBeLessThanOrEqual(100);
    }
  });
});

describe("impactLabel", () => {
  it("labels every impact in French", () => {
    expect(impactLabel("critical")).toBe("Critique");
    expect(impactLabel("serious")).toBe("Sérieux");
    expect(impactLabel("moderate")).toBe("Modéré");
    expect(impactLabel("minor")).toBe("Mineur");
  });
});

describe("safeHttpUrl", () => {
  it("keeps http(s) urls", () => {
    expect(safeHttpUrl("https://dequeuniversity.com/rules/axe/x")).toBe(
      "https://dequeuniversity.com/rules/axe/x",
    );
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "not a url", ""])(
    "rejects %j",
    (value) => {
      expect(safeHttpUrl(value)).toBeNull();
    },
  );

  it("passes null through", () => {
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe("normalizeAuditUrl", () => {
  it("assumes https for a bare domain", () => {
    expect(normalizeAuditUrl("monsite.fr")).toBe("https://monsite.fr/");
  });

  it("trims and keeps path, query and an explicit scheme", () => {
    expect(normalizeAuditUrl("  http://monsite.fr/page?x=1 ")).toBe(
      "http://monsite.fr/page?x=1",
    );
  });

  it.each([
    "",
    "   ",
    "pas une url://",
    "monsite .fr",
    "ftp://monsite.fr",
    "javascript:alert(1)",
    "https://",
  ])("rejects %j", (value) => {
    expect(normalizeAuditUrl(value)).toBeNull();
  });
});

describe("leadErrorMessage", () => {
  it("blames the email, not the audited url, on a rejected request", () => {
    const message = leadErrorMessage(400);

    expect(message).toMatch(/email/i);
    expect(message).not.toMatch(/url|http/i);
  });

  it("reuses the generic messages for other failures", () => {
    expect(leadErrorMessage(429)).toBe(apiErrorMessage(429));
    expect(leadErrorMessage(503)).toBe(apiErrorMessage(503));
    expect(leadErrorMessage("network")).toBe(apiErrorMessage("network"));
  });
});
