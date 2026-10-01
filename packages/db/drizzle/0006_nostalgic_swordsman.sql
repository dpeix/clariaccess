CREATE TYPE "public"."task_status" AS ENUM('todo', 'doing', 'done');--> statement-breakpoint
CREATE TABLE "remediation_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"site_id" uuid NOT NULL,
	"rule_id" text NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority_score" integer NOT NULL,
	"assignee_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "remediation_tasks_site_rule_unique" UNIQUE("site_id","rule_id")
);
--> statement-breakpoint
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_site_id_sites_id_fk" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_rule_id_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "remediation_tasks" ADD CONSTRAINT "remediation_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "remediation_tasks_site_status_idx" ON "remediation_tasks" USING btree ("site_id","status");--> statement-breakpoint
-- Backfill: findings already followed get their tasks, so the plan is not empty until the next audit.
INSERT INTO "remediation_tasks" ("site_id", "rule_id", "priority_score")
SELECT "site_id", "rule_id", sum("priority_score")::integer
FROM "findings"
WHERE "status" IN ('open', 'regressed')
GROUP BY "site_id", "rule_id";
