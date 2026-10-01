import type { Result } from "axe-core";
import { KNOWN_UNMAPPED, MAPPED_AXE_RULE_IDS } from "@accessibility/rules";
import { IMPACTS } from "@accessibility/contracts";
import { fingerprint, normalizeSelector } from "./fingerprint.js";

type Impact = (typeof IMPACTS)[number];

export interface NormalizedIssue {
  ruleId: string;
  impact: Impact;
  selector: string;
  htmlExcerpt: string;
  message: string;
  fingerprint: string;
  raw: Record<string, unknown>;
}

export interface NormalizeOptions {
  templateKey: string | null;
  maxIssues: number;
  maxHtmlLength: number;
}

export interface NormalizeResult {
  issues: NormalizedIssue[];
  // `issues.rule_id` references `rules`: rules we never seeded cannot be stored.
  skippedUnknownRules: string[];
  truncated: boolean;
}

const SEEDED_RULE_IDS = new Set([...MAPPED_AXE_RULE_IDS, ...KNOWN_UNMAPPED]);

function toImpact(...candidates: (string | null | undefined)[]): Impact {
  for (const candidate of candidates) {
    const impact = IMPACTS.find((known) => known === candidate);
    if (impact !== undefined) return impact;
  }
  return "minor";
}

export function normalizeViolations(
  violations: readonly Result[],
  options: NormalizeOptions,
): NormalizeResult {
  const issues: NormalizedIssue[] = [];
  const skipped = new Set<string>();
  let truncated = false;

  for (const violation of violations) {
    if (!SEEDED_RULE_IDS.has(violation.id)) {
      skipped.add(violation.id);
      continue;
    }
    for (const node of violation.nodes) {
      if (issues.length >= options.maxIssues) {
        truncated = true;
        break;
      }
      const selector = normalizeSelector(node.target);
      issues.push({
        ruleId: violation.id,
        impact: toImpact(node.impact, violation.impact),
        selector,
        htmlExcerpt: node.html.slice(0, options.maxHtmlLength),
        message: node.failureSummary ?? violation.help,
        fingerprint: fingerprint({
          ruleId: violation.id,
          selector,
          templateKey: options.templateKey,
        }),
        raw: {
          ruleId: violation.id,
          help: violation.help,
          helpUrl: violation.helpUrl,
          tags: violation.tags,
          node,
        },
      });
    }
  }

  return { issues, skippedUnknownRules: [...skipped], truncated };
}
