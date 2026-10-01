import {
  SCAN_PAGE_JOB,
  scanPagePayloadSchema,
  type JobQueue,
  type ScanPagePayload,
} from "@accessibility/queue";
import type { ScanPageOutcome } from "./scan-page.js";

export async function registerScanPageWorker(
  queue: JobQueue,
  run: (job: ScanPagePayload) => Promise<ScanPageOutcome>,
): Promise<void> {
  await queue.work(SCAN_PAGE_JOB, async (payload) => {
    const parsed = scanPagePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${SCAN_PAGE_JOB} payload: ${parsed.error.message}`,
      );
    }
    await run(parsed.data);
  });
}
