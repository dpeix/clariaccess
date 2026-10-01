export type Audience = "consumers" | "businesses" | "both";
export type Offer =
  | "ecommerce"
  | "banking"
  | "transport"
  | "telecom"
  | "media"
  | "ebooks"
  | "hardware"
  | "other";
// "micro": fewer than 10 people and turnover or balance sheet of at most
// 2 M EUR (the directive's microenterprise definition).
export type Size = "micro" | "larger";

export interface EaaAnswers {
  audience: Audience;
  offer: Offer;
  size: Size;
}

export type Verdict = "concerned" | "likely_exempt" | "likely_not_concerned";

export interface EaaAssessment {
  verdict: Verdict;
  title: string;
  explanation: string;
  caveat: string;
}

// Shown with every result: this is orientation, not legal advice, and the
// national transposition has details a three-question form cannot capture.
const CAVEAT =
  "Ce résultat est une orientation générale, pas un avis juridique : la transposition nationale et votre situation exacte peuvent changer la réponse.";

export function assessEaa({
  audience,
  offer,
  size,
}: EaaAnswers): EaaAssessment {
  if (audience === "businesses" || offer === "other") {
    return {
      verdict: "likely_not_concerned",
      title: "Probablement pas concerné directement",
      explanation:
        "L'EAA vise les produits et services destinés aux consommateurs dans des familles précises. Vous pouvez néanmoins être soumis à d'autres obligations (secteur public, grands comptes qui exigent l'accessibilité de leurs prestataires) : vérifiez vos contrats.",
      caveat: CAVEAT,
    };
  }
  // The microenterprise exemption covers services, not products.
  if (size === "micro" && offer !== "hardware") {
    return {
      verdict: "likely_exempt",
      title: "Probablement exempté (microentreprise de services)",
      explanation:
        "Les microentreprises qui fournissent des services sont exemptées des exigences de l'EAA. Rendre votre site accessible reste utile : c'est un critère de qualité, d'audience et parfois de contrat.",
      caveat: CAVEAT,
    };
  }
  return {
    verdict: "concerned",
    title: "Probablement concerné",
    explanation:
      "Votre offre entre dans une famille de produits ou services visée par l'EAA, applicable depuis le 28 juin 2025. Un audit de votre site est un bon point de départ pour mesurer l'écart.",
    caveat: CAVEAT,
  };
}
