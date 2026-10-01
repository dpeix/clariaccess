import type {
  Audit,
  AuditReport,
  Impact,
  ReportGroup,
} from "@accessibility/contracts";
import { IMPACTS } from "@accessibility/contracts";

// Shown with every report: an automated scan cannot establish conformity, and
// claiming otherwise would be a legal risk for the visitor (plan.md §3).
export const AUTOMATED_COVERAGE_NOTICE =
  "Cet audit automatisé ne couvre qu'une partie des critères d'accessibilité (environ 30 à 40 %). Un score élevé ne garantit pas la conformité au RGAA ou à la norme EN 301 549 : une vérification manuelle reste nécessaire.";

const MAX_EXAMPLES_PER_GROUP = 3;

export interface ReportIssueRow {
  ruleId: string;
  impact: Impact;
  selector: string;
  htmlExcerpt: string;
  // Written by the worker ({ help, helpUrl, ... }); not trusted to be well formed.
  raw: unknown;
  wcagCriteria: string[];
  rgaaCriteria: string[];
}

function rawText(raw: unknown, key: string): string | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = (raw as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

// The link ends up in an email and a web page: only http(s) is acceptable.
function httpUrl(value: string | null): string | null {
  if (value === null) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

export function buildReport(audit: Audit, rows: ReportIssueRow[]): AuditReport {
  const groups = new Map<string, ReportGroup>();
  for (const row of rows) {
    const group = groups.get(row.ruleId);
    if (group === undefined) {
      groups.set(row.ruleId, {
        ruleId: row.ruleId,
        title: rawText(row.raw, "help") ?? row.ruleId,
        helpUrl: httpUrl(rawText(row.raw, "helpUrl")),
        impact: row.impact,
        occurrences: 1,
        examples: [{ selector: row.selector, htmlExcerpt: row.htmlExcerpt }],
        wcagCriteria: row.wcagCriteria,
        rgaaCriteria: row.rgaaCriteria,
      });
      continue;
    }
    group.occurrences += 1;
    if (group.examples.length < MAX_EXAMPLES_PER_GROUP) {
      group.examples.push({
        selector: row.selector,
        htmlExcerpt: row.htmlExcerpt,
      });
    }
    // Occurrences of one rule can differ in impact: keep the worst.
    if (IMPACTS.indexOf(row.impact) > IMPACTS.indexOf(group.impact)) {
      group.impact = row.impact;
    }
  }

  const sorted = [...groups.values()].sort(
    (a, b) =>
      IMPACTS.indexOf(b.impact) - IMPACTS.indexOf(a.impact) ||
      b.occurrences - a.occurrences ||
      a.ruleId.localeCompare(b.ruleId),
  );
  return {
    audit,
    totalIssues: rows.length,
    groups: sorted,
    automatedCoverageNotice: AUTOMATED_COVERAGE_NOTICE,
  };
}
