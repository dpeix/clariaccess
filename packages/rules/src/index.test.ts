import axe from "axe-core";
import { describe, expect, it } from "vitest";
import {
  KNOWN_UNMAPPED,
  MAPPED_AXE_RULE_IDS,
  RULES_VERSION,
  en301549ClausesFor,
  lookupAxeRule,
} from "./index.js";

// axe tags a rule with `wcag111` for success criterion 1.1.1, `wcag1412` for 1.4.12.
function wcagCriteriaFromTags(tags: string[]): string[] {
  return tags
    .map((tag) => /^wcag(\d)(\d)(\d+)$/.exec(tag))
    .filter((match) => match !== null)
    .map((match) => `${match[1]}.${match[2]}.${match[3]}`)
    .sort();
}

function levelFromTags(tags: string[]): "A" | "AA" | "AAA" {
  if (tags.some((tag) => tag === "wcag2aaa")) return "AAA";
  if (tags.some((tag) => /^wcag2(1|2)?aa$/.test(tag))) return "AA";
  return "A";
}

describe("lookupAxeRule", () => {
  it("maps a known rule through WCAG, EN 301 549 and RGAA", () => {
    expect(lookupAxeRule("image-alt")).toEqual({
      status: "mapped",
      axeRuleId: "image-alt",
      wcagCriteria: ["1.1.1"],
      level: "A",
      en301549Clauses: ["9.1.1.1"],
      rgaaCriteria: ["1.1"],
    });
  });

  it("keeps every WCAG criterion of a rule that covers several", () => {
    const result = lookupAxeRule("link-name");

    expect(result.status).toBe("mapped");
    if (result.status === "mapped") {
      expect(result.wcagCriteria).toEqual(["2.4.4", "4.1.2"]);
      expect(result.en301549Clauses).toEqual(["9.2.4.4", "9.4.1.2"]);
    }
  });

  it("reports an unknown rule explicitly instead of guessing", () => {
    expect(lookupAxeRule("not-an-axe-rule")).toEqual({ status: "unknown" });
  });

  it("reports a best-practice rule without WCAG criterion as unknown", () => {
    expect(lookupAxeRule("region")).toEqual({ status: "unknown" });
  });

  it("does not match inherited object properties", () => {
    expect(lookupAxeRule("constructor")).toEqual({ status: "unknown" });
    expect(lookupAxeRule("__proto__")).toEqual({ status: "unknown" });
  });
});

describe("en301549ClausesFor", () => {
  it("prefixes the WCAG number with the web clause 9", () => {
    expect(en301549ClausesFor(["1.4.3"], "AA")).toEqual(["9.1.4.3"]);
  });

  it("excludes AAA criteria, which EN 301 549 does not require", () => {
    expect(en301549ClausesFor(["1.4.6"], "AAA")).toEqual([]);
  });

  it("excludes criteria introduced by WCAG 2.2, absent from EN 301 549 v3.2.1", () => {
    expect(en301549ClausesFor(["2.5.8"], "AA")).toEqual([]);
  });
});

describe("mapping table", () => {
  const mapped = MAPPED_AXE_RULE_IDS.map((id) => lookupAxeRule(id));

  it("exposes a rules version", () => {
    expect(RULES_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("has unique rule ids and at least one WCAG criterion per rule", () => {
    expect(new Set(MAPPED_AXE_RULE_IDS).size).toBe(MAPPED_AXE_RULE_IDS.length);
    for (const entry of mapped) {
      expect(entry.status).toBe("mapped");
      if (entry.status === "mapped") {
        expect(entry.wcagCriteria.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses the RGAA criterion format theme.criterion", () => {
    for (const entry of mapped) {
      if (entry.status === "mapped") {
        for (const criterion of entry.rgaaCriteria) {
          expect(criterion).toMatch(/^\d{1,2}\.\d{1,2}$/);
        }
      }
    }
  });
});

describe("coverage of the installed axe-core", () => {
  const axeRules = axe.getRules();

  it("classifies every axe rule as mapped or known-unmapped (fails when axe adds a rule)", () => {
    const mappedIds = new Set<string>(MAPPED_AXE_RULE_IDS);
    const unmappedIds = new Set<string>(KNOWN_UNMAPPED);
    const unclassified = axeRules
      .map((rule) => rule.ruleId)
      .filter((id) => !mappedIds.has(id) && !unmappedIds.has(id));

    expect(unclassified).toEqual([]);
  });

  it("does not reference axe rules that no longer exist", () => {
    const axeIds = new Set(axeRules.map((rule) => rule.ruleId));
    const stale = [...MAPPED_AXE_RULE_IDS, ...KNOWN_UNMAPPED].filter(
      (id) => !axeIds.has(id),
    );

    expect(stale).toEqual([]);
  });

  it("never lists a rule in both mapped and unmapped", () => {
    const unmappedIds = new Set<string>(KNOWN_UNMAPPED);
    expect(MAPPED_AXE_RULE_IDS.filter((id) => unmappedIds.has(id))).toEqual([]);
  });

  it("keeps WCAG criteria and level identical to the axe tags of each mapped rule", () => {
    for (const rule of axeRules) {
      const entry = lookupAxeRule(rule.ruleId);
      if (entry.status !== "mapped") continue;
      expect(entry.wcagCriteria, rule.ruleId).toEqual(
        wcagCriteriaFromTags(rule.tags),
      );
      expect(entry.level, rule.ruleId).toBe(levelFromTags(rule.tags));
    }
  });

  it("maps every axe rule tagged with a WCAG criterion", () => {
    const untouched = axeRules
      .filter((rule) => wcagCriteriaFromTags(rule.tags).length > 0)
      .map((rule) => rule.ruleId)
      .filter((id) => lookupAxeRule(id).status !== "mapped");

    expect(untouched).toEqual([]);
  });
});
