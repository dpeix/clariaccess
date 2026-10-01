import type { Impact } from "@accessibility/contracts";

export interface AlertFinding {
  ruleId: string;
  impact: Impact;
  pageUrl: string;
  message: string;
  // "regression": a fixed problem came back in this audit. "new": first seen
  // in this audit.
  kind: "regression" | "new";
}

export interface AlertInput {
  // False for the first audit of a site: every problem would look new.
  hasPreviousAudit: boolean;
  findings: AlertFinding[];
}

// Findings of one rule on one page, which an email shows as a single line.
export interface AlertGroup extends AlertFinding {
  count: number;
}

export interface AlertSummary {
  regressions: number;
  newSevere: number;
  top: AlertGroup[];
}

const MAX_LISTED = 5;
const SEVERITY: Record<Impact, number> = {
  critical: 3,
  serious: 2,
  moderate: 1,
  minor: 0,
};

const isSevere = (impact: Impact) => SEVERITY[impact] >= SEVERITY.serious;

// What is worth an email after a re-scan: problems that came back, and new
// serious or critical ones. Null when there is nothing of the sort, so a quiet
// re-scan stays quiet.
export function summarizeAlert(input: AlertInput): AlertSummary | null {
  if (!input.hasPreviousAudit) return null;
  const worth = input.findings.filter(
    (f) => f.kind === "regression" || isSevere(f.impact),
  );
  if (worth.length === 0) return null;

  // One line per rule, page and kind: a missing landmark on a page is one line
  // however many elements it concerns.
  const groups = new Map<string, AlertGroup>();
  for (const f of worth) {
    const key = JSON.stringify([f.kind, f.ruleId, f.pageUrl]);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, { ...f, count: 1 });
    else group.count += 1;
  }
  const top = [...groups.values()]
    .sort(
      (a, b) =>
        Number(b.kind === "regression") - Number(a.kind === "regression") ||
        SEVERITY[b.impact] - SEVERITY[a.impact] ||
        a.ruleId.localeCompare(b.ruleId) ||
        a.pageUrl.localeCompare(b.pageUrl) ||
        a.message.localeCompare(b.message),
    )
    .slice(0, MAX_LISTED);
  return {
    regressions: worth.filter((f) => f.kind === "regression").length,
    newSevere: worth.filter((f) => f.kind === "new").length,
    top,
  };
}
