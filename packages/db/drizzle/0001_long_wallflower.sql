CREATE TYPE "public"."audit_failure_reason" AS ENUM('forbidden_url', 'robots_disallowed', 'scan_failed');--> statement-breakpoint
ALTER TABLE "audits" ADD COLUMN "failure_reason" "audit_failure_reason";--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "report_sent_at" timestamp with time zone;--> statement-breakpoint
CREATE UNIQUE INDEX "leads_email_audit_idx" ON "leads" USING btree ("email","audit_id");--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_consent_given" CHECK ("leads"."consent" IS TRUE);