import type { AuditReport, Impact } from "@accessibility/contracts";
import type { MailMessage } from "./mailer.js";

// The email is a teaser: the full report lives behind the link.
const MAX_LISTED_GROUPS = 5;

// Fixed on purpose: nothing from the audited site may reach a header.
const SUBJECT = "Votre rapport d'audit d'accessibilité";

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

export function renderReportEmail(
  report: AuditReport,
  reportUrl: string,
): Pick<MailMessage, "subject" | "text" | "html"> {
  const score = report.audit.score;
  const intro = `Score automatisé : ${score ?? "non disponible"}/100 (${report.totalIssues} problème(s) détecté(s)).`;
  const listed = report.groups.slice(0, MAX_LISTED_GROUPS);
  const lines = listed.map(
    (group) =>
      `${group.title} — ${IMPACT_LABEL[group.impact]}, ${group.occurrences} occurrence(s)`,
  );
  const noIssue = "Aucun problème détecté automatiquement sur cette page.";
  const heading = listed.length > 0 ? "Problèmes les plus urgents :" : noIssue;

  const text = [
    "Bonjour,",
    "",
    intro,
    "",
    heading,
    ...lines.map((line) => `- ${line}`),
    "",
    `Rapport complet : ${reportUrl}`,
    "",
    report.automatedCoverageNotice,
  ].join("\n");

  const html = [
    "<p>Bonjour,</p>",
    `<p>${escapeHtml(intro)}</p>`,
    `<p>${escapeHtml(heading)}</p>`,
    listed.length > 0
      ? `<ul>${lines.map((line) => `<li>${escapeHtml(line)}</li>`).join("")}</ul>`
      : "",
    `<p><a href="${escapeHtml(reportUrl)}">Voir le rapport complet</a><br>${escapeHtml(reportUrl)}</p>`,
    `<p><small>${escapeHtml(report.automatedCoverageNotice)}</small></p>`,
  ].join("\n");

  return { subject: SUBJECT, text, html };
}
