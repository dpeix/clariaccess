import { describe, expect, it } from "vitest";
import { KNOWN_UNMAPPED, lookupAxeRule } from "./index.js";
import { GUIDED_RULE_IDS, remediationGuide } from "./remediation.js";

describe("remediationGuide", () => {
  it("covers the rules that come up most often", () => {
    for (const id of [
      "image-alt",
      "color-contrast",
      "label",
      "link-name",
      "button-name",
      "html-has-lang",
      "document-title",
      "heading-order",
      "region",
    ]) {
      expect(GUIDED_RULE_IDS, id).toContain(id);
    }
  });

  it("only guides rules that axe actually has", () => {
    for (const id of GUIDED_RULE_IDS) {
      const known =
        lookupAxeRule(id).status === "mapped" ||
        (KNOWN_UNMAPPED as readonly string[]).includes(id);
      expect(known, `${id} is not an axe rule we know`).toBe(true);
    }
  });

  it("gives every guided rule a summary and concrete steps, in French", () => {
    for (const id of GUIDED_RULE_IDS) {
      const guide = remediationGuide(id);

      expect(guide.generic).toBe(false);
      expect(guide.summary.length).toBeGreaterThan(20);
      expect(guide.steps.length).toBeGreaterThanOrEqual(2);
      for (const step of guide.steps) expect(step.length).toBeGreaterThan(10);
    }
  });

  it("does not repeat itself from one rule to the next", () => {
    const summaries = GUIDED_RULE_IDS.map((id) => remediationGuide(id).summary);

    expect(new Set(summaries).size).toBe(summaries.length);
  });

  it("falls back on a generic guide for a rule it has no text for", () => {
    const guide = remediationGuide("some-rule-added-by-a-future-axe");

    expect(guide.generic).toBe(true);
    expect(guide.steps.length).toBeGreaterThan(0);
  });

  it("does not trust the id: a prototype key gets the generic guide", () => {
    expect(remediationGuide("constructor").generic).toBe(true);
    expect(remediationGuide("__proto__").generic).toBe(true);
  });
});
