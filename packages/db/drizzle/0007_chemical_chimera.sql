CREATE TYPE "public"."compliance_status" AS ENUM('total', 'partiel', 'non');--> statement-breakpoint
CREATE TYPE "public"."computed_compliance_status" AS ENUM('total', 'partiel', 'non', 'indetermine');--> statement-breakpoint
CREATE TYPE "public"."manual_status" AS ENUM('ok', 'ko', 'na');--> statement-breakpoint
CREATE TYPE "public"."statement_status" AS ENUM('draft', 'published', 'superseded');--> statement-breakpoint
CREATE TABLE "accessibility_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "statement_status" DEFAULT 'draft' NOT NULL,
	"computed_status" "computed_compliance_status" NOT NULL,
	"declared_status" "compliance_status",
	"compliance_rate" integer,
	"audit_id" uuid,
	"criteria_snapshot" jsonb,
	"non_accessible_content" jsonb,
	"derogations" text,
	"entity_name" text,
	"contact_email" text,
	"contact_url" text,
	"sample_pages" jsonb,
	"technologies" text,
	"test_environment" text,
	"tools" text,
	"locale" text DEFAULT 'fr' NOT NULL,
	"referential_version" text NOT NULL,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"public_slug" text,
	"pdf" "bytea",
	"pdf_generated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accessibility_statements_public_slug_unique" UNIQUE("public_slug"),
	CONSTRAINT "accessibility_statements_site_version_unique" UNIQUE("site_id","version"),
	CONSTRAINT "accessibility_statements_rate_range" CHECK ("accessibility_statements"."compliance_rate" IS NULL OR "accessibility_statements"."compliance_rate" BETWEEN 0 AND 100),
	CONSTRAINT "accessibility_statements_locale_offered" CHECK ("accessibility_statements"."locale" IN ('fr')),
	CONSTRAINT "accessibility_statements_slug_format" CHECK ("accessibility_statements"."public_slug" IS NULL OR "accessibility_statements"."public_slug" ~ '^[a-z0-9]{12,40}$'),
	CONSTRAINT "accessibility_statements_public_complete" CHECK ("accessibility_statements"."status" = 'draft' OR ("accessibility_statements"."public_slug" IS NOT NULL AND "accessibility_statements"."published_at" IS NOT NULL AND "accessibility_statements"."declared_status" IS NOT NULL AND "accessibility_statements"."criteria_snapshot" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "manual_checks" (
	"site_id" uuid NOT NULL,
	"criterion_id" text NOT NULL,
	"status" "manual_status" NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"evidence_url" text,
	"checked_by" uuid,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "manual_checks_site_id_criterion_id_pk" PRIMARY KEY("site_id","criterion_id"),
	CONSTRAINT "manual_checks_criterion_format" CHECK ("manual_checks"."criterion_id" ~ '^[0-9]{1,2}\.[0-9]{1,2}$'),
	CONSTRAINT "manual_checks_notes_length" CHECK (char_length("manual_checks"."notes") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "accessibility_statements" ADD CONSTRAINT "accessibility_statements_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessibility_statements" ADD CONSTRAINT "accessibility_statements_audit_id_audits_id_fk" FOREIGN KEY ("audit_id") REFERENCES "public"."audits"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accessibility_statements" ADD CONSTRAINT "accessibility_statements_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_checks" ADD CONSTRAINT "manual_checks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "manual_checks" ADD CONSTRAINT "manual_checks_checked_by_users_id_fk" FOREIGN KEY ("checked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "accessibility_statements_one_draft_idx" ON "accessibility_statements" USING btree ("site_id") WHERE "accessibility_statements"."status" = 'draft';--> statement-breakpoint
CREATE UNIQUE INDEX "accessibility_statements_one_published_idx" ON "accessibility_statements" USING btree ("site_id") WHERE "accessibility_statements"."status" = 'published';