import type {
  Plan,
  PlanLimits,
  ScanFrequency,
  TaskStatus,
} from "@accessibility/contracts";
import { SCAN_FREQUENCIES } from "@accessibility/contracts";

const PLAN_LABEL: Record<Plan, string> = { free: "Gratuit", pro: "Pro" };
const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "À faire",
  doing: "En cours",
  done: "Terminé",
};

export const planLabel = (plan: Plan) => PLAN_LABEL[plan];
export const taskStatusLabel = (status: TaskStatus) =>
  TASK_STATUS_LABEL[status];

export function frequencyLabel(frequency: ScanFrequency | null): string {
  if (frequency === "weekly") return "Chaque semaine";
  if (frequency === "daily") return "Chaque jour";
  return "Aucun re-scan";
}

export interface ScheduleChoice {
  value: ScanFrequency | null;
  label: string;
  allowed: boolean;
  // Shown instead of hiding the choice: the user learns what the next plan adds.
  reason?: string;
}

export function scheduleChoices(limits: PlanLimits): ScheduleChoice[] {
  return [
    { value: null, label: frequencyLabel(null), allowed: true },
    ...SCAN_FREQUENCIES.map((frequency) => {
      const allowed = limits.scheduledFrequencies.includes(frequency);
      return {
        value: frequency,
        label: frequencyLabel(frequency),
        allowed,
        ...(allowed ? {} : { reason: "Disponible avec la formule Pro." }),
      };
    }),
  ];
}

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

export function limitsSummary(limits: PlanLimits): string[] {
  return [
    plural(limits.maxSites, "site", "sites"),
    `${plural(limits.maxPagesPerAudit, "page", "pages")} analysées par audit`,
    `${plural(limits.manualAuditsPerDayPerSite, "audit manuel", "audits manuels")} par jour et par site`,
    limits.scheduledFrequencies.length === 0
      ? "Aucun re-scan programmé"
      : "Re-scans programmés (hebdomadaires ou quotidiens) et alertes par email",
  ];
}
