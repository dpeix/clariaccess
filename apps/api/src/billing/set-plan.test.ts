import { eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { organizations, sites } from "@accessibility/db";
import { adminDatabaseUrl } from "../test/integration.js";
import { createHarness, type Harness } from "../test/harness.js";
import { setOrganizationPlan } from "./set-plan.js";

const adminUrl = adminDatabaseUrl();

describe.skipIf(adminUrl === undefined)("setOrganizationPlan", () => {
  let h: Harness & { test: unknown };

  beforeAll(async () => {
    h = await createHarness(adminUrl as string);
  });
  afterAll(async () => {
    await h.close();
  });

  const newOrg = async () =>
    (await h.db.insert(organizations).values({ name: "Acme" }).returning())[0]!;
  const planOf = async (id: string) =>
    (
      await h.db.select().from(organizations).where(eq(organizations.id, id))
    )[0]!.plan;

  it("moves an organization to a plan of the grid", async () => {
    const org = await newOrg();

    await expect(setOrganizationPlan(h.db, org.id, "pro")).resolves.toEqual({
      previous: "free",
      plan: "pro",
    });
    expect(await planOf(org.id)).toBe("pro");
  });

  it("refuses a plan that is not in the grid, and changes nothing", async () => {
    const org = await newOrg();

    await expect(
      setOrganizationPlan(h.db, org.id, "enterprise"),
    ).rejects.toThrow(/plan/i);
    expect(await planOf(org.id)).toBe("free");
  });

  it("refuses an organization that does not exist", async () => {
    await expect(
      setOrganizationPlan(h.db, "00000000-0000-4000-8000-000000000000", "pro"),
    ).rejects.toThrow(/not found/i);
  });

  it("keeps the re-scan schedules of a downgraded organization, switched off by the plan only", async () => {
    const org = await newOrg();
    await setOrganizationPlan(h.db, org.id, "pro");
    const [site] = await h.db
      .insert(sites)
      .values({
        orgId: org.id,
        baseUrl: "https://down.example",
        verificationToken: "t",
        scanFrequency: "daily",
        nextScanAt: new Date(),
      })
      .returning();

    await setOrganizationPlan(h.db, org.id, "free");

    const [after] = await h.db
      .select()
      .from(sites)
      .where(eq(sites.id, site!.id));
    expect(after?.scanFrequency).toBe("daily");
  });
});
