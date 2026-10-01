CREATE TYPE "public"."audit_status" AS ENUM('queued', 'running', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."audit_type" AS ENUM('free', 'scheduled', 'manual');--> statement-breakpoint
CREATE TYPE "public"."impact" AS ENUM('minor', 'moderate', 'serious', 'critical');--> statement-breakpoint
CREATE TYPE "public"."rule_source" AS ENUM('axe', 'manual');--> statement-breakpoint
CREATE TYPE "public"."wcag_level" AS ENUM('A', 'AA', 'AAA');--> statement-breakpoint
CREATE TABLE "audit_pages" (
	"audit_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"html_snapshot_key" text,
	"screenshot_key" text,
	CONSTRAINT "audit_pages_audit_id_page_id_pk" PRIMARY KEY("audit_id","page_id")
);
--> statement-breakpoint
CREATE TABLE "audits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"type" "audit_type" NOT NULL,
	"status" "audit_status" DEFAULT 'queued' NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"engine_version" text,
	"score" integer,
	"pages_scanned" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audits_score_range" CHECK ("audits"."score" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE TABLE "issues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"audit_id" uuid NOT NULL,
	"page_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"impact" "impact" NOT NULL,
	"selector" text NOT NULL,
	"html_excerpt" text NOT NULL,
	"message" text NOT NULL,
	"fingerprint" text NOT NULL,
	"raw" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"url" text,
	"audit_id" uuid,
	"consent" boolean NOT NULL,
	"consented_at" timestamp with time zone DEFAULT now() NOT NULL,
	"source" text,
	"utm" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"stripe_customer_id" text,
	"sector" text,
	"size" text,
	"country" text,
	"eaa_applicability" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"url" text NOT NULL,
	"template_key" text,
	"last_seen_at" timestamp with time zone,
	CONSTRAINT "pages_site_url_unique" UNIQUE("site_id","url")
);
--> statement-breakpoint
CREATE TABLE "rules" (
	"id" text PRIMARY KEY NOT NULL,
	"source" "rule_source" NOT NULL,
	"wcag_criteria" text[] NOT NULL,
	"rgaa_criteria" text[] NOT NULL,
	"en301549_clauses" text[] NOT NULL,
	"level" "wcag_level",
	"default_impact" "impact",
	"rules_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"org_id" uuid,
	"base_url" text NOT NULL,
	"verified_at" timestamp with time zone,
	"verification_method" text,
	"scan_frequency" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sites_org_base_url_unique" UNIQUE("org_id","base_url")
);
--> statement-breakpoint
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_pages" ADD CONSTRAINT "audit_pages_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audits" ADD CONSTRAINT "audits_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_page_id_pages_id_fk" FOREIGN KEY ("page_id") REFERENCES "public"."pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "issues" ADD CONSTRAINT "issues_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pages" ADD CONSTRAINT "pages_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audits_site_id_idx" ON "audits" USING btree ("site_id");--> statement-breakpoint
CREATE INDEX "issues_audit_id_idx" ON "issues" USING btree ("audit_id");--> statement-breakpoint
CREATE INDEX "issues_fingerprint_idx" ON "issues" USING btree ("fingerprint");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");