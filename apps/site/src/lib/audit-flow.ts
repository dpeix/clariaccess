import type {
  Audit,
  AuditFailureReason,
  Impact,
} from "@accessibility/contracts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isAuditId(value: string | null): value is string {
  return value !== null && UUID.test(value);
}

export function apiErrorMessage(status: number | "network"): string {
  if (status === "network") {
    return "Impossible de joindre le service. Vérifiez votre connexion puis réessayez.";
  }
  if (status === 400)
    return "Cette adresse n'est pas valide. Indiquez une URL commençant par http:// ou https://.";
  if (status === 404) return "Audit introuvable. Vérifiez le lien reçu.";
  if (status === 429) {
    return "Trop de demandes pour le moment. Réessayez dans un moment.";
  }
  if (status >= 500) {
    return "Le service rencontre un problème momentané. Réessayez dans quelques minutes.";
  }
  return "Une erreur est survenue. Réessayez.";
}

export function leadErrorMessage(status: number | "network"): string {
  return status === 400
    ? "Votre demande n'a pas pu être validée. Vérifiez votre adresse email."
    : apiErrorMessage(status);
}

// The worker gives an audit 60 s; queue wait comes on top.
export const POLL_TIMEOUT_MS = 180_000;
const POLL_DELAYS_MS = [1500, 2000, 3000, 5000, 8000, 10_000];

export function pollDelayMs(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), POLL_DELAYS_MS.length - 1);
  return POLL_DELAYS_MS[index]!;
}

const FAILURE_MESSAGES: Record<AuditFailureReason, string> = {
  forbidden_url:
    "Cette adresse n'est pas accessible publiquement et ne peut pas être auditée.",
  robots_disallowed:
    "Le fichier robots.txt du site interdit l'analyse automatisée.",
  scan_failed:
    "La page n'a pas pu être analysée (indisponible, trop lente ou refusée).",
};

export type AuditProgress =
  | { phase: "waiting"; message: string }
  | { phase: "done"; message: string }
  | { phase: "failed"; message: string };

export function auditProgress(
  audit: Pick<Audit, "status" | "failureReason">,
): AuditProgress {
  switch (audit.status) {
    case "completed":
      return { phase: "done", message: "Analyse terminée." };
    case "failed":
      return {
        phase: "failed",
        message:
          (audit.failureReason && FAILURE_MESSAGES[audit.failureReason]) ||
          "L'analyse a échoué.",
      };
    case "queued":
      return { phase: "waiting", message: "Analyse en attente de démarrage…" };
    case "running":
      return { phase: "waiting", message: "Analyse en cours…" };
  }
}

const MAX_UTM_PARAMS = 10;
const MAX_UTM_VALUE_LENGTH = 100;

// Campaign attribution for the lead: utm_* only, bounded, nothing else from
// the URL (it could carry personal data).
export function parseUtm(search: string): Record<string, string> {
  const utm: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(search)) {
    if (!key.startsWith("utm_") || key.length > 40) continue;
    if (Object.keys(utm).length >= MAX_UTM_PARAMS) break;
    utm[key] = value.slice(0, MAX_UTM_VALUE_LENGTH);
  }
  return utm;
}

const IMPACT_LABELS: Record<Impact, string> = {
  critical: "Critique",
  serious: "Sérieux",
  moderate: "Modéré",
  minor: "Mineur",
};

export function impactLabel(impact: Impact): string {
  return IMPACT_LABELS[impact];
}

// Links come from the API payload (rule documentation): only http(s) may end
// up in an href, never javascript: or data:.
export function safeHttpUrl(value: string | null): string | null {
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

// Visitors often type "monsite.fr": assume https. Whitespace is never part of
// a valid address (the URL parser would silently percent-encode it).
export function normalizeAuditUrl(raw: string): string | null {
  const value = raw.trim();
  if (value === "" || /\s/.test(value)) return null;
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(value)
    ? value
    : `https://${value}`;
  try {
    const url = new URL(withScheme);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}
