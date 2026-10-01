import {
  RENDER_STATEMENT_PDF_JOB,
  renderStatementPdfPayloadSchema,
  type JobQueue,
} from "@accessibility/queue";
import type { RenderOutcome } from "./render-pdf.js";

export async function registerRenderStatementWorker(
  queue: JobQueue,
  run: (statementId: string) => Promise<RenderOutcome>,
): Promise<void> {
  await queue.work(RENDER_STATEMENT_PDF_JOB, async (payload) => {
    const parsed = renderStatementPdfPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error(
        `Invalid ${RENDER_STATEMENT_PDF_JOB} payload: ${parsed.error.message}`,
      );
    }
    // "skipped" is an answer (nothing public, already rendered), not a failure.
    await run(parsed.data.statementId);
  });
}
