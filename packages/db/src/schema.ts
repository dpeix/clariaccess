import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import {
  AUDIT_FAILURE_REASONS,
  AUDIT_PAGE_STATUSES,
  AUDIT_STATUSES,
  AUDIT_TYPES,
  COMPLIANCE_STATUSES,
  COMPUTED_COMPLIANCE_STATUSES,
  FINDING_STATUSES,
  IMPACTS,
  MANUAL_STATUSES,
  MEMBERSHIP_ROLES,
  PLANS,
  SCAN_FREQUENCIES,
  STATEMENT_LOCALES,
  STATEMENT_STATUSES,
  TASK_STATUSES,
} from "@accessibility/contracts";

export const auditTypeEnum = pgEnum("audit_type", AUDIT_TYPES);
export const auditStatusEnum = pgEnum("audit_status", AUDIT_STATUSES);
export const auditFailureReasonEnum = pgEnum(
  "audit_failure_reason",
  AUDIT_FAILURE_REASONS,
);
export const impactEnum = pgEnum("impact", IMPACTS);
export const ruleSourceEnum = pgEnum("rule_source", ["axe", "manual"]);
export const wcagLevelEnum = pgEnum("wcag_level", ["A", "AA", "AAA"]);
export const membershipRoleEnum = pgEnum("membership_role", MEMBERSHIP_ROLES);
// One row per page of an audit: pages are scanned by separate jobs.
export const auditPageStatusEnum = pgEnum(
  "audit_page_status",
  AUDIT_PAGE_STATUSES,
);
export const manualStatusEnum = pgEnum("manual_status", MANUAL_STATUSES);
export const complianceStatusEnum = pgEnum(
  "compliance_status",
  COMPLIANCE_STATUSES,
);
export const computedComplianceStatusEnum = pgEnum(
  "computed_compliance_status",
  COMPUTED_COMPLIANCE_STATUSES,
);
export const statementStatusEnum = pgEnum(
  "statement_status",
  STATEMENT_STATUSES,
);
export const taskStatusEnum = pgEnum("task_status", TASK_STATUSES);
export const findingStatusEnum = pgEnum("finding_status", FINDING_STATUSES);

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType: () => "bytea",
});

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

// SQL list of the values of a TypeScript tuple, for CHECK constraints.
const inList = (values: readonly string[]) =>
  sql.raw(values.map((v) => `'${v}'`).join(", "));

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    // What the plan allows is code (contracts/plans.ts); the column only names it.
    plan: text("plan").notNull().default("free"),
    stripeCustomerId: text("stripe_customer_id"),
    sector: text("sector"),
    size: text("size"),
    country: text("country"),
    eaaApplicability: jsonb("eaa_applicability"),
    createdAt: createdAt(),
  },
  (t) => [
    check("organizations_plan_known", sql`${t.plan} IN (${inList(PLANS)})`),
  ],
);

