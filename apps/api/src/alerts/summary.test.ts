import { describe, expect, it } from "vitest";
import { summarizeAlert, type AlertFinding } from "./summary.js";

const finding = (patch: Partial<AlertFinding> = {}): AlertFinding => ({
  ruleId: "image-alt",
  impact: "serious",
  pageUrl: "https://acme.example/",
  message: "Images must have alternate text",
  kind: "regression",
  ...patch,
});

describe("summarizeAlert", () => {
  it("says nothing when nothing is new", () => {
    expect(summarizeAlert({ hasPreviousAudit: true, findings: [] })).toBeNull();
  });

  it("says nothing on the first audit of a site: everything would be new", () => {
    expect(
      summarizeAlert({ hasPreviousAudit: false, findings: [finding()] }),
    ).toBeNull();
  });

  it("counts regressions and new serious problems apart", () => {
    const summary = summarizeAlert({
      hasPreviousAudit: true,
      findings: [
        finding({ kind: "regression" }),
        finding({ kind: "regression", ruleId: "label" }),
        finding({ kind: "new", impact: "critical", ruleId: "button-name" }),
      ],
    });

    expect(summary).toMatchObject({ regressions: 2, newSevere: 1 });
  });

  it("lists the regressions first, then by severity, at most five", () => {
    const summary = summarizeAlert({
      hasPreviousAudit: true,
      findings: [
        finding({ kind: "new", impact: "serious", ruleId: "a-new-serious" }),
        finding({ kind: "new", impact: "critical", ruleId: "a-new-critical" }),
        finding({
          kind: "regression",
          impact: "minor",
          ruleId: "a-regression-minor",
        }),
        finding({
          kind: "regression",
          impact: "critical",
          ruleId: "a-regression-critical",
        }),
        ...Array.from({ length: 6 }, (_, i) =>
          finding({ kind: "new", impact: "serious", ruleId: `filler-${i}` }),
        ),
      ],
    });

    expect(summary?.top).toHaveLength(5);
    expect(summary?.top.slice(0, 4).map((f) => f.ruleId)).toEqual([
      "a-regression-critical",
      "a-regression-minor",
      "a-new-critical",
      "a-new-serious",
    ]);
    expect(summary?.regressions).toBe(2);
    expect(summary?.newSevere).toBe(8);
  });

  it("lists one line per rule and page, with how many elements it covers", () => {
    const summary = summarizeAlert({
      hasPreviousAudit: true,
      findings: [
        ...Array.from({ length: 7 }, (_, i) =>
          finding({
            ruleId: "region",
            pageUrl: "https://acme.example/",
            message: `m${i}`,
          }),
        ),
        finding({ ruleId: "region", pageUrl: "https://acme.example/b" }),
      ],
    });

    expect(summary?.regressions).toBe(8);
    expect(summary?.top).toHaveLength(2);
    expect(summary?.top.map((g) => [g.pageUrl, g.count])).toEqual([
      ["https://acme.example/", 7],
      ["https://acme.example/b", 1],
    ]);
  });

  it("is stable: the same findings in another order give the same list", () => {
    const findings = [
      finding({ ruleId: "b" }),
      finding({ ruleId: "a" }),
      finding({ ruleId: "c" }),
    ];

    const one = summarizeAlert({ hasPreviousAudit: true, findings });
    const two = summarizeAlert({
      hasPreviousAudit: true,
      findings: [...findings].reverse(),
    });

    expect(one?.top.map((f) => f.ruleId)).toEqual(
      two?.top.map((f) => f.ruleId),
    );
  });
});
