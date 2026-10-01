import { sql } from "drizzle-orm";
import {
  boolean,
  check,
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
  AUDIT_STATUSES,
  AUDIT_TYPES,
  IMPACTS,
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

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () =>
  timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const organizations = pgTable("organizations", {
  id: id(),
  name: text("name").notNull(),
  // Free text until plans and quotas are defined (plan.md §6).
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  sector: text("sector"),
  size: text("size"),
  country: text("country"),
  eaaApplicability: jsonb("eaa_applicability"),
  createdAt: createdAt(),
});

export const sites = pgTable(
  "sites",
  {
    id: id(),
    // Null for anonymous free audits, which exist before any account.
    orgId: uuid("org_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    baseUrl: text("base_url").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    verificationMethod: text("verification_method"),
    scanFrequency: text("scan_frequency"),
    createdAt: createdAt(),
  },
  (t) => [unique("sites_org_base_url_unique").on(t.orgId, t.baseUrl)],
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
    createdAt: createdAt(),
  },
  (t) => [
    index("audits_site_id_idx").on(t.siteId),
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
