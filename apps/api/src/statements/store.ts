import { randomInt } from "node:crypto";
import { and, desc, eq, max, sql } from "drizzle-orm";
import {
  missingStatementFields,
  type Statement,
} from "@accessibility/contracts";
import {
  accessibilityStatements,
  auditPages,
  audits,
  memberships,
  organizations,
  pages,
  sites,
  type Database,
} from "@accessibility/db";
import {
  RGAA_VERSION,
  allowedStatuses,
  computeCompliance,
  criterionById,
  type ComplianceResult,
} from "@accessibility/rules";
import {
  loadAutoFindings,
  loadManualChecks,
  type ManualCheckRow,
} from "../compliance/inputs.js";

export type StatementRow = typeof accessibilityStatements.$inferSelect;

export interface NonAccessibleItem {
  criterionId: string;
  title: string;
  sources: ("manual" | "auto")[];
  notes: string;
}

// The state of every criterion, frozen when the statement is published so the
// public page never changes when the live audit does.
export interface StatementSnapshot {
  computedStatus: ComplianceResult["status"];
  rate: number | null;
  counts: ComplianceResult["counts"];
  unattributed: number;
  criteria: {
    id: string;
    title: string;
    state: string;
    sources: ("manual" | "auto")[];
    axeRules: string[];
    contradiction: boolean;
    notes: string;
    evidenceUrl: string | null;
  }[];
}

export interface LiveCompliance {
  result: ComplianceResult;
  manual: ManualCheckRow[];
}

// SQLSTATE of a driver error (drizzle wraps it as `cause`).
export function pgErrorCode(error: unknown): string | undefined {
  const source =
    error instanceof Error && error.cause !== undefined ? error.cause : error;
  return (source as { code?: string }).code;
}

export async function computeLive(
  db: Pick<Database, "select">,
  siteId: string,
): Promise<LiveCompliance> {
  const [manual, findings] = await Promise.all([
    loadManualChecks(db, siteId),
    loadAutoFindings(db, siteId),
  ]);
  const result = computeCompliance({
    manualChecks: new Map(manual.map((m) => [m.criterionId, m.status])),
    findings,
  });
  return { result, manual };
}

export function nonAccessibleItems(live: LiveCompliance): NonAccessibleItem[] {
  const notes = new Map(live.manual.map((m) => [m.criterionId, m.notes]));
  return live.result.nonConformes.map((c) => ({
    criterionId: c.id,
    title: criterionById(c.id)?.title ?? c.id,
    sources: c.sources,
    notes: notes.get(c.id) ?? "",
  }));
}

export function buildSnapshot(live: LiveCompliance): StatementSnapshot {
  const manual = new Map(live.manual.map((m) => [m.criterionId, m]));
  return {
    computedStatus: live.result.status,
    rate: live.result.rate,
    counts: live.result.counts,
    unattributed: live.result.unattributed,
    criteria: live.result.criteria.map((c) => ({
      id: c.id,
      title: criterionById(c.id)?.title ?? c.id,
      state: c.state,
      sources: c.sources,
      axeRules: c.axeRules,
      contradiction: c.contradiction,
      notes: manual.get(c.id)?.notes ?? "",
      evidenceUrl: manual.get(c.id)?.evidenceUrl ?? null,
    })),
  };
}

const asStrings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((v): v is string => typeof v === "string")
    : [];

