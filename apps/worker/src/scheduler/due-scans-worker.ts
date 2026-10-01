import {
  DUE_SCANS_JOB,
  type JobQueue,
  type JobScheduler,
} from "@accessibility/queue";
import type { DueScansOutcome } from "./due-scans.js";

export async function registerDueScansWorker(
  queue: JobQueue,
  scheduler: JobScheduler,
  cron: string,
  run: () => Promise<DueScansOutcome>,
): Promise<void> {
  // Handler first: an occurrence that fires right after the schedule exists
  // must find someone to run it.
  await queue.work(DUE_SCANS_JOB, async () => {
    await run();
  });
  await scheduler.schedule(DUE_SCANS_JOB, cron);
}
