import { describe, expect, it, vi } from "vitest";
import { RENDER_STATEMENT_PDF_JOB, type JobQueue } from "@accessibility/queue";
import { registerRenderStatementWorker } from "./render-worker.js";

function fakeQueue() {
  const handlers = new Map<string, (payload: unknown) => Promise<void>>();
  const queue: JobQueue = {
    start: async () => undefined,
    enqueue: async () => "id",
    work: async (name, handler) => {
      handlers.set(name, handler);
    },
    stop: async () => undefined,
  };
  return { queue, handlers };
}

const statementId = "11111111-1111-4111-8111-111111111111";

describe("registerRenderStatementWorker", () => {
  it("renders the statement named in the payload", async () => {
    const { queue, handlers } = fakeQueue();
    const run = vi.fn(async () => "rendered" as const);
    await registerRenderStatementWorker(queue, run);

    await handlers.get(RENDER_STATEMENT_PDF_JOB)?.({ statementId });

    expect(run).toHaveBeenCalledWith(statementId);
  });

  it("does not fail the job when there was nothing to render", async () => {
    const { queue, handlers } = fakeQueue();
    await registerRenderStatementWorker(queue, async () => "skipped");

    await expect(
      handlers.get(RENDER_STATEMENT_PDF_JOB)?.({ statementId }),
    ).resolves.toBeUndefined();
  });

  it("lets a failure fail the job, so the queue retries", async () => {
    const { queue, handlers } = fakeQueue();
    await registerRenderStatementWorker(queue, async () => {
      throw new Error("browser down");
    });

    await expect(
      handlers.get(RENDER_STATEMENT_PDF_JOB)?.({ statementId }),
    ).rejects.toThrow("browser down");
  });

  it.each([{}, { statementId: "nope" }, null, "x"])(
    "rejects the invalid payload %j without running anything",
    async (payload) => {
      const { queue, handlers } = fakeQueue();
      const run = vi.fn();
      await registerRenderStatementWorker(queue, run);

      await expect(
        handlers.get(RENDER_STATEMENT_PDF_JOB)?.(payload),
      ).rejects.toThrow(/payload/i);
      expect(run).not.toHaveBeenCalled();
    },
  );
});
