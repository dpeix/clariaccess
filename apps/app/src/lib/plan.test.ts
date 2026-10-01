import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@accessibility/contracts";
import {
  frequencyLabel,
  limitsSummary,
  planLabel,
  scheduleChoices,
  taskStatusLabel,
} from "./plan.js";

describe("planLabel", () => {
  it("names the plans in French", () => {
    expect(planLabel("free")).toBe("Gratuit");
    expect(planLabel("pro")).toBe("Pro");
  });
});

describe("frequencyLabel", () => {
  it("names the frequencies", () => {
    expect(frequencyLabel("weekly")).toBe("Chaque semaine");
    expect(frequencyLabel("daily")).toBe("Chaque jour");
    expect(frequencyLabel(null)).toBe("Aucun re-scan");
  });
});

describe("scheduleChoices", () => {
  it("always lets the re-scan be switched off", () => {
    for (const limits of [PLAN_LIMITS.free, PLAN_LIMITS.pro]) {
      expect(scheduleChoices(limits)[0]).toMatchObject({
        value: null,
        allowed: true,
      });
    }
  });

  it("offers every frequency but only enables the ones the plan allows", () => {
    const free = scheduleChoices(PLAN_LIMITS.free);
    const pro = scheduleChoices(PLAN_LIMITS.pro);

    expect(free.map((c) => c.value)).toEqual([null, "weekly", "daily"]);
    expect(free.filter((c) => c.allowed).map((c) => c.value)).toEqual([null]);
    expect(pro.every((c) => c.allowed)).toBe(true);
  });

  it("explains why a choice is unavailable", () => {
    const [, weekly] = scheduleChoices(PLAN_LIMITS.free);

    expect(weekly?.allowed).toBe(false);
    expect(weekly?.reason).toMatch(/Pro/);
  });
});

describe("limitsSummary", () => {
  it("states what the plan allows, with the right plurals", () => {
    const free = limitsSummary(PLAN_LIMITS.free);
    const pro = limitsSummary(PLAN_LIMITS.pro);

    expect(free.join(" ")).toContain("1 site");
    expect(free.join(" ")).not.toContain("1 sites");
    expect(pro.join(" ")).toContain(`${PLAN_LIMITS.pro.maxSites} sites`);
    expect(free.join(" ")).toMatch(/aucun re-scan/i);
    expect(pro.join(" ")).toMatch(/re-scans/i);
  });
});

describe("taskStatusLabel", () => {
  it("has a distinct label for each status", () => {
    const labels = (["todo", "doing", "done"] as const).map(taskStatusLabel);

    expect(new Set(labels).size).toBe(3);
    expect(taskStatusLabel("todo")).toBe("À faire");
  });
});
