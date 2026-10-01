import { RGAA_CRITERIA } from "./rgaa.js";
import { lookupAxeRule } from "./index.js";

export type ManualStatus = "ok" | "ko" | "na";

// A problem found by the automatic scan. "fixed" ones are not problems any
// more; "ignored" ones are still there (the customer chose not to act).
export interface AutoFinding {
  ruleId: string;
  status: "open" | "regressed" | "ignored" | "fixed";
}

export type CriterionState = "conforme" | "non_conforme" | "na" | "a_verifier";

export interface CriterionCompliance {
  id: string;
  state: CriterionState;
  // Where the non-compliance comes from, in this order.
  sources: ("manual" | "auto")[];
  // Axe rules reporting a problem on this criterion.
  axeRules: string[];
  // A person said "compliant" but the scan found a problem: shown to them.
  contradiction: boolean;
}

// "indetermine": the audit is not complete (or nothing is applicable), so no
// compliance level can honestly be stated.
export type ComplianceStatus = "total" | "partiel" | "non" | "indetermine";

export interface ComplianceResult {
  status: ComplianceStatus;
  // Percentage of applicable criteria that are compliant, rounded down; null
  // when no criterion is applicable.
  rate: number | null;
  counts: {
    conforme: number;
    nonConforme: number;
    na: number;
    aVerifier: number;
  };
  criteria: CriterionCompliance[];
  nonConformes: CriterionCompliance[];
  // Open problems that map to no RGAA criterion: they cannot be placed, so
  // they prevent a "total" status.
  unattributed: number;
}

export interface ComplianceInput {
  manualChecks: ReadonlyMap<string, ManualStatus>;
  findings: readonly AutoFinding[];
}

const isProblem = (status: AutoFinding["status"]) => status !== "fixed";

// What the audit says about each RGAA criterion, and the level it supports.
//
// The scan can only disprove a criterion: a clean scan validates nothing, so a
// criterion is compliant only when a person checked it. Everything that is not
// checked keeps the declaration undetermined rather than flattering it.
export function computeCompliance(input: ComplianceInput): ComplianceResult {
  const axeByCriterion = new Map<string, Set<string>>();
  let unattributed = 0;
  for (const finding of input.findings) {
    if (!isProblem(finding.status)) continue;
    const lookup = lookupAxeRule(finding.ruleId);
    const criteria = lookup.status === "mapped" ? lookup.rgaaCriteria : [];
    if (criteria.length === 0) {
      unattributed += 1;
      continue;
    }
    for (const id of criteria) {
      const rules = axeByCriterion.get(id) ?? new Set<string>();
      rules.add(finding.ruleId);
      axeByCriterion.set(id, rules);
    }
  }

  const criteria: CriterionCompliance[] = RGAA_CRITERIA.map((criterion) => {
    const manual = input.manualChecks.get(criterion.id);
    const axeRules = [...(axeByCriterion.get(criterion.id) ?? [])].sort();
    const sources: CriterionCompliance["sources"] = [];
    if (manual === "ko") sources.push("manual");
    if (axeRules.length > 0) sources.push("auto");

    let state: CriterionState;
    if (sources.length > 0) state = "non_conforme";
    else if (manual === "na") state = "na";
    else if (manual === "ok") state = "conforme";
    else state = "a_verifier";

    return {
      id: criterion.id,
      state,
      sources,
      axeRules,
      contradiction: manual === "ok" && axeRules.length > 0,
    };
  });

  const count = (state: CriterionState) =>
    criteria.filter((c) => c.state === state).length;
  const counts = {
    conforme: count("conforme"),
    nonConforme: count("non_conforme"),
    na: count("na"),
    aVerifier: count("a_verifier"),
  };
  const applicable = counts.conforme + counts.nonConforme + counts.aVerifier;
  const checkedApplicable = counts.conforme + counts.nonConforme;
  // Nothing checked yet: no rate, rather than a misleading 0 %.
  const rate =
    checkedApplicable === 0
      ? null
      : Math.floor((counts.conforme * 100) / applicable);

  let status: ComplianceStatus;
  if (counts.aVerifier > 0 || checkedApplicable === 0) status = "indetermine";
  else if (counts.conforme === 0) status = "non";
  else if (counts.nonConforme === 0 && unattributed === 0) status = "total";
  else status = "partiel";

  return {
    status,
    rate,
    counts,
    criteria,
    nonConformes: criteria.filter((c) => c.state === "non_conforme"),
    unattributed,
  };
}

// A declaration may say less than the computation supports, never more.
export function allowedStatuses(
  computed: ComplianceStatus,
): Exclude<ComplianceStatus, "indetermine">[] {
  if (computed === "total") return ["total", "partiel", "non"];
  if (computed === "partiel") return ["partiel", "non"];
  if (computed === "non") return ["non"];
  return [];
}
