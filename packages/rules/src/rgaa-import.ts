// Reading of the official RGAA file (DISIC/RGAA, v4.1/JSON/criteres.json).
// Pure and strict: the generated reference is only as trustworthy as these
// checks, so anything that does not look like the published file is refused.

export interface RgaaTheme {
  number: number;
  title: string;
}

export interface RgaaCriterion {
  // "theme.number", as the RGAA cites it (e.g. "1.1", "11.9").
  id: string;
  theme: number;
  number: number;
  title: string;
  testCount: number;
  // WCAG success criteria the RGAA criterion refers to.
  wcag: string[];
}

export interface RgaaData {
  themes: RgaaTheme[];
  criteria: RgaaCriterion[];
}

export const EXPECTED_THEMES = 13;
export const EXPECTED_CRITERIA = 106;

// The official titles carry markdown (links to the glossary, code spans): the
// reference keeps plain text.
export function plainText(markdown: string): string {
  return markdown
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// References look like "9.1.1.1 / 1.1.1 Non-text Content (A)": the second
// number is the WCAG success criterion.
export function wcagCriteriaOf(references: unknown): string[] {
  if (!Array.isArray(references)) return [];
  const found: string[] = [];
  for (const reference of references) {
    const list = (reference as { wcag?: unknown } | null)?.wcag;
    if (!Array.isArray(list)) continue;
    for (const entry of list) {
      const match = /\/\s*(\d+\.\d+\.\d+)\b/.exec(String(entry));
      if (match?.[1] !== undefined && !found.includes(match[1])) {
        found.push(match[1]);
      }
    }
  }
  return found;
}

const fail = (message: string): never => {
  throw new Error(`RGAA file refused: ${message}`);
};

export function parseRgaaJson(input: unknown): RgaaData {
  const topics = (input as { topics?: unknown } | null)?.topics;
  if (!Array.isArray(topics)) return fail("no topics list");

  const themes: RgaaTheme[] = [];
  const criteria: RgaaCriterion[] = [];
  const seen = new Set<string>();

  for (const topic of topics as Record<string, unknown>[]) {
    const number = topic?.["number"];
    const title = topic?.["topic"];
    const list = topic?.["criteria"];
    if (
      !Number.isInteger(number) ||
      typeof title !== "string" ||
      !Array.isArray(list)
    ) {
      return fail("a topic has no number, title or criteria");
    }
    themes.push({ number: number as number, title: plainText(title) });

    for (const item of list as { criterium?: Record<string, unknown> }[]) {
      const c = item?.criterium;
      const n = c?.["number"];
      const t = c?.["title"];
      const tests = c?.["tests"];
      if (
        !Number.isInteger(n) ||
        typeof t !== "string" ||
        typeof tests !== "object" ||
        tests === null
      ) {
        return fail(`a criterion of theme ${String(number)} is malformed`);
      }
      const testCount = Object.keys(tests).length;
      const id = `${String(number)}.${String(n)}`;
      if (testCount === 0) return fail(`criterion ${id} has no test`);
      if (seen.has(id)) return fail(`duplicate criterion ${id}`);
      seen.add(id);
      criteria.push({
        id,
        theme: number as number,
        number: n as number,
        title: plainText(t),
        testCount,
        wcag: wcagCriteriaOf(c?.["references"]),
      });
    }
  }

  if (themes.length !== EXPECTED_THEMES) {
    return fail(`expected ${EXPECTED_THEMES} themes, found ${themes.length}`);
  }
  if (criteria.length !== EXPECTED_CRITERIA) {
    return fail(
      `expected ${EXPECTED_CRITERIA} criteria, found ${criteria.length}`,
    );
  }
  return { themes, criteria };
}
