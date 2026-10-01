import { describe, expect, it, vi } from "vitest";
import { RUN_AUDIT_JOB, type JobQueue } from "@accessibility/queue";
import { registerAuditWorker } from "./audit-worker.js";

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

describe("registerAuditWorker", () => {
  it("runs the audit named in the payload", async () => {
    const { queue, handlers } = fakeQueue();
    const run = vi.fn(async () => "completed" as const);
    await registerAuditWorker(queue, run);
    await handlers.get(RUN_AUDIT_JOB)?.({ auditId });
    expect(run).toHaveBeenCalledWith(auditId);
  });

  it.each([{}, { auditId: "not-a-uuid" }, null, "x"])(
    "rejects the invalid payload %j without running anything",
    async (payload) => {
      const { queue, handlers } = fakeQueue();
      const run = vi.fn();
      await registerAuditWorker(queue, run);
      await expect(handlers.get(RUN_AUDIT_JOB)?.(payload)).rejects.toThrow(
        /payload/i,
      );
      expect(run).not.toHaveBeenCalled();
    },
  );
});
