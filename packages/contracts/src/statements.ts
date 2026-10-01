// What an accessibility statement needs before it may be published. Shared by
// the API (which refuses an incomplete one) and the app (which tells the user
// what is missing as they type).
export const REQUIRED_STATEMENT_FIELDS = [
  "entityName",
  "contact",
  "samplePages",
  "technologies",
  "testEnvironment",
  "tools",
] as const;

export type RequiredStatementField = (typeof REQUIRED_STATEMENT_FIELDS)[number];

export interface StatementFields {
  entityName: string | null;
  contactEmail: string | null;
  contactUrl: string | null;
  samplePages: readonly string[];
  technologies: string | null;
  testEnvironment: string | null;
  tools: string | null;
}

const blank = (value: string | null) => value === null || value.trim() === "";

export function missingStatementFields(
  fields: StatementFields,
): RequiredStatementField[] {
  const missing: RequiredStatementField[] = [];
  if (blank(fields.entityName)) missing.push("entityName");
  // One way to reach the publisher is enough: an email or a contact page.
  if (blank(fields.contactEmail) && blank(fields.contactUrl)) {
    missing.push("contact");
  }
  if (fields.samplePages.length === 0) missing.push("samplePages");
  if (blank(fields.technologies)) missing.push("technologies");
  if (blank(fields.testEnvironment)) missing.push("testEnvironment");
  if (blank(fields.tools)) missing.push("tools");
  return missing;
}
