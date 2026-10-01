// Messages shown to the public (the statement page) and shared by screens.
// Every text sits behind a key so a second language is a second dictionary, not
// a rewrite of the templates. Only French is offered today.
//
// Legal wording stays generic on purpose ("RGAA 4.1", no article number): the
// applicable legal reference depends on the publisher and must not be asserted
// by the tool.

export const MESSAGES_FR = {
  "statement.title": "Déclaration d'accessibilité",
  "statement.commitment":
    "{entity} s'engage à rendre son site {site} accessible.",
  "statement.intro": "Cette déclaration d'accessibilité s'applique à {site}.",

  "statement.compliance.heading": "État de conformité",
  "statement.compliance.level":
    "{site} est {level} avec le RGAA version {version}.",
  "statement.compliance.undetermined":
    "Le niveau de conformité n'est pas établi.",

  "statement.results.heading": "Résultats des tests",
  "statement.results.rate":
    "L'audit de conformité révèle que {rate} % des critères applicables du RGAA {version} sont respectés.",
  "statement.results.counts":
    "{conforme} critère(s) conforme(s), {nonConforme} non conforme(s), {na} non applicable(s).",
  "statement.results.rounded": "Le taux est arrondi à l'entier inférieur.",

  "statement.nonaccessible.heading": "Contenus non accessibles",
  "statement.nonaccessible.none":
    "Aucun contenu non accessible n'a été identifié lors de l'audit.",
  "statement.nonaccessible.caption":
    "Critères du RGAA non respectés lors de l'audit",
  "statement.nonaccessible.criterion": "Critère",
  "statement.nonaccessible.detail": "Constat",
  "statement.nonaccessible.origin": "Origine du constat",
  "statement.nonaccessible.source.manual": "Vérification manuelle",
  "statement.nonaccessible.source.auto": "Test automatisé",

  "statement.derogations.heading": "Dérogations pour charge disproportionnée",
  "statement.derogations.none": "Aucune dérogation n'est invoquée.",

  "statement.establishment.heading": "Établissement de cette déclaration",
  "statement.establishment.date": "Cette déclaration a été établie le {date}.",
  "statement.establishment.version": "Version {version} de la déclaration.",

  "statement.technologies.heading":
    "Technologies utilisées pour la réalisation du site",
  "statement.environment.heading": "Environnement de test",
  "statement.tools.heading": "Outils pour évaluer l'accessibilité",
  "statement.sample.heading":
    "Pages du site ayant fait l'objet de la vérification",

  "statement.contact.heading": "Retour d'information et contact",
  "statement.contact.text":
    "Si vous n'arrivez pas à accéder à un contenu ou à un service, vous pouvez contacter {entity} pour être orienté vers une alternative accessible ou obtenir le contenu sous une autre forme.",
  "statement.contact.email": "Courriel : {email}",
  "statement.contact.url": "Formulaire ou page de contact :",

  "statement.recourse.heading": "Voies de recours",
  "statement.recourse.text":
    "Si vous constatez un défaut d'accessibilité vous empêchant d'accéder à un contenu ou une fonctionnalité du site, que vous nous le signalez et que vous n'obtenez pas de réponse satisfaisante, vous êtes en droit de faire parvenir vos doléances ou une demande de saisine au Défenseur des droits.",

  "statement.superseded":
    "Cette version de la déclaration a été remplacée : elle n'est plus à jour.",
  "statement.superseded.link": "Voir la déclaration en vigueur.",

  "statement.pdf.link": "Télécharger cette déclaration au format PDF",
  "statement.footer":
    "Déclaration établie par l'éditeur du site à partir d'un audit ; elle n'engage pas l'outil qui a aidé à la rédiger.",

  "level.total": "totalement conforme",
  "level.partiel": "partiellement conforme",
  "level.non": "non conforme",
} as const;

export type MessageKey = keyof typeof MESSAGES_FR;
export type Locale = "fr";

export const DEFAULT_LOCALE: Locale = "fr";
const DICTIONARIES: Record<Locale, Record<MessageKey, string>> = {
  fr: MESSAGES_FR,
};

export function isLocale(value: string): value is Locale {
  return Object.hasOwn(DICTIONARIES, value);
}

// Replaces {name} with params[name], in one pass: a value that contains
// braces is not substituted again. A missing value leaves the placeholder
// visible, which is easier to notice than "undefined".
export function t(
  locale: Locale,
  key: MessageKey,
  params: Record<string, string | number> = {},
): string {
  const dictionary = isLocale(locale)
    ? DICTIONARIES[locale]
    : DICTIONARIES[DEFAULT_LOCALE];
  return dictionary[key].replace(
    /\{([a-zA-Z]+)\}/g,
    (placeholder, name: string) =>
      Object.hasOwn(params, name) ? String(params[name]) : placeholder,
  );
}
