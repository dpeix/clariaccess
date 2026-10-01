// Error answers of the API carry a message written for the user: show it. The
// status-based text is only for answers without one (proxy errors, crashes).
export function errorMessage(
  status: number | "network",
  body: unknown,
): string {
  const message =
    typeof body === "object" && body !== null
      ? (body as { message?: unknown }).message
      : undefined;
  if (typeof message === "string" && message !== "") return message;

  if (status === "network") {
    return "Impossible de joindre le service. Vérifiez votre connexion puis réessayez.";
  }
  if (status === 400)
    return "La demande est invalide. Vérifiez les informations saisies.";
  if (status === 401)
    return "Votre session a expiré. Connectez-vous à nouveau.";
  if (status === 404) return "Élément introuvable.";
  if (status === 429)
    return "Trop de demandes pour le moment. Réessayez dans un moment.";
  if (status >= 500) {
    return "Le service rencontre un problème momentané. Réessayez dans quelques minutes.";
  }
  return "Une erreur est survenue. Réessayez.";
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
