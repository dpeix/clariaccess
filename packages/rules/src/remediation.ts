export interface RemediationGuide {
  summary: string;
  steps: string[];
  // True when there is no written advice for this rule: the steps only point
  // to the rule's documentation.
  generic: boolean;
}

type Entry = { summary: string; steps: string[] };

// Written advice for the rules that come up most often. Short and practical:
// what is wrong, and what to change. WCAG/RGAA references come from the rule
// table, not from here, so they cannot drift apart.
const GUIDES: Record<string, Entry> = {
  "image-alt": {
    summary:
      "Une image informative n'a pas d'alternative textuelle : un lecteur d'écran ne peut pas en transmettre le sens.",
    steps: [
      "Ajoutez un attribut alt qui décrit l'information portée par l'image, pas son apparence.",
      'Pour une image purement décorative, utilisez alt="" afin qu\'elle soit ignorée.',
      "Pour une image qui est un lien ou un bouton, l'alternative décrit la destination ou l'action.",
    ],
  },
  "color-contrast": {
    summary:
      "Le contraste entre le texte et son fond est trop faible pour être lu confortablement.",
    steps: [
      "Visez un rapport d'au moins 4,5:1 pour le texte courant et 3:1 pour le texte large (18 pt, ou 14 pt en gras).",
      "Vérifiez les couleurs avec un outil de mesure de contraste et ajustez la couleur du texte ou du fond.",
      "Ne comptez pas sur la couleur seule pour transmettre une information : ajoutez un texte ou un symbole.",
    ],
  },
  label: {
    summary:
      "Un champ de formulaire n'a pas d'étiquette associée : son rôle est inconnu des utilisateurs de technologies d'assistance.",
    steps: [
      "Associez un élément label au champ avec for/id, ou entourez le champ par le label.",
      "Si un libellé visible est impossible, utilisez aria-label ou aria-labelledby avec un texte explicite.",
      "Un placeholder seul n'est pas une étiquette : il disparaît à la saisie.",
    ],
  },
  "link-name": {
    summary:
      "Un lien n'a pas d'intitulé accessible : on ne sait pas où il mène.",
    steps: [
      "Donnez au lien un texte qui décrit sa destination (évitez « cliquez ici »).",
      "Pour un lien qui ne contient qu'une icône ou une image, fournissez un texte alternatif ou un aria-label.",
    ],
  },
  "button-name": {
    summary:
      "Un bouton n'a pas d'intitulé accessible : son action est inconnue des utilisateurs de lecteurs d'écran.",
    steps: [
      "Mettez un texte qui décrit l'action dans le bouton, ou un aria-label si le bouton n'affiche qu'une icône.",
      "Pour un bouton constitué d'une image, donnez à l'image une alternative qui décrit l'action.",
    ],
  },
  "html-has-lang": {
    summary:
      "La langue de la page n'est pas déclarée : la synthèse vocale risque de lire le contenu avec le mauvais accent.",
    steps: [
      "Ajoutez l'attribut lang sur l'élément html, par exemple lang=\"fr\".",
      "Si une partie du contenu est dans une autre langue, indiquez-la avec lang sur l'élément concerné.",
    ],
  },
  "document-title": {
    summary:
      "La page n'a pas de titre : c'est la première chose annoncée et ce qui identifie l'onglet.",
    steps: [
      "Ajoutez un élément title non vide dans le head.",
      "Rédigez un titre propre à chaque page, qui commence par ce qui la distingue des autres.",
    ],
  },
  "heading-order": {
    summary:
      "Les niveaux de titres sautent (par exemple un h2 suivi d'un h4) : la structure de la page devient difficile à suivre.",
    steps: [
      "Faites suivre chaque titre d'un titre du même niveau ou du niveau immédiatement inférieur.",
      "Choisissez le niveau d'après la structure du contenu, pas d'après la taille de police souhaitée : le style se règle en CSS.",
    ],
  },
  region: {
    summary:
      "Du contenu se trouve hors de toute zone repérable (header, nav, main, footer) : la navigation par régions est incomplète.",
    steps: [
      "Placez le contenu principal dans un élément main, la navigation dans nav, l'en-tête dans header et le pied de page dans footer.",
      "Donnez un nom (aria-label) aux zones présentes en plusieurs exemplaires, comme plusieurs nav.",
    ],
  },
  "aria-allowed-attr": {
    summary:
      "Un attribut ARIA est utilisé sur un rôle qui ne le prend pas en charge : il est ignoré ou trompeur.",
    steps: [
      "Retirez l'attribut, ou changez le rôle de l'élément pour celui qui le supporte.",
      "Préférez l'élément HTML natif adapté (button, input, nav) à un rôle ARIA : il porte déjà les bons attributs.",
    ],
  },
  "aria-required-attr": {
    summary:
      "Un rôle ARIA est utilisé sans les attributs obligatoires : son état n'est pas exposé.",
    steps: [
      "Ajoutez les attributs requis par le rôle (par exemple aria-checked pour role=checkbox).",
      "Ou utilisez l'élément HTML natif équivalent, qui expose son état sans attribut supplémentaire.",
    ],
  },
  "aria-valid-attr-value": {
    summary:
      "Un attribut ARIA a une valeur invalide, par exemple une référence vers un identifiant qui n'existe pas.",
    steps: [
      "Corrigez la valeur selon les valeurs permises par l'attribut.",
      "Pour aria-labelledby ou aria-describedby, vérifiez que chaque identifiant cité existe bien dans la page.",
    ],
  },
  "aria-hidden-focus": {
    summary:
      "Un élément masqué aux technologies d'assistance (aria-hidden) contient des éléments qui prennent encore le focus clavier.",
    steps: [
      'Retirez aria-hidden de la zone, ou rendez ses éléments non focalisables (tabindex="-1", disabled).',
      "Pour un contenu masqué à l'écran, préférez hidden ou display: none, qui le retirent aussi du clavier.",
    ],
  },
  "frame-title": {
    summary:
      "Un cadre (iframe) n'a pas de titre : on ne peut pas savoir ce qu'il contient avant d'y entrer.",
    steps: [
      "Ajoutez un attribut title qui décrit le contenu du cadre.",
      "Si le cadre est purement technique et sans contenu, retirez-le ou masquez-le avec aria-hidden.",
    ],
  },
  "duplicate-id-aria": {
    summary:
      "Un même identifiant est utilisé plusieurs fois et référencé par ARIA : la référence pointe vers le mauvais élément.",
    steps: [
      "Rendez chaque identifiant unique dans la page.",
      "Vérifiez les composants répétés (cartes, lignes de liste) dont l'identifiant est copié tel quel.",
    ],
  },
  "meta-viewport": {
    summary:
      "La balise viewport empêche d'agrandir la page : les personnes malvoyantes ne peuvent pas zoomer.",
    steps: [
      "Retirez user-scalable=no et tout maximum-scale inférieur à 5 de la balise meta viewport.",
      "Testez la page agrandie à 200 % : le contenu doit rester lisible et utilisable.",
    ],
  },
  "select-name": {
    summary:
      "Une liste déroulante n'a pas d'étiquette associée : son rôle est inconnu des technologies d'assistance.",
    steps: [
      "Associez-lui un élément label avec for/id.",
      "À défaut, utilisez aria-label ou aria-labelledby avec un texte explicite.",
    ],
  },
  list: {
    summary:
      "Une liste contient des éléments qui ne sont pas des éléments de liste : sa structure n'est pas annoncée correctement.",
    steps: [
      "Ne placez que des éléments li directement dans un ul ou un ol.",
      "Si les éléments ne forment pas une liste, n'utilisez pas ul/ol pour la mise en forme : appliquez du CSS.",
    ],
  },
  listitem: {
    summary:
      "Un élément li se trouve hors d'une liste : son rôle d'élément de liste est perdu.",
    steps: [
      "Placez chaque li dans un ul ou un ol.",
      "Si ce n'est pas une liste, remplacez li par un élément adapté.",
    ],
  },
};

export const GUIDED_RULE_IDS: readonly string[] = Object.keys(GUIDES);

// The id comes from scan results: only own keys of the table are trusted.
export function remediationGuide(ruleId: string): RemediationGuide {
  if (Object.hasOwn(GUIDES, ruleId)) {
    const entry = GUIDES[ruleId];
    if (entry !== undefined) return { ...entry, generic: false };
  }
  return {
    summary:
      "Ce type de problème n'a pas encore de fiche de correction rédigée dans l'outil.",
    steps: [
      "Consultez la documentation de la règle (lien « Comment corriger » du rapport d'audit).",
      "Corrigez les éléments listés, puis relancez un audit pour vérifier.",
    ],
    generic: true,
  };
}
