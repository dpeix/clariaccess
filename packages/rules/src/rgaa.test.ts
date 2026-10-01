import { describe, expect, it } from "vitest";
import { MAPPED_AXE_RULE_IDS, lookupAxeRule } from "./index.js";
import {
  RGAA_CRITERIA,
  RGAA_THEMES,
  RGAA_VERSION,
  autoCoverage,
  criteriaOfTheme,
  criterionById,
} from "./rgaa.js";

describe("the generated RGAA reference", () => {
  it("is RGAA 4.1: 13 themes and 106 criteria", () => {
    expect(RGAA_VERSION).toBe("4.1");
    expect(RGAA_THEMES).toHaveLength(13);
    expect(RGAA_CRITERIA).toHaveLength(106);
  });

  it("numbers themes 1 to 13 and gives each a title and criteria", () => {
    expect(RGAA_THEMES.map((t) => t.number)).toEqual(
      Array.from({ length: 13 }, (_, i) => i + 1),
    );
    for (const theme of RGAA_THEMES) {
      expect(theme.title.length).toBeGreaterThan(0);
      expect(criteriaOfTheme(theme.number).length).toBeGreaterThan(0);
    }
  });

  it("has unique ids built from the theme, and a title with no markdown left", () => {
    const ids = RGAA_CRITERIA.map((c) => c.id);

    expect(new Set(ids).size).toBe(106);
    for (const c of RGAA_CRITERIA) {
      expect(c.id).toBe(`${c.theme}.${c.number}`);
      expect(c.title).not.toMatch(/\]\(|`/);
      expect(c.title.endsWith("?")).toBe(true);
      expect(c.testCount).toBeGreaterThan(0);
    }
  });

  it("keeps the published order, and knows well-known criteria", () => {
    expect(RGAA_CRITERIA[0]?.id).toBe("1.1");
    expect(RGAA_CRITERIA.at(-1)?.id).toBe("13.12");
    expect(criterionById("3.2")?.title).toMatch(/contraste/i);
    expect(criterionById("8.3")?.title).toMatch(/langue/i);
  });

  it("does not trust the id: unknown and prototype keys give nothing", () => {
    expect(criterionById("99.9")).toBeUndefined();
    expect(criterionById("constructor")).toBeUndefined();
    expect(criterionById("__proto__")).toBeUndefined();
  });
});

describe("axe to RGAA mapping against the official reference", () => {
  const mapped = MAPPED_AXE_RULE_IDS.flatMap((id) => {
    const lookup = lookupAxeRule(id);
    return lookup.status === "mapped"
      ? lookup.rgaaCriteria.map((rgaa) => ({
          axe: id,
          rgaa,
          wcag: lookup.wcagCriteria,
        }))
      : [];
  });

  it("only cites RGAA criteria that exist", () => {
    const unknown = mapped.filter((m) => criterionById(m.rgaa) === undefined);

    expect(unknown).toEqual([]);
  });

  // Verified against the official tests, not guessed. Axe tags area-alt with
  // WCAG 2.4.4 and 4.1.2, while RGAA test 1.1.2 ("chaque zone d'une image
  // réactive (balise <area>) porteuse d'information a-t-elle une alternative
  // textuelle ?") covers it under criterion 1.1.
  const VERIFIED_EXCEPTIONS = new Set(["area-alt|1.1"]);

  it("only maps an axe rule to a criterion that refers to one of the rule's WCAG criteria", () => {
    // The RGAA criterion lists the WCAG success criteria it covers: a mapping
    // that shares none with the axe rule is suspect.
    const suspect = mapped.filter(
      (m) =>
        !VERIFIED_EXCEPTIONS.has(`${m.axe}|${m.rgaa}`) &&
        !criterionById(m.rgaa)!.wcag.some((w) => m.wcag.includes(w)),
    );

    expect(suspect).toEqual([]);
  });

  it("keeps the verified exception true: its criterion really has a test on <area>", () => {
    const test = criterionById("1.1");

    expect(test?.title).toMatch(/image/i);
    expect(test?.testCount).toBeGreaterThanOrEqual(2);
  });
});

describe("autoCoverage", () => {
  it("says which criteria axe can look at, from the mapping", () => {
    expect(autoCoverage("1.1").axeRules).toContain("image-alt");
    expect(autoCoverage("3.2").axeRules).toContain("color-contrast");
    expect(autoCoverage("1.1").tested).toBe(true);
  });

  it("marks a criterion no mapped rule covers as manual only", () => {
    const manual = RGAA_CRITERIA.filter((c) => !autoCoverage(c.id).tested);

    expect(manual.length).toBeGreaterThan(50);
    expect(autoCoverage(manual[0]!.id)).toEqual({
      tested: false,
      axeRules: [],
    });
  });

  it("never claims full coverage: even a tested criterion needs a human check", () => {
    for (const c of RGAA_CRITERIA) {
      expect(autoCoverage(c.id)).not.toHaveProperty("complete");
    }
  });

  it("returns nothing for an unknown criterion", () => {
    expect(autoCoverage("99.9")).toEqual({ tested: false, axeRules: [] });
  });
});
