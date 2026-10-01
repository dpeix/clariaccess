import { MAPPED_AXE_RULE_IDS, lookupAxeRule } from "./index.js";
import {
  RGAA_CRITERIA_DATA,
  RGAA_SOURCE,
  RGAA_THEMES_DATA,
} from "./rgaa-criteria.generated.js";
import type { RgaaCriterion, RgaaTheme } from "./rgaa-import.js";

export type { RgaaCriterion, RgaaTheme };

export const RGAA_VERSION: string = RGAA_SOURCE.version;
export const RGAA_THEMES: readonly RgaaTheme[] = RGAA_THEMES_DATA;
export const RGAA_CRITERIA: readonly RgaaCriterion[] = RGAA_CRITERIA_DATA;

const BY_ID = new Map(RGAA_CRITERIA.map((c) => [c.id, c]));

// Map lookup, not an object key: ids come from requests.
export function criterionById(id: string): RgaaCriterion | undefined {
  return BY_ID.get(id);
}

export function criteriaOfTheme(theme: number): RgaaCriterion[] {
  return RGAA_CRITERIA.filter((c) => c.theme === theme);
}

// What the automatic scan can look at for a criterion. Axe checks some of a
// criterion's tests, never all of its meaning (is an alternative text
// relevant? is the order logical?): "tested" therefore only says that axe
// reports problems on it, not that a clean scan makes it compliant. A
// criterion is validated by a person, and the automatic findings can only
// disprove it.
export function autoCoverage(id: string): {
  tested: boolean;
  axeRules: string[];
} {
  const axeRules = MAPPED_AXE_RULE_IDS.filter((rule) => {
    const lookup = lookupAxeRule(rule);
    return lookup.status === "mapped" && lookup.rgaaCriteria.includes(id);
  });
  return { tested: axeRules.length > 0, axeRules };
}
