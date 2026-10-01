// Bumped whenever the mapping table changes, so stored issues can be traced
// back to the reference they were classified with.
export const RULES_VERSION = "2026-10-01";

export type WcagLevel = "A" | "AA" | "AAA";

export interface RuleMapping {
  status: "mapped";
  axeRuleId: string;
  wcagCriteria: string[];
  level: WcagLevel;
  en301549Clauses: string[];
  // Empty means "not verified yet", not "no RGAA equivalent".
  rgaaCriteria: string[];
}

export type RuleLookup = RuleMapping | { status: "unknown" };

interface TableEntry {
  wcag: string[];
  level: WcagLevel;
  rgaa?: string[];
}

// WCAG criteria and levels mirror the tags of axe-core 4.13 (enforced by tests).
// RGAA criteria are listed only where the correspondence is certain (RGAA 4.1).
const TABLE: Record<string, TableEntry> = {
  "area-alt": { wcag: ["2.4.4", "4.1.2"], level: "A", rgaa: ["1.1"] },
  "aria-allowed-attr": { wcag: ["4.1.2"], level: "A" },
  "aria-braille-equivalent": { wcag: ["4.1.2"], level: "A" },
  "aria-command-name": { wcag: ["4.1.2"], level: "A" },
  "aria-conditional-attr": { wcag: ["4.1.2"], level: "A" },
  "aria-deprecated-role": { wcag: ["4.1.2"], level: "A" },
  "aria-hidden-body": { wcag: ["1.3.1", "4.1.2"], level: "A" },
  "aria-hidden-focus": { wcag: ["4.1.2"], level: "A" },
  "aria-input-field-name": { wcag: ["4.1.2"], level: "A" },
  "aria-meter-name": { wcag: ["1.1.1"], level: "A" },
  "aria-progressbar-name": { wcag: ["1.1.1"], level: "A" },
  "aria-prohibited-attr": { wcag: ["4.1.2"], level: "A" },
  "aria-required-attr": { wcag: ["4.1.2"], level: "A" },
  "aria-required-children": { wcag: ["1.3.1"], level: "A" },
  "aria-required-parent": { wcag: ["1.3.1"], level: "A" },
  "aria-roledescription": { wcag: ["4.1.2"], level: "A" },
  "aria-roles": { wcag: ["4.1.2"], level: "A" },
  "aria-tab-name": { wcag: ["4.1.2"], level: "A" },
  "aria-toggle-field-name": { wcag: ["4.1.2"], level: "A" },
  "aria-tooltip-name": { wcag: ["4.1.2"], level: "A" },
  "aria-valid-attr-value": { wcag: ["4.1.2"], level: "A" },
  "aria-valid-attr": { wcag: ["4.1.2"], level: "A" },
  "audio-caption": { wcag: ["1.2.1"], level: "A" },
  "autocomplete-valid": { wcag: ["1.3.5"], level: "AA" },
  "avoid-inline-spacing": { wcag: ["1.4.12"], level: "AA" },
  blink: { wcag: ["2.2.2"], level: "A" },
  "button-name": { wcag: ["4.1.2"], level: "A", rgaa: ["11.9"] },
  bypass: { wcag: ["2.4.1"], level: "A" },
  "color-contrast-enhanced": { wcag: ["1.4.6"], level: "AAA" },
  "color-contrast": { wcag: ["1.4.3"], level: "AA", rgaa: ["3.2"] },
  "css-orientation-lock": { wcag: ["1.3.4"], level: "AA" },
  "definition-list": { wcag: ["1.3.1"], level: "A", rgaa: ["9.3"] },
  dlitem: { wcag: ["1.3.1"], level: "A", rgaa: ["9.3"] },
  "document-title": { wcag: ["2.4.2"], level: "A", rgaa: ["8.5"] },
  "duplicate-id-active": { wcag: ["4.1.1"], level: "A" },
  "duplicate-id-aria": { wcag: ["4.1.2"], level: "A" },
  "duplicate-id": { wcag: ["4.1.1"], level: "A" },
  "form-field-multiple-labels": { wcag: ["3.3.2"], level: "A" },
  "frame-focusable-content": { wcag: ["2.1.1"], level: "A" },
  "frame-title-unique": { wcag: ["4.1.2"], level: "A" },
  "frame-title": { wcag: ["4.1.2"], level: "A", rgaa: ["2.1"] },
  "html-has-lang": { wcag: ["3.1.1"], level: "A", rgaa: ["8.3"] },
  "html-lang-valid": { wcag: ["3.1.1"], level: "A", rgaa: ["8.4"] },
  "html-xml-lang-mismatch": { wcag: ["3.1.1"], level: "A" },
  "identical-links-same-purpose": { wcag: ["2.4.9"], level: "AAA" },
  "image-alt": { wcag: ["1.1.1"], level: "A", rgaa: ["1.1"] },
  "input-button-name": { wcag: ["4.1.2"], level: "A", rgaa: ["11.9"] },
  "input-image-alt": { wcag: ["1.1.1", "4.1.2"], level: "A", rgaa: ["1.1"] },
  "label-content-name-mismatch": { wcag: ["2.5.3"], level: "A" },
  label: { wcag: ["4.1.2"], level: "A", rgaa: ["11.1"] },
  "link-in-text-block": { wcag: ["1.4.1"], level: "A" },
  "link-name": { wcag: ["2.4.4", "4.1.2"], level: "A", rgaa: ["6.2"] },
  list: { wcag: ["1.3.1"], level: "A", rgaa: ["9.3"] },
  listitem: { wcag: ["1.3.1"], level: "A", rgaa: ["9.3"] },
  marquee: { wcag: ["2.2.2"], level: "A" },
  "meta-refresh-no-exceptions": { wcag: ["2.2.4", "3.2.5"], level: "AAA" },
  "meta-refresh": { wcag: ["2.2.1"], level: "A" },
  "meta-viewport": { wcag: ["1.4.4"], level: "AA" },
  "nested-interactive": { wcag: ["4.1.2"], level: "A" },
  "no-autoplay-audio": { wcag: ["1.4.2"], level: "A" },
  "object-alt": { wcag: ["1.1.1"], level: "A", rgaa: ["1.1"] },
  "p-as-heading": { wcag: ["1.3.1"], level: "A" },
  "role-img-alt": { wcag: ["1.1.1"], level: "A", rgaa: ["1.1"] },
  "scrollable-region-focusable": { wcag: ["2.1.1", "2.1.3"], level: "A" },
  "select-name": { wcag: ["4.1.2"], level: "A", rgaa: ["11.1"] },
  "server-side-image-map": { wcag: ["2.1.1"], level: "A" },
  "summary-name": { wcag: ["4.1.2"], level: "A" },
  "svg-img-alt": { wcag: ["1.1.1"], level: "A", rgaa: ["1.1"] },
  "table-fake-caption": { wcag: ["1.3.1"], level: "A" },
  "target-size": { wcag: ["2.5.8"], level: "AA" },
  "td-has-header": { wcag: ["1.3.1"], level: "A" },
  "td-headers-attr": { wcag: ["1.3.1"], level: "A" },
  "th-has-data-cells": { wcag: ["1.3.1"], level: "A" },
  "valid-lang": { wcag: ["3.1.2"], level: "AA", rgaa: ["8.8"] },
  "video-caption": { wcag: ["1.2.2"], level: "A" },
};

