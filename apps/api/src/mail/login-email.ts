import type { MailMessage } from "./mailer.js";

// Fixed on purpose: nothing variable may reach a header.
const SUBJECT = "Votre lien de connexion";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function renderLoginEmail(
  link: string,
): Pick<MailMessage, "subject" | "text" | "html"> {
  const text = [
    "Bonjour,",
    "",
    `Pour vous connecter, ouvrez ce lien : ${link}`,
    "",
    "Il est valable 15 minutes et ne peut servir qu'une fois.",
    "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.",
  ].join("\n");
  const html = [
    "<p>Bonjour,</p>",
    `<p><a href="${escapeHtml(link)}">Se connecter</a></p>`,
    "<p>Ce lien est valable 15 minutes et ne peut servir qu'une fois.<br>Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p>",
  ].join("\n");
  return { subject: SUBJECT, text, html };
}