// A draft shows the live audit; a published or replaced statement shows what
// was frozen at publication.
export function toStatement(
  row: StatementRow,
  live: LiveCompliance | null,
): Statement {
  const isDraft = row.status === "draft";
  const snapshot = row.criteriaSnapshot as StatementSnapshot | null;
  const fields = {
    entityName: row.entityName,
    contactEmail: row.contactEmail,
    contactUrl: row.contactUrl,
    samplePages: asStrings(row.samplePages),
    technologies: row.technologies,
    testEnvironment: row.testEnvironment,
    tools: row.tools,
  };
  const computed =
    isDraft && live !== null ? live.result.status : row.computedStatus;
  return {
    id: row.id,
    siteId: row.siteId,
    version: row.version,
    status: row.status,
    computedStatus: computed,
    declaredStatus: row.declaredStatus,
    complianceRate:
      isDraft && live !== null ? live.result.rate : row.complianceRate,
    allowedStatuses: isDraft ? allowedStatuses(computed) : [],
    counts:
      isDraft && live !== null
        ? live.result.counts
        : (snapshot?.counts ?? {
            conforme: 0,
            nonConforme: 0,
            na: 0,
            aVerifier: 0,
          }),
    unattributed:
      isDraft && live !== null
        ? live.result.unattributed
        : (snapshot?.unattributed ?? 0),
    ...fields,
    derogations: row.derogations,
    nonAccessibleContent:
      isDraft && live !== null
        ? nonAccessibleItems(live)
        : ((row.nonAccessibleContent as NonAccessibleItem[] | null) ?? []),
    locale: row.locale,
    referentialVersion: row.referentialVersion,
    missing: isDraft ? missingStatementFields(fields) : [],
    publicPath: row.publicSlug === null ? null : `/d/${row.publicSlug}`,
    pdfReady: row.pdfGeneratedAt !== null,
    publishedAt: row.publishedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export type CreateDraft =
  { kind: "created"; row: StatementRow } | { kind: "draft_exists" };

const MAX_SAMPLE = 50;

export async function createDraft(
  db: Database,
  site: { id: string; baseUrl: string; orgId: string },
): Promise<CreateDraft> {
  const live = await computeLive(db, site.id);
  try {
    const row = await db.transaction(async (tx) => {
      const [org] = await tx
        .select({ name: organizations.name })
        .from(organizations)
        .where(eq(organizations.id, site.orgId));
      const [last] = await tx
        .select({ version: max(accessibilityStatements.version) })
        .from(accessibilityStatements)
        .where(eq(accessibilityStatements.siteId, site.id));

      // The pages of the latest finished audit: the sample the statement is about.
      const [audit] = await tx
        .select({ id: audits.id })
        .from(audits)
        .where(
          and(
            eq(audits.siteId, site.id),
            eq(audits.status, "completed"),
            sql`${audits.type} <> 'free'`,
          ),
        )
        .orderBy(desc(audits.createdAt))
        .limit(1);
      const sample =
        audit === undefined
          ? []
          : await tx
              .select({ url: pages.url })
              .from(auditPages)
              .innerJoin(pages, eq(pages.id, auditPages.pageId))
              .where(
                and(
                  eq(auditPages.auditId, audit.id),
                  eq(auditPages.status, "done"),
                ),
              )
              .orderBy(pages.url)
              .limit(MAX_SAMPLE);

      const [inserted] = await tx
        .insert(accessibilityStatements)
        .values({
          siteId: site.id,
          version: (last?.version ?? 0) + 1,
          computedStatus: live.result.status,
          complianceRate: live.result.rate,
          auditId: audit?.id ?? null,
          entityName: org?.name ?? null,
          samplePages: sample.map((p) => p.url),
          referentialVersion: RGAA_VERSION,
        })
        .returning();
      if (inserted === undefined)
        throw new Error("Statement insert returned no row");
      return inserted;
    });
    return { kind: "created", row };
  } catch (error) {
    if (pgErrorCode(error) === "23505") return { kind: "draft_exists" };
    throw error;
  }
}

export async function listStatements(
  db: Database,
  siteId: string,
): Promise<StatementRow[]> {
  return db
    .select()
    .from(accessibilityStatements)
    .where(eq(accessibilityStatements.siteId, siteId))
    .orderBy(desc(accessibilityStatements.version));
}

// Null when the statement does not exist or its site is in an organization the
// user is not in: callers answer 404 either way.
export async function findUserStatement(
  db: Database,
  userId: string,
  statementId: string,
): Promise<{
  row: StatementRow;
  orgId: string;
  site: { id: string; baseUrl: string };
  role: "owner" | "member";
} | null> {
  const [found] = await db
    .select({
      row: accessibilityStatements,
      orgId: sites.orgId,
      baseUrl: sites.baseUrl,
      role: memberships.role,
    })
    .from(accessibilityStatements)
    .innerJoin(sites, eq(sites.id, accessibilityStatements.siteId))
    .innerJoin(
      memberships,
      and(eq(memberships.orgId, sites.orgId), eq(memberships.userId, userId)),
    )
    .where(eq(accessibilityStatements.id, statementId));
  if (found === undefined || found.orgId === null) return null;
  return {
    row: found.row,
    orgId: found.orgId,
    site: { id: found.row.siteId, baseUrl: found.baseUrl },
    role: found.role,
  };
}

export interface StatementEdits {
  entityName?: string | null;
  contactEmail?: string | null;
  contactUrl?: string | null;
  derogations?: string | null;
  samplePages?: string[];
  technologies?: string | null;
  testEnvironment?: string | null;
  tools?: string | null;
}

// Only a draft may change: the guard is in the statement itself, so a publish
// racing an edit cannot be edited afterwards.
export async function updateDraft(
  db: Database,
  statementId: string,
  edits: StatementEdits,
): Promise<StatementRow | null> {
  const set: Record<string, unknown> = { updatedAt: sql`now()` };
  for (const [key, value] of Object.entries(edits)) {
    if (value !== undefined) set[key] = value;
  }
  const [row] = await db
    .update(accessibilityStatements)
    .set(set)
    .where(
      and(
        eq(accessibilityStatements.id, statementId),
        eq(accessibilityStatements.status, "draft"),
      ),
    )
    .returning();
  return row ?? null;
}

const SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
const SLUG_LENGTH = 20;

// 20 characters out of 36, drawn without modulo bias: not guessable, and short
// enough to read out or print.
function newSlug(): string {
  return Array.from({ length: SLUG_LENGTH }, () =>
    SLUG_ALPHABET.charAt(randomInt(SLUG_ALPHABET.length)),
  ).join("");
}

export type PublishResult =
  | { kind: "published"; row: StatementRow }
  | { kind: "not_a_draft" }
  | { kind: "incomplete"; missing: string[] }
  | { kind: "audit_incomplete" }
  | { kind: "status_not_supported"; allowed: string[] };

// Publishes a draft: freezes what the audit says now, replaces the version in
// force, and gives the statement its public address. One transaction under a
// lock on the statement, so a double click or a racing edit cannot publish it
// twice or publish something other than what was checked.
export async function publishDraft(
  db: Database,
  statementId: string,
  userId: string,
  declaredStatus: "total" | "partiel" | "non",
): Promise<PublishResult> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(accessibilityStatements)
      .where(eq(accessibilityStatements.id, statementId))
      .for("update");
    if (row === undefined || row.status !== "draft")
      return { kind: "not_a_draft" };

    const fields = {
      entityName: row.entityName,
      contactEmail: row.contactEmail,
      contactUrl: row.contactUrl,
      samplePages: asStrings(row.samplePages),
      technologies: row.technologies,
      testEnvironment: row.testEnvironment,
      tools: row.tools,
    };
    const missing = missingStatementFields(fields);
    if (missing.length > 0) return { kind: "incomplete", missing };

    const live = await computeLive(tx, row.siteId);
    const allowed = allowedStatuses(live.result.status);
    if (live.result.status === "indetermine")
      return { kind: "audit_incomplete" };
    if (!allowed.includes(declaredStatus)) {
      return { kind: "status_not_supported", allowed };
    }

    await tx
      .update(accessibilityStatements)
      .set({ status: "superseded", updatedAt: sql`now()` })
      .where(
        and(
          eq(accessibilityStatements.siteId, row.siteId),
          eq(accessibilityStatements.status, "published"),
        ),
      );
    const [published] = await tx
      .update(accessibilityStatements)
      .set({
        status: "published",
        computedStatus: live.result.status,
        declaredStatus,
        complianceRate: live.result.rate,
        criteriaSnapshot: buildSnapshot(live),
        nonAccessibleContent: nonAccessibleItems(live),
        referentialVersion: RGAA_VERSION,
        publishedAt: new Date(),
        publishedBy: userId,
        publicSlug: newSlug(),
        pdf: null,
        pdfGeneratedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(accessibilityStatements.id, statementId))
      .returning();
    if (published === undefined)
      throw new Error("Statement publish returned no row");
    return { kind: "published", row: published };
  });
}
