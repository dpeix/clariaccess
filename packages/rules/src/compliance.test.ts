import { describe, expect, it } from "vitest";
import { RGAA_CRITERIA } from "./rgaa.js";
import {
  allowedStatuses,
  computeCompliance,
  type AutoFinding,
  type ManualStatus,
} from "./compliance.js";

const ALL = RGAA_CRITERIA.map((c) => c.id);
const every = (status: ManualStatus) =>
  new Map<string, ManualStatus>(ALL.map((id) => [id, status]));
const compute = (
  manual: Map<string, ManualStatus> = new Map(),
  findings: AutoFinding[] = [],
) => computeCompliance({ manualChecks: manual, findings });
const finding = (
  ruleId: string,
  status: AutoFinding["status"] = "open",
): AutoFinding => ({
  ruleId,
  status,
});

describe("computeCompliance: nothing checked", () => {
  it("cannot say anything: every criterion is still to check", () => {
    const result = compute();

    expect(result.status).toBe("indetermine");
    expect(result.counts).toEqual({
      conforme: 0,
      nonConforme: 0,
      na: 0,
      aVerifier: 106,
    });
    expect(result.rate).toBeNull();
    expect(result.criteria).toHaveLength(106);
    expect(result.criteria.every((c) => c.state === "a_verifier")).toBe(true);
  });
});

describe("computeCompliance: a complete audit", () => {
  it("is totally compliant only when every applicable criterion is compliant", () => {
    const result = compute(every("ok"));

    expect(result.status).toBe("total");
    expect(result.rate).toBe(100);
    expect(result.counts.conforme).toBe(106);
  });

  it("is partial with one failed criterion, and lists it", () => {
    const manual = every("ok");
    manual.set("3.2", "ko");

    const result = compute(manual);

    expect(result.status).toBe("partiel");
    expect(result.counts).toMatchObject({ conforme: 105, nonConforme: 1 });
    expect(result.nonConformes.map((c) => c.id)).toEqual(["3.2"]);
  });

  it("is not compliant when no criterion is", () => {
    const manual = every("ko");

    const result = compute(manual);

    expect(result.status).toBe("non");
    expect(result.rate).toBe(0);
  });

  it("leaves not-applicable criteria out of the rate", () => {
    const manual = every("na");
    manual.set("1.1", "ok");
    manual.set("1.2", "ko");

    const result = compute(manual);

    expect(result.counts).toMatchObject({
      conforme: 1,
      nonConforme: 1,
      na: 104,
    });
    expect(result.rate).toBe(50);
    expect(result.status).toBe("partiel");
  });

  it("cannot conclude when everything is not applicable", () => {
    expect(compute(every("na")).status).toBe("indetermine");
    expect(compute(every("na")).rate).toBeNull();
  });

  it("rounds the rate down, never up to a flattering figure", () => {
    const manual = every("ok");
    manual.set("1.1", "ko"); // 105 / 106 = 99.056...

    expect(compute(manual).rate).toBe(99);

    const almost = every("ok");
    for (const id of ALL.slice(0, 3)) almost.set(id, "ko"); // 103 / 106 = 97.169...
    expect(compute(almost).rate).toBe(97);
  });
});

describe("computeCompliance: an incomplete audit", () => {
  it("never claims total or partial compliance while criteria are unchecked", () => {
    const manual = new Map<string, ManualStatus>(
      ALL.slice(0, 105).map((id) => [id, "ok"]),
    );

    const result = compute(manual);

    expect(result.status).toBe("indetermine");
    expect(result.counts).toMatchObject({ conforme: 105, aVerifier: 1 });
    expect(result.rate).toBe(99);
  });

  it("still lists the failures found so far", () => {
    const manual = new Map<string, ManualStatus>([["3.2", "ko"]]);

    const result = compute(manual);

    expect(result.status).toBe("indetermine");
    expect(result.nonConformes.map((c) => c.id)).toEqual(["3.2"]);
  });
});

