import {
  RUN_AUDIT_JOB,
  runAuditPayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import type { RunAuditOutcome } from "./run-audit.js";

export async function registerAuditWorker(
  queue: JobQueue,
  run: (auditId: string) => Promise<RunAuditOutcome>,
): Promise<void> {
  await queue.work(RUN_AUDIT_JOB, async (payload) => {
    const parsed = runAuditPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${RUN_AUDIT_JOB} payload: ${parsed.error.message}`,
      );
    }
    await run(parsed.data.auditId);
  });
}
