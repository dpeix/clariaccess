import type {
  Audit,
  AuditFailureReason,
  AuditPage,
  Finding,
  Impact,
} from "@accessibility/contracts";

const AUDIT_STATUS: Record<Audit["status"], string> = {
  queued: "En attente",
  running: "En cours",
  completed: "Terminé",
  failed: "Échec",
};
const FINDING_STATUS: Record<Finding["status"], string> = {
  open: "Ouvert",
  fixed: "Corrigé",
  ignored: "Ignoré",
  regressed: "Régression",
};
const IMPACT: Record<Impact, string> = {
  critical: "Critique",
  serious: "Sérieux",
  moderate: "Modéré",
  minor: "Mineur",
};
const PAGE_STATUS: Record<AuditPage["status"], string> = {
  pending: "À analyser",
  done: "Analysée",
  failed: "Non analysée",
};

const FAILURE: Record<AuditFailureReason, string> = {
  forbidden_url: "Cette adresse n'est pas accessible publiquement.",
  robots_disallowed: "Le fichier robots.txt interdit l'analyse automatisée.",
  scan_failed:
    "Aucune page n'a pu être analysée (indisponible, trop lente ou refusée).",
};

export const failureLabel = (reason: AuditFailureReason | null) =>
  reason === null ? "L'audit a échoué." : FAILURE[reason];
export const auditStatusLabel = (s: Audit["status"]) => AUDIT_STATUS[s];
export const findingStatusLabel = (s: Finding["status"]) => FINDING_STATUS[s];
export const impactLabel = (i: Impact) => IMPACT[i];
export const pageStatusLabel = (s: AuditPage["status"]) => PAGE_STATUS[s];

export function formatDateTime(iso: string | null, timeZone?: string): string {
  if (iso === null) return "—";
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("fr-FR", {
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("day")} ${get("month")} ${get("year")} à ${get("hour")}:${get("minute")}`;
}
