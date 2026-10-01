import { describe, expect, it, vi } from "vitest";
import {
  DUE_SCANS_JOB,
  type JobQueue,
  type JobScheduler,
} from "@accessibility/queue";
import { registerDueScansWorker } from "./due-scans-worker.js";

function fakes() {
  const handlers = new Map<string, (payload: unknown) => Promise<void>>();
  const queue: JobQueue = {
    start: async () => undefined,
    enqueue: async () => "id",
    work: async (name, handler) => {
      handlers.set(name, handler);
    },
    stop: async () => undefined,
  };
  const scheduled: { name: string; cron: string }[] = [];
  const scheduler: JobScheduler = {
    schedule: async (name, cron) => {
      scheduled.push({ name, cron });
    },
  };
  return { queue, scheduler, handlers, scheduled };
}

describe("registerDueScansWorker", () => {
  it("schedules the tick on the given cron expression and handles it", async () => {
    const { queue, scheduler, handlers, scheduled } = fakes();
    const run = vi.fn(async () => ({ started: 0, busy: 0, failed: 0 }));

    await registerDueScansWorker(queue, scheduler, "*/5 * * * *", run);
    await handlers.get(DUE_SCANS_JOB)?.({});

    expect(scheduled).toEqual([{ name: DUE_SCANS_JOB, cron: "*/5 * * * *" }]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("registers the handler before the schedule, so no tick is lost", async () => {
    const order: string[] = [];
    const queue: JobQueue = {
      start: async () => undefined,
      enqueue: async () => "id",
      work: async () => void order.push("work"),
      stop: async () => undefined,
    };
    const scheduler: JobScheduler = {
      schedule: async () => void order.push("schedule"),
    };

    await registerDueScansWorker(queue, scheduler, "* * * * *", async () => ({
      started: 0,
      busy: 0,
      failed: 0,
    }));

    expect(order).toEqual(["work", "schedule"]);
  });

  it("lets a failing tick fail the job, for the queue to record", async () => {
    const { queue, scheduler, handlers } = fakes();
    await registerDueScansWorker(queue, scheduler, "* * * * *", async () => {
      throw new Error("database down");
    });

    await expect(handlers.get(DUE_SCANS_JOB)?.({})).rejects.toThrow(
      /database down/,
    );
  });
});