export const sites = pgTable(
  "sites",
  {
    id: id(),
    // Null for anonymous free audits, which exist before any account.
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    baseUrl: text("base_url").notNull(),
    // Proof of ownership the customer must publish (DNS TXT or well-known
    // file) before recurring scans; null for anonymous free audits.
    verificationToken: text("verification_token"),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationMethod: text("verification_method"),
    // Null: no re-scan. The plan decides whether a frequency is usable.
    scanFrequency: text("scan_frequency"),
    // When the next re-scan is due; set together with the frequency.
    nextScanAt: timestamp("next_scan_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    unique("sites_org_base_url_unique").on(t.orgId, t.baseUrl),
    check(
      "sites_scan_frequency_known",
      sql`${t.scanFrequency} IS NULL OR ${t.scanFrequency} IN (${inList(SCAN_FREQUENCIES)})`,
    ),
    // What the scheduler looks up every few minutes.
    index("sites_next_scan_at_idx")
      .on(t.nextScanAt)
      .where(sql`${t.scanFrequency} IS NOT NULL`),
  ],
);

export const pages = pgTable(
  "pages",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    templateKey: text("template_key"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  },
  (t) => [unique("pages_site_url_unique").on(t.siteId, t.url)],
);

export const audits = pgTable(
  "audits",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    type: auditTypeEnum("type").notNull(),
    status: auditStatusEnum("status").notNull().default("queued"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    // Set only when status is 'failed'.
    failureReason: auditFailureReasonEnum("failure_reason"),
    engineVersion: text("engine_version"),
    // Automated score only; null until the audit completes.
    score: integer("score"),
    pagesScanned: integer("pages_scanned").notNull().default(0),
    // Set once the regression alert of a re-scan went out, so a retried job
    // does not send it twice.
    alertSentAt: timestamp("alert_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("audits_site_id_idx").on(t.siteId),
    // One multi-page audit at a time per site, whoever asks and however many
    // requests race. Free audits are excluded: anonymous sites are shared.
    uniqueIndex("audits_one_active_per_site_idx")
      .on(t.siteId)
      .where(sql`${t.type} <> 'free' AND ${t.status} IN ('queued', 'running')`),
    check("audits_score_range", sql`${t.score} BETWEEN 0 AND 100`),
  ],
);

export const auditPages = pgTable(
  "audit_pages",
  {
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    status: auditPageStatusEnum("status").notNull().default("pending"),
    htmlSnapshotKey: text("html_snapshot_key"),
    screenshotKey: text("screenshot_key"),
  },
  (t) => [primaryKey({ columns: [t.auditId, t.pageId] })],
);

// Reference data seeded from @accessibility/rules (see migrate.ts). The id is
// the axe rule id, e.g. "image-alt". A rule can cover several criteria, hence arrays.
export const rules = pgTable("rules", {
  id: text("id").primaryKey(),
  source: ruleSourceEnum("source").notNull(),
  wcagCriteria: text("wcag_criteria").array().notNull(),
  rgaaCriteria: text("rgaa_criteria").array().notNull(),
  en301549Clauses: text("en301549_clauses").array().notNull(),
  // Null for best-practice rules that have no WCAG criterion.
  level: wcagLevelEnum("level"),
  defaultImpact: impactEnum("default_impact"),
  rulesVersion: text("rules_version").notNull(),
});

export const issues = pgTable(
  "issues",
  {
    id: id(),
    auditId: uuid("audit_id")
      .notNull()
      .references(() => audits.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id),
    impact: impactEnum("impact").notNull(),
    selector: text("selector").notNull(),
    htmlExcerpt: text("html_excerpt").notNull(),
    message: text("message").notNull(),
    // Stable identity of a problem across audits (rule + selector + template).
    fingerprint: text("fingerprint").notNull(),
    // Raw axe result, kept so audits can be replayed.
    raw: jsonb("raw").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("issues_audit_id_idx").on(t.auditId),
    index("issues_fingerprint_idx").on(t.fingerprint),
  ],
);

export const leads = pgTable(
  "leads",
  {
    id: id(),
    email: text("email").notNull(),
    url: text("url"),
    // The lead stays if its audit is purged (retention policy).
    auditId: uuid("audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    consent: boolean("consent").notNull(),
    consentedAt: timestamp("consented_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    source: text("source"),
    utm: jsonb("utm"),
    // Set once the report email went out, so a retried job does not resend it.
    reportSentAt: timestamp("report_sent_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index("leads_email_idx").on(t.email),
    // One lead per visitor and audit: a repeated submission must not send the
    // report again.
    uniqueIndex("leads_email_audit_idx").on(t.email, t.auditId),
    // A lead is only valid with consent; the API checks it, the database
    // guarantees it.
    check("leads_consent_given", sql`${t.consent} IS TRUE`),
  ],
);

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull().unique(),
    createdAt: createdAt(),
  },
  (t) => [
    // Login looks users up by lowercase email: two spellings must not coexist.
    check("users_email_lowercase", sql`${t.email} = lower(${t.email})`),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    orgId: uuid("org_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    role: membershipRoleEnum("role").notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.orgId] })],
);

// Only the SHA-256 of the secret is stored (login links and session cookies):
// a leaked database does not give access to accounts.
export const loginTokens = pgTable("login_tokens", {
  id: id(),
  tokenHash: text("token_hash").notNull().unique(),
  email: text("email").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  // Set when the link is used: a login link works once.
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    tokenHash: text("token_hash").notNull().unique(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

// A problem followed over time on one page of a site. The issue fingerprint
// does not include the page, so the key is (site, page, fingerprint).
export const findings = pgTable(
  "findings",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    pageId: uuid("page_id")
      .notNull()
      .references(() => pages.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id),
    fingerprint: text("fingerprint").notNull(),
    impact: impactEnum("impact").notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    // What the last audit saw, so the finding can be shown without its issues.
    selector: text("selector").notNull(),
    htmlExcerpt: text("html_excerpt").notNull(),
    message: text("message").notNull(),
    // The finding outlives purged audits (retention policy).
    firstSeenAuditId: uuid("first_seen_audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    lastSeenAuditId: uuid("last_seen_audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    // The audit in which a fixed problem came back, so an alert is about that
    // audit and not repeated while the problem stays.
    regressedAuditId: uuid("regressed_audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    priorityScore: integer("priority_score").notNull(),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("findings_site_page_fingerprint_unique").on(
      t.siteId,
      t.pageId,
      t.fingerprint,
    ),
    index("findings_site_status_idx").on(t.siteId, t.status),
  ],
);

// What to do about a rule on a site: one task covers every finding of the same
// rule, since fixing a template or a component fixes them together. Findings
// are linked by (site, rule), not by a column: there is nothing to keep in sync.
export const remediationTasks = pgTable(
  "remediation_tasks",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    ruleId: text("rule_id")
      .notNull()
      .references(() => rules.id),
    status: taskStatusEnum("status").notNull().default("todo"),
    // Sum of the open findings' priority: the order in which to work.
    priorityScore: integer("priority_score").notNull(),
    // The person stays optional and the task survives their departure.
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("remediation_tasks_site_rule_unique").on(t.siteId, t.ruleId),
    index("remediation_tasks_site_status_idx").on(t.siteId, t.status),
  ],
);

// What a person verified by hand for one RGAA criterion of a site. The
// reference (the 106 criteria) is code, not data: the column only holds the id.
export const manualChecks = pgTable(
  "manual_checks",
  {
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    criterionId: text("criterion_id").notNull(),
    status: manualStatusEnum("status").notNull(),
    notes: text("notes").notNull().default(""),
    // A link to where the finding can be seen (screenshot, ticket).
    evidenceUrl: text("evidence_url"),
    // The check outlives the person who made it.
    checkedBy: uuid("checked_by").references(() => users.id, {
      onDelete: "set null",
    }),
    checkedAt: timestamp("checked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.siteId, t.criterionId] }),
    check(
      "manual_checks_criterion_format",
      sql`${t.criterionId} ~ '^[0-9]{1,2}\\.[0-9]{1,2}$'`,
    ),
    check("manual_checks_notes_length", sql`char_length(${t.notes}) <= 5000`),
  ],
);

// The accessibility statement of a site, versioned. Only the latest published
// version is current; earlier ones stay as history. A draft is edited freely;
// publishing freezes it (criteria_snapshot) and nothing edits it afterwards.
export const accessibilityStatements = pgTable(
  "accessibility_statements",
  {
    id: id(),
    siteId: uuid("site_id")
      .notNull()
      .references(() => sites.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    status: statementStatusEnum("status").notNull().default("draft"),
    // What the audit supports, computed by the tool.
    computedStatus: computedComplianceStatusEnum("computed_status").notNull(),
    // What the publisher chose to declare (never more favourable than computed).
    declaredStatus: complianceStatusEnum("declared_status"),
    complianceRate: integer("compliance_rate"),
    // The automatic audit the statement refers to, when there is one.
    auditId: uuid("audit_id").references(() => audits.id, {
      onDelete: "set null",
    }),
    // The state of every criterion at publication, so the public page never
    // changes when the live audit does.
    criteriaSnapshot: jsonb("criteria_snapshot"),
    nonAccessibleContent: jsonb("non_accessible_content"),
    derogations: text("derogations"),
    entityName: text("entity_name"),
    contactEmail: text("contact_email"),
    contactUrl: text("contact_url"),
    samplePages: jsonb("sample_pages"),
    technologies: text("technologies"),
    testEnvironment: text("test_environment"),
    tools: text("tools"),
    locale: text("locale").notNull().default("fr"),
    referentialVersion: text("referential_version").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    publishedBy: uuid("published_by").references(() => users.id, {
      onDelete: "set null",
    }),
    // Unguessable short id in the public URL.
    publicSlug: text("public_slug").unique(),
    pdf: bytea("pdf"),
    pdfGeneratedAt: timestamp("pdf_generated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("accessibility_statements_site_version_unique").on(
      t.siteId,
      t.version,
    ),
    uniqueIndex("accessibility_statements_one_draft_idx")
      .on(t.siteId)
      .where(sql`${t.status} = 'draft'`),
    uniqueIndex("accessibility_statements_one_published_idx")
      .on(t.siteId)
      .where(sql`${t.status} = 'published'`),
    check(
      "accessibility_statements_rate_range",
      sql`${t.complianceRate} IS NULL OR ${t.complianceRate} BETWEEN 0 AND 100`,
    ),
    check(
      "accessibility_statements_locale_offered",
      sql`${t.locale} IN (${inList(STATEMENT_LOCALES)})`,
    ),
    check(
      "accessibility_statements_slug_format",
      sql`${t.publicSlug} IS NULL OR ${t.publicSlug} ~ '^[a-z0-9]{12,40}$'`,
    ),
    // A statement that is, or was, public has all it needs to be shown.
    check(
      "accessibility_statements_public_complete",
      sql`${t.status} = 'draft' OR (${t.publicSlug} IS NOT NULL AND ${t.publishedAt} IS NOT NULL AND ${t.declaredStatus} IS NOT NULL AND ${t.criteriaSnapshot} IS NOT NULL)`,
    ),
  ],
);
