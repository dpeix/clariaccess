import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import {
  KNOWN_UNMAPPED,
  MAPPED_AXE_RULE_IDS,
  RULES_VERSION,
  lookupAxeRule,
} from "@accessibility/rules";
import type { Database } from "./client.js";
import { rules } from "./schema.js";

const migrationsFolder = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function runMigrations(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}

type RuleRow = typeof rules.$inferInsert;

function ruleRows(): RuleRow[] {
  const mapped = MAPPED_AXE_RULE_IDS.map((axeRuleId): RuleRow => {
    const lookup = lookupAxeRule(axeRuleId);
    if (lookup.status !== "mapped") {
      throw new Error(`Rule ${axeRuleId} is listed but not mapped`);
    }
    return {
      id: axeRuleId,
      source: "axe",
      wcagCriteria: lookup.wcagCriteria,
      rgaaCriteria: lookup.rgaaCriteria,
      en301549Clauses: lookup.en301549Clauses,
      level: lookup.level,
      rulesVersion: RULES_VERSION,
    };
  });
  // Best-practice rules still produce issues, so they must exist in `rules`.
  const unmapped = KNOWN_UNMAPPED.map((axeRuleId): RuleRow => ({
    id: axeRuleId,
    source: "axe",
    wcagCriteria: [],
    rgaaCriteria: [],
    en301549Clauses: [],
    level: null,
    rulesVersion: RULES_VERSION,
  }));
  return [...mapped, ...unmapped];
}

// Re-seeding refreshes existing rows when the mapping table changes.
const sqlExcluded = (column: string) => sql.raw(`excluded."${column}"`);

export async function seedRules(db: Database): Promise<void> {
  await db
    .insert(rules)
    .values(ruleRows())
    .onConflictDoUpdate({
      target: rules.id,
      set: {
        source: sqlExcluded("source"),
        wcagCriteria: sqlExcluded("wcag_criteria"),
        rgaaCriteria: sqlExcluded("rgaa_criteria"),
        en301549Clauses: sqlExcluded("en301549_clauses"),
        level: sqlExcluded("level"),
        rulesVersion: sqlExcluded("rules_version"),
      },
    });
}
