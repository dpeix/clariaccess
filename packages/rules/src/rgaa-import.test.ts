import { describe, expect, it } from "vitest";
import { parseRgaaJson, plainText, wcagCriteriaOf } from "./rgaa-import.js";

// A tiny file in the shape of the official criteres.json.
const criterium = (number: number, extra: Record<string, unknown> = {}) => ({
  criterium: {
    number,
    title: `Titre du critère ${number} avec [un lien](#ancre) et \`code\` ?`,
    tests: { "1": "Test un", "2": ["Test deux", "condition"] },
    references: [
      { wcag: ["9.1.1.1 / 1.1.1 Non-text Content (A)"] },
      { techniques: ["H36"] },
    ],
    ...extra,
  },
});
const topic = (number: number, criteria: number[]) => ({
  topic: `Thème ${number}`,
  number,
  criteria: criteria.map((n) => criterium(n)),
});
const file = <T>(topics: T[]) => ({ wcag: { version: 2.1 }, topics });

// The official file: 13 topics, 106 criteria. Counts per topic as published.
const OFFICIAL_COUNTS = [9, 2, 3, 13, 8, 2, 5, 10, 4, 14, 13, 11, 12];
const official = () =>
  file(
    OFFICIAL_COUNTS.map((count, i) =>
      topic(
        i + 1,
        Array.from({ length: count }, (_, k) => k + 1),
      ),
    ),
  );

describe("plainText", () => {
  it("keeps the words of a markdown link and drops the target", () => {
    expect(
      plainText("Chaque [zone](#zone-x) est [décrite](https://e.fr/a) ?"),
    ).toBe("Chaque zone est décrite ?");
  });

  it("drops code delimiters and collapses spaces", () => {
    expect(plainText('balise `<img>`   ou  `role="img"`')).toBe(
      'balise <img> ou role="img"',
    );
  });
});

describe("wcagCriteriaOf", () => {
  it("extracts the WCAG success criteria numbers from the references", () => {
    expect(
      wcagCriteriaOf([
        {
          wcag: [
            "9.1.1.1 / 1.1.1 Non-text Content (A)",
            "9.1.2.1 / 1.2.1 Audio-only (A)",
          ],
        },
        { techniques: ["H36"] },
      ]),
    ).toEqual(["1.1.1", "1.2.1"]);
  });

  it("returns nothing when a criterion has no WCAG reference", () => {
    expect(wcagCriteriaOf([{ techniques: ["H36"] }])).toEqual([]);
    expect(wcagCriteriaOf(undefined)).toEqual([]);
  });
});

describe("parseRgaaJson", () => {
  it("reads the official shape: 13 topics, 106 criteria", () => {
    const data = parseRgaaJson(official());

    expect(data.themes).toHaveLength(13);
    expect(data.criteria).toHaveLength(106);
  });

  it("identifies a criterion as theme.number and keeps its plain title", () => {
    const data = parseRgaaJson(official());
    const first = data.criteria[0]!;

    expect(first).toMatchObject({
      id: "1.1",
      theme: 1,
      number: 1,
      testCount: 2,
      wcag: ["1.1.1"],
    });
    expect(first.title).toBe("Titre du critère 1 avec un lien et code ?");
    expect(data.criteria.at(-1)?.id).toBe("13.12");
  });

  it("names the themes", () => {
    expect(parseRgaaJson(official()).themes[0]).toEqual({
      number: 1,
      title: "Thème 1",
    });
  });

  it.each([
    [
      "a missing criterion",
      () =>
        file(
          OFFICIAL_COUNTS.map((c, i) =>
            topic(
              i + 1,
              Array.from({ length: i === 0 ? c - 1 : c }, (_, k) => k + 1),
            ),
          ),
        ),
    ],
    ["a missing topic", () => file(official().topics.slice(1))],
    [
      "an extra criterion",
      () =>
        file(
          OFFICIAL_COUNTS.map((c, i) =>
            topic(
              i + 1,
              Array.from({ length: i === 0 ? c + 1 : c }, (_, k) => k + 1),
            ),
          ),
        ),
    ],
  ])("refuses a file with %s", (_label, build) => {
    expect(() => parseRgaaJson(build())).toThrow(/106|13|attendu|expected/i);
  });

  it("refuses duplicate ids", () => {
    const bad = official();
    bad.topics[0]!.criteria[1] = criterium(1) as never;

    expect(() => parseRgaaJson(bad)).toThrow(/doublon|duplicate/i);
  });

  it("refuses a criterion that has no tests", () => {
    const bad = official();
    bad.topics[0]!.criteria[0] = criterium(1, { tests: {} }) as never;

    expect(() => parseRgaaJson(bad)).toThrow(/test/i);
  });

  it.each([null, "x", 3, {}, { topics: "no" }, { topics: [{}] }])(
    "refuses an input that is not the official shape: %j",
    (input) => {
      expect(() => parseRgaaJson(input)).toThrow();
    },
  );
});
