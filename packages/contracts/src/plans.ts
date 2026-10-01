// The plan grid. Prices live with the payment provider, not here: this file
// only says what each plan allows, so a limit changes in one place and needs
// no migration.
export const PLANS = ["free", "pro"] as const;
export type Plan = (typeof PLANS)[number];

export const SCAN_FREQUENCIES = ["weekly", "daily"] as const;
export type ScanFrequency = (typeof SCAN_FREQUENCIES)[number];

export interface PlanLimits {
  maxSites: number;
  // Pages scanned per audit, home page included.
  maxPagesPerAudit: number;
  // Re-scan frequencies a site of this plan may use; empty: none.
  scheduledFrequencies: ScanFrequency[];
  manualAuditsPerDayPerSite: number;
}

export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  free: {
    maxSites: 1,
    maxPagesPerAudit: 10,
    scheduledFrequencies: [],
    manualAuditsPerDayPerSite: 2,
  },
  pro: {
    maxSites: 10,
    maxPagesPerAudit: 100,
    scheduledFrequencies: ["weekly", "daily"],
    manualAuditsPerDayPerSite: 10,
  },
};

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}

// A stored value that is not a known plan (hand-edited row, plan removed)
// must never unlock more than the free plan allows.
export function normalizePlan(value: string): Plan {
  return isPlan(value) ? value : "free";
}

export function planLimits(plan: string): PlanLimits {
  return PLAN_LIMITS[normalizePlan(plan)];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function frequencyIntervalMs(frequency: ScanFrequency): number {
  return frequency === "daily" ? DAY_MS : 7 * DAY_MS;
}
