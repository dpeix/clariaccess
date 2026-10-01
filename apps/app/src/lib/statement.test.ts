import { describe, expect, it } from "vitest";
import {
  complianceExplanation,
  criteriaOfTheme,
  fieldLabel,
  levelLabel,
  manualStatusLabel,
  parseSamplePages,
  progressLabel,
  samplePagesText,
  statementStatusLabel,
  visibleCriteria,
} from "./statement.js";

const criterion = (
  id: string,
  theme: number,
  status: "ok" | "ko" | "na" | null = null,
  autoProblems = 0,
) => ({
  id,
  theme,
  title: `Critère ${id} ?`,
  autoTested: false,
  axeRules: [],
  autoProblems,
  check:
    status === null
      ? null
      : {
          status,
          notes: "",
          evidenceUrl: null,
          checkedBy: null,
          checkedAt: "2026-10-02T10:00:00.000Z",
        },
});

describe("labels", () => {
  it("names the manual statuses", () => {
    expect(manualStatusLabel("ok")).toBe("Conforme");
    expect(manualStatusLabel("ko")).toBe("Non conforme");
    expect(manualStatusLabel("na")).toBe("Non applicable");
  });

  it("names the levels, including the one that cannot be declared", () => {
    expect(levelLabel("total")).toBe("Totalement conforme");
    expect(levelLabel("partiel")).toBe("Partiellement conforme");
    expect(levelLabel("non")).toBe("Non conforme");
    expect(levelLabel("indetermine")).toBe("Non établi");
  });

  it("names statement states and required fields", () => {
    expect(statementStatusLabel("draft")).toBe("Brouillon");
    expect(statementStatusLabel("published")).toBe("Publiée");
    expect(statementStatusLabel("superseded")).toBe("Remplacée");
    expect(fieldLabel("contact")).toMatch(/contact/i);
    expect(fieldLabel("samplePages")).toMatch(/pages/i);
    expect(fieldLabel("unknown-field")).toBe("unknown-field");
  });
});

describe("progressLabel", () => {
  it("says how many criteria are checked, with the plural", () => {
    expect(progressLabel({ checked: 0, total: 106 })).toBe(
      "0 critère vérifié sur 106",
    );
    expect(progressLabel({ checked: 1, total: 106 })).toBe(
      "1 critère vérifié sur 106",
    );
    expect(progressLabel({ checked: 12, total: 106 })).toBe(
      "12 critères vérifiés sur 106",
    );
  });
});

describe("criteria views", () => {
  const all = [
    criterion("1.1", 1, "ok"),
    criterion("1.2", 1),
    criterion("2.1", 2, "ko"),
    criterion("3.1", 3, "na"),
    criterion("3.2", 3, "ok", 2),
  ];

  it("selects the criteria of a theme, in order", () => {
    expect(criteriaOfTheme(all, 1).map((c) => c.id)).toEqual(["1.1", "1.2"]);
    expect(criteriaOfTheme(all, 9)).toEqual([]);
  });

  it("filters to what still needs a person", () => {
    expect(visibleCriteria(all, "all").map((c) => c.id)).toEqual([
      "1.1",
      "1.2",
      "2.1",
      "3.1",
      "3.2",
    ]);
    expect(visibleCriteria(all, "todo").map((c) => c.id)).toEqual(["1.2"]);
    expect(visibleCriteria(all, "ko").map((c) => c.id)).toEqual(["2.1"]);
  });

  it("counts a criterion contradicted by the scan among the problems to look at", () => {
    expect(visibleCriteria(all, "problems").map((c) => c.id)).toEqual([
      "2.1",
      "3.2",
    ]);
  });
});

describe("sample pages", () => {
  it("reads one address per line, ignoring blanks and duplicates", () => {
    expect(
      parseSamplePages(" https://a.fr/ \n\nhttps://b.fr/\nhttps://a.fr/\n"),
    ).toEqual(["https://a.fr/", "https://b.fr/"]);
  });

  it("writes them back one per line", () => {
    expect(samplePagesText(["https://a.fr/", "https://b.fr/"])).toBe(
      "https://a.fr/\nhttps://b.fr/",
    );
    expect(samplePagesText([])).toBe("");
  });
});

describe("complianceExplanation", () => {
  const counts = { conforme: 90, nonConforme: 10, na: 3, aVerifier: 3 };

  it("says why nothing can be declared while criteria are unchecked", () => {
    expect(complianceExplanation("indetermine", counts, 0)).toMatch(
      /3 critères restent à vérifier/,
    );
  });

  it("uses the singular for a single remaining criterion", () => {
    expect(
      complianceExplanation("indetermine", { ...counts, aVerifier: 1 }, 0),
    ).toMatch(/1 critère reste à vérifier/);
  });

  it("explains each level in words", () => {
    const done = { ...counts, aVerifier: 0 };
    expect(
      complianceExplanation("total", { ...done, nonConforme: 0 }, 0),
    ).toMatch(/tous les critères applicables/i);
    expect(complianceExplanation("partiel", done, 0)).toMatch(
      /10 critères non conformes/,
    );
    expect(complianceExplanation("non", { ...done, conforme: 0 }, 0)).toMatch(
      /aucun critère/i,
    );
  });

  it("mentions problems that cannot be placed on a criterion", () => {
    expect(
      complianceExplanation("partiel", { ...counts, aVerifier: 0 }, 2),
    ).toMatch(/2 problèmes/);
  });
});