// axe rules without a WCAG success criterion (best practices): classified on
// purpose so a rule added by an axe upgrade fails the coverage test instead of
// silently falling through.
export const KNOWN_UNMAPPED = [
  "accesskeys",
  "aria-allowed-role",
  "aria-dialog-name",
  "aria-text",
  "aria-treeitem-name",
  "empty-heading",
  "empty-table-header",
  "focus-order-semantics",
  "frame-tested",
  "heading-order",
  "hidden-content",
  "image-redundant-alt",
  "label-title-only",
  "landmark-banner-is-top-level",
  "landmark-complementary-is-top-level",
  "landmark-contentinfo-is-top-level",
  "landmark-main-is-top-level",
  "landmark-no-duplicate-banner",
  "landmark-no-duplicate-contentinfo",
  "landmark-no-duplicate-main",
  "landmark-one-main",
  "landmark-unique",
  "meta-viewport-large",
  "page-has-heading-one",
  "presentation-role-conflict",
  "region",
  "scope-attr-valid",
  "skip-link",
  "tabindex",
  "table-duplicate-name",
] as const;

export const MAPPED_AXE_RULE_IDS: readonly string[] = Object.keys(TABLE);

// EN 301 549 v3.2.1 clause 9 reproduces WCAG 2.1 A and AA with the number
// prefixed by "9.". Level AAA and criteria new in WCAG 2.2 are not part of it.
const WCAG_2_2_ONLY = new Set(["2.5.8"]);

export function en301549ClausesFor(
  wcagCriteria: readonly string[],
  level: WcagLevel,
): string[] {
  if (level === "AAA") return [];
  return wcagCriteria
    .filter((criterion) => !WCAG_2_2_ONLY.has(criterion))
    .map((criterion) => `9.${criterion}`);
}

export function lookupAxeRule(axeRuleId: string): RuleLookup {
  // Own-property check: ids come from external scan results.
  if (!Object.hasOwn(TABLE, axeRuleId)) return { status: "unknown" };
  const entry = TABLE[axeRuleId];
  if (entry === undefined) return { status: "unknown" };
  return {
    status: "mapped",
    axeRuleId,
    wcagCriteria: entry.wcag,
    level: entry.level,
    en301549Clauses: en301549ClausesFor(entry.wcag, entry.level),
    rgaaCriteria: entry.rgaa ?? [],
  };
}

export { computeScore, type ScoreImpact } from "./score.js";