describe("computeCompliance: automatic findings", () => {
  it("make a criterion non-compliant, whatever a person said", () => {
    const manual = every("ok");

    const result = compute(manual, [finding("color-contrast")]);

    const c = result.criteria.find((x) => x.id === "3.2")!;
    expect(c.state).toBe("non_conforme");
    expect(c.sources).toEqual(["auto"]);
    expect(c.axeRules).toEqual(["color-contrast"]);
    expect(result.status).toBe("partiel");
  });

  it("flag the contradiction when a person marked the criterion compliant", () => {
    const manual = every("ok");

    const result = compute(manual, [finding("color-contrast")]);

    expect(result.criteria.find((x) => x.id === "3.2")?.contradiction).toBe(
      true,
    );
    expect(result.criteria.find((x) => x.id === "3.1")?.contradiction).toBe(
      false,
    );
  });

  it("combine with a failed manual check on the same criterion", () => {
    const manual = every("ok");
    manual.set("3.2", "ko");

    const c = compute(manual, [finding("color-contrast")]).criteria.find(
      (x) => x.id === "3.2",
    )!;

    expect(c.sources).toEqual(["manual", "auto"]);
    expect(c.contradiction).toBe(false);
  });

  it("count a regressed problem like an open one", () => {
    expect(
      compute(every("ok"), [finding("image-alt", "regressed")]).counts
        .nonConforme,
    ).toBe(1);
  });

  it("keep an ignored problem non-compliant: ignoring it does not fix it", () => {
    const result = compute(every("ok"), [finding("image-alt", "ignored")]);

    expect(result.criteria.find((x) => x.id === "1.1")?.state).toBe(
      "non_conforme",
    );
    expect(result.status).toBe("partiel");
  });

  it("ignore a fixed problem", () => {
    expect(compute(every("ok"), [finding("image-alt", "fixed")]).status).toBe(
      "total",
    );
  });

  it("count a criterion once however many rules or findings concern it", () => {
    const result = compute(every("ok"), [
      finding("image-alt"),
      finding("image-alt"),
      finding("area-alt"),
    ]);

    expect(result.counts.nonConforme).toBe(1);
    expect(result.criteria.find((x) => x.id === "1.1")?.axeRules).toEqual([
      "area-alt",
      "image-alt",
    ]);
  });

  it("make a not-applicable criterion applicable again if a problem shows on it", () => {
    const manual = every("ok");
    manual.set("1.1", "na");

    const result = compute(manual, [finding("image-alt")]);

    expect(result.criteria.find((x) => x.id === "1.1")?.state).toBe(
      "non_conforme",
    );
  });

  it("do not let a problem we cannot attribute to a criterion pass as total compliance", () => {
    const result = compute(every("ok"), [
      finding("a-rule-with-no-rgaa-criterion"),
    ]);

    expect(result.unattributed).toBe(1);
    expect(result.status).toBe("partiel");
  });

  it("do not count an unattributed problem that is fixed", () => {
    const result = compute(every("ok"), [
      finding("a-rule-with-no-rgaa-criterion", "fixed"),
    ]);

    expect(result.unattributed).toBe(0);
    expect(result.status).toBe("total");
  });

  it("do not need an audit to be complete to show what automatic findings reveal", () => {
    const result = compute(new Map(), [finding("image-alt")]);

    expect(result.status).toBe("indetermine");
    expect(result.nonConformes.map((c) => c.id)).toEqual(["1.1"]);
    expect(result.counts.aVerifier).toBe(105);
  });
});

describe("computeCompliance: manual input", () => {
  it("ignores a check on a criterion that does not exist", () => {
    const manual = every("ok");
    manual.set("99.9", "ko");

    const result = compute(manual);

    expect(result.criteria).toHaveLength(106);
    expect(result.status).toBe("total");
  });

  it("keeps the published criteria order", () => {
    const result = compute();

    expect(result.criteria.map((c) => c.id)).toEqual(ALL);
  });
});

describe("allowedStatuses", () => {
  it("lets a publisher be more cautious than the computation, never less", () => {
    expect(allowedStatuses("total")).toEqual(["total", "partiel", "non"]);
    expect(allowedStatuses("partiel")).toEqual(["partiel", "non"]);
    expect(allowedStatuses("non")).toEqual(["non"]);
  });

  it("allows nothing while the audit is incomplete", () => {
    expect(allowedStatuses("indetermine")).toEqual([]);
  });
});
