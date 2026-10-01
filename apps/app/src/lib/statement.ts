import type {
  ComplianceStatus,
  ComputedComplianceStatus,
  ManualCheckList,
  ManualStatus,
  StatementStatus,
} from "@accessibility/contracts";

type CriterionView = ManualCheckList["criteria"][number];

const MANUAL: Record<ManualStatus, string> = {
  ok: "Conforme",
  ko: "Non conforme",
  na: "Non applicable",
};
const LEVEL: Record<ComputedComplianceStatus, string> = {
  total: "Totalement conforme",
  partiel: "Partiellement conforme",
  non: "Non conforme",
  indetermine: "Non établi",
};
const STATEMENT: Record<StatementStatus, string> = {
  draft: "Brouillon",
  published: "Publiée",
  superseded: "Remplacée",
};
const FIELDS: Record<string, string> = {
  entityName: "Nom de l'éditeur",
  contact: "Contact (courriel ou page de contact)",
  samplePages: "Pages vérifiées",
  technologies: "Technologies utilisées",
  testEnvironment: "Environnement de test",
  tools: "Outils d'évaluation",
};

export const manualStatusLabel = (s: ManualStatus) => MANUAL[s];
export const levelLabel = (s: ComputedComplianceStatus) => LEVEL[s];
export const statementStatusLabel = (s: StatementStatus) => STATEMENT[s];
export const fieldLabel = (field: string) => FIELDS[field] ?? field;
export type { ComplianceStatus };

export function progressLabel(progress: {
  checked: number;
  total: number;
}): string {
  const n = progress.checked;
  return `${n} critère${n > 1 ? "s" : ""} vérifié${n > 1 ? "s" : ""} sur ${progress.total}`;
}

export function criteriaOfTheme(
  criteria: CriterionView[],
  theme: number,
): CriterionView[] {
  return criteria.filter((c) => c.theme === theme);
}

export type CriteriaFilter = "all" | "todo" | "ko" | "problems";

// "problems": what a person should look at again: failed criteria, and ones
// marked compliant that the scan still reports problems on.
export function visibleCriteria(
  criteria: CriterionView[],
  filter: CriteriaFilter,
): CriterionView[] {
  switch (filter) {
    case "todo":
      return criteria.filter((c) => c.check === null);
    case "ko":
      return criteria.filter((c) => c.check?.status === "ko");
    case "problems":
      return criteria.filter(
        (c) => c.check?.status === "ko" || c.autoProblems > 0,
      );
    default:
      return criteria;
  }
}

export function parseSamplePages(text: string): string[] {
  return [
    ...new Set(
      text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line !== ""),
    ),
  ];
}

export const samplePagesText = (pages: readonly string[]): string =>
  pages.join("\n");

const plural = (n: number, one: string, many: string) =>
  `${n} ${n > 1 ? many : one}`;

export function complianceExplanation(
  status: ComputedComplianceStatus,
  counts: {
    conforme: number;
    nonConforme: number;
    na: number;
    aVerifier: number;
  },
  unattributed: number,
): string {
  const extra =
    unattributed > 0
      ? ` ${plural(unattributed, "problème détecté automatiquement ne peut pas être rattaché", "problèmes détectés automatiquement ne peuvent pas être rattachés")} à un critère du RGAA.`
      : "";
  if (status === "indetermine") {
    const remaining =
      counts.aVerifier === 1
        ? "1 critère reste à vérifier"
        : `${counts.aVerifier} critères restent à vérifier`;
    return counts.aVerifier > 0
      ? `Aucun niveau de conformité ne peut être affirmé : ${remaining}.${extra}`
      : `Aucun critère applicable n'est vérifié : aucun niveau de conformité ne peut être affirmé.${extra}`;
  }
  if (status === "total")
    return `Tous les critères applicables sont vérifiés conformes.${extra}`;
  if (status === "non")
    return `Aucun critère applicable n'est conforme.${extra}`;
  return `${plural(counts.nonConforme, "critère non conforme", "critères non conformes")} sur ${counts.conforme + counts.nonConforme} applicables.${extra}`;
}
