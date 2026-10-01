ALTER TABLE "audits" ADD COLUMN "alert_sent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "sites" ADD COLUMN "next_scan_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "sites_next_scan_at_idx" ON "sites" USING btree ("next_scan_at") WHERE "sites"."scan_frequency" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_plan_known" CHECK ("organizations"."plan" IN ('free', 'pro'));--> statement-breakpoint
ALTER TABLE "sites" ADD CONSTRAINT "sites_scan_frequency_known" CHECK ("sites"."scan_frequency" IS NULL OR "sites"."scan_frequency" IN ('weekly', 'daily'));