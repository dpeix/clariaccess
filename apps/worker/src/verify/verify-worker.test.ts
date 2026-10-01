import { describe, expect, it, vi } from "vitest";
import { VERIFY_SITE_JOB, type JobQueue } from "@accessibility/queue";
import { registerVerifyWorker } from "./verify-worker.js";

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

const siteId = "11111111-1111-4111-8111-111111111111";

describe("registerVerifyWorker", () => {
  it("verifies the site named in the payload", async () => {
    const { queue, handlers } = fakeQueue();
    const run = vi.fn(async () => "verified" as const);
    await registerVerifyWorker(queue, run);

    await handlers.get(VERIFY_SITE_JOB)?.({ siteId });

    expect(run).toHaveBeenCalledWith(siteId);
  });

  it("does not fail the job when the proof is missing", async () => {
    const { queue, handlers } = fakeQueue();
    await registerVerifyWorker(queue, async () => "not_verified");

    await expect(
      handlers.get(VERIFY_SITE_JOB)?.({ siteId }),
    ).resolves.toBeUndefined();
  });

  it.each([{}, { siteId: "not-a-uuid" }, null, "x"])(
    "rejects the invalid payload %j without running anything",
    async (payload) => {
      const { queue, handlers } = fakeQueue();
      const run = vi.fn();
      await registerVerifyWorker(queue, run);

      await expect(handlers.get(VERIFY_SITE_JOB)?.(payload)).rejects.toThrow(
        /payload/i,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
});
