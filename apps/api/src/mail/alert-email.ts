import type { Impact } from "@accessibility/contracts";
import type { AlertSummary } from "../alerts/summary.js";
import type { MailMessage } from "./mailer.js";

// Fixed on purpose: nothing from the audited site may reach a header.
const SUBJECT = "Alerte d'accessibilité : nouveaux problèmes détectés";

const IMPACT_LABEL: Record<Impact, string> = {
  critical: "critique",
  serious: "sérieux",
  moderate: "modéré",
  minor: "mineur",
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function counts(summary: AlertSummary): string[] {
  const lines: string[] = [];
  if (summary.regressions > 0) {
    const n = summary.regressions;
    lines.push(
      `${n} régression${n > 1 ? "s" : ""} (un problème corrigé est revenu)`,
    );
  }
  if (summary.newSevere > 0) {
    const n = summary.newSevere;
    lines.push(
      `${n} nouveau${n > 1 ? "x" : ""} problème${n > 1 ? "s" : ""} sérieux ou critique${n > 1 ? "s" : ""}`,
    );
  }
  return lines;
}

export function renderAlertEmail(
  siteUrl: string,
  summary: AlertSummary,
  auditLink: string,
): Pick<MailMessage, "subject" | "text" | "html"> {
  const intro = `Le dernier audit programmé de ${siteUrl} a détecté :`;
  const lines = counts(summary);
  const items = summary.top.map(
    (f) =>
      `${f.kind === "regression" ? "Régression" : "Nouveau"} · ${IMPACT_LABEL[f.impact]} · ${f.ruleId} · ${f.pageUrl}${f.count > 1 ? ` (${f.count} éléments)` : ""}`,
  );
  const notice =
    "Cet audit est automatisé : il ne couvre qu'une partie des critères et ne vaut pas déclaration de conformité.";

  const text = [
    "Bonjour,",
    "",
    intro,
    ...lines.map((line) => `- ${line}`),
    "",
    "Les plus urgents :",
    ...items.map((item) => `- ${item}`),
    "",
    `Voir l'audit : ${auditLink}`,
    "",
    notice,
  ].join("\n");

  const html = [
    "<p>Bonjour,</p>",
    `<p>${escapeHtml(intro)}</p>`,
    `<ul>${lines.map((l) => `<li>${escapeHtml(l)}</li>`).join("")}</ul>`,
    "<p>Les plus urgents :</p>",
    `<ul>${items.map((i) => `<li>${escapeHtml(i)}</li>`).join("")}</ul>`,
    `<p><a href="${escapeHtml(auditLink)}">Voir l'audit</a><br>${escapeHtml(auditLink)}</p>`,
    `<p><small>${escapeHtml(notice)}</small></p>`,
  ].join("\n");

  return { subject: SUBJECT, text, html };
}
