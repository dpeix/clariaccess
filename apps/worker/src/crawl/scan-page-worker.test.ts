import { describe, expect, it, vi } from "vitest";
import { SCAN_PAGE_JOB, type JobQueue } from "@accessibility/queue";
import { registerScanPageWorker } from "./scan-page-worker.js";

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

const auditId = "11111111-1111-4111-8111-111111111111";
const pageId = "22222222-2222-4222-8222-222222222222";

describe("registerScanPageWorker", () => {
  it("scans the page named in the payload", async () => {
    const { queue, handlers } = fakeQueue();
    const run = vi.fn(async () => "done" as const);
    await registerScanPageWorker(queue, run);

    await handlers.get(SCAN_PAGE_JOB)?.({ auditId, pageId });

    expect(run).toHaveBeenCalledWith({ auditId, pageId });
  });

  it.each([{}, { auditId }, { auditId, pageId: "nope" }, null])(
    "rejects the invalid payload %j without running anything",
    async (payload) => {
      const { queue, handlers } = fakeQueue();
      const run = vi.fn();
      await registerScanPageWorker(queue, run);

      await expect(handlers.get(SCAN_PAGE_JOB)?.(payload)).rejects.toThrow(
        /payload/i,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
});
