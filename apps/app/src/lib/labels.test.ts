import { describe, expect, it } from "vitest";
import {
  AUDIT_STATUSES,
  FINDING_STATUSES,
  IMPACTS,
  AUDIT_PAGE_STATUSES,
  AUDIT_FAILURE_REASONS,
} from "@accessibility/contracts";
import {
  auditStatusLabel,
  failureLabel,
  findingStatusLabel,
  formatDateTime,
  impactLabel,
  pageStatusLabel,
} from "./labels.js";

describe("labels", () => {
  it("has a distinct French label for every enum value", () => {
    for (const [values, label] of [
      [AUDIT_STATUSES, auditStatusLabel],
      [FINDING_STATUSES, findingStatusLabel],
      [IMPACTS, impactLabel],
      [AUDIT_PAGE_STATUSES, pageStatusLabel],
      [AUDIT_FAILURE_REASONS, failureLabel],
    ] as const) {
      const labels = values.map((v) => (label as (x: string) => string)(v));
      expect(new Set(labels).size).toBe(values.length);
      for (const l of labels) expect(l.length).toBeGreaterThan(0);
    }
  });

  it("has a generic message when an audit failed without a reason", () => {
    expect(failureLabel(null).length).toBeGreaterThan(0);
  });

  it("labels a few values as expected", () => {
    expect(findingStatusLabel("regressed")).toBe("Régression");
    expect(auditStatusLabel("completed")).toBe("Terminé");
    expect(impactLabel("critical")).toBe("Critique");
  });
});

describe("formatDateTime", () => {
  it("formats in French, in the given time zone", () => {
    expect(formatDateTime("2026-10-01T10:30:00.000Z", "UTC")).toBe(
      "1 octobre 2026 à 10:30",
    );
  });

  it("shows a dash when there is no date", () => {
    expect(formatDateTime(null)).toBe("—");
  });
});
