import { eq } from "drizzle-orm";
import { isPlan, type Plan } from "@accessibility/contracts";
import { organizations, type Database } from "@accessibility/db";

// The single place where an organization's plan changes. Today it is called by
// an administration script; a payment integration will call it too, so what
// "being on a plan" means stays in one function whatever sells the plan.
//
// Downgrading keeps the sites' re-scan settings: the scheduler only runs the
// ones the current plan allows, so upgrading again resumes them.
export async function setOrganizationPlan(
  db: Database,
  orgId: string,
  plan: string,
): Promise<{ previous: string; plan: Plan }> {
  if (!isPlan(plan)) throw new Error(`Unknown plan: ${plan}`);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ plan: organizations.plan })
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .for("update");
    if (current === undefined) {
      throw new Error(`Organization ${orgId} not found`);
    }
    await tx
      .update(organizations)
      .set({ plan })
      .where(eq(organizations.id, orgId));
    return { previous: current.plan, plan };
  });
}
