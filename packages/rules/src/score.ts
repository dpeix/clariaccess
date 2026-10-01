export type ScoreImpact = "minor" | "moderate" | "serious" | "critical";

// Relative cost of one issue. Severity grows faster than linearly so a few
// critical barriers weigh more than many cosmetic ones.
const IMPACT_WEIGHT: Record<ScoreImpact, number> = {
  minor: 1,
  moderate: 3,
  serious: 6,
  critical: 10,
};

// Penalty at which the score falls to about 37 (100 / e). Tuned so a page with
// a handful of serious issues lands in the middle of the scale.
const PENALTY_SCALE = 50;

// Automated score out of 100 for one audit. It only reflects what axe-core can
// detect, never overall conformity: the report must say so. Exponential decay
// keeps it within [0, 100] however many issues a page has, and strictly
// decreasing as issues are added.
export function computeScore(issues: { impact: ScoreImpact }[]): number {
  const penalty = issues.reduce(
    (total, issue) => total + IMPACT_WEIGHT[issue.impact],
    0,
  );
  return Math.round(100 * Math.exp(-penalty / PENALTY_SCALE));
}
