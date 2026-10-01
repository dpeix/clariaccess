import {
  VERIFY_SITE_JOB,
  verifySitePayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import type { VerifyOutcome } from "./verify-site.js";

export async function registerVerifyWorker(
  queue: JobQueue,
  run: (siteId: string) => Promise<VerifyOutcome>,
): Promise<void> {
  await queue.work(VERIFY_SITE_JOB, async (payload) => {
    const parsed = verifySitePayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${VERIFY_SITE_JOB} payload: ${parsed.error.message}`,
      );
    }
    // "not_verified" is an answer, not a failure: the job must not be retried.
    await run(parsed.data.siteId);
  });
}
