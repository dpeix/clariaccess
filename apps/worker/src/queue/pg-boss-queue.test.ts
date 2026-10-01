import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  createTestDatabase,
  type TestDatabase,
} from "@accessibility/db/test-helpers";
import { adminDatabaseUrl } from "../test/integration.js";
import { PgBossQueue } from "./pg-boss-queue.js";

const adminUrl = adminDatabaseUrl();

function waitFor<T>(poll: () => T | undefined, timeoutMs = 15_000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      const value = poll();
      if (value !== undefined) {
        clearInterval(timer);
        resolve(value);
      } else if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        reject(new Error("timed out waiting for the job"));
      }
    }, 50);
  });
}

describe.skipIf(adminUrl === undefined)("PgBossQueue", () => {
  let test: TestDatabase;
  let queue: PgBossQueue;

  beforeAll(async () => {
    test = await createTestDatabase(adminUrl as string);
    queue = new PgBossQueue(test.url, { retryLimit: 1, retryDelaySeconds: 1 });
    await queue.start();
  });
  afterAll(async () => {
    await queue.stop();
    await test.close();
  });

  it("delivers an enqueued payload to the worker", async () => {
    const received: unknown[] = [];
    await queue.work("test-deliver", async (payload) => {
      received.push(payload);
    });
    const id = await queue.enqueue("test-deliver", { auditId: "abc" });
    expect(id).toEqual(expect.any(String));
    expect(await waitFor(() => received[0])).toEqual({ auditId: "abc" });
  });

  it("retries a job whose handler throws", async () => {
    let attempts = 0;
    await queue.work("test-retry", async () => {
      attempts += 1;
      if (attempts === 1) throw new Error("transient failure");
    });
    await queue.enqueue("test-retry", { n: 1 });
    await waitFor(() => (attempts >= 2 ? attempts : undefined));
    expect(attempts).toBe(2);
  });

  it("can enqueue before any worker is registered", async () => {
    const received: unknown[] = [];
    await queue.enqueue("test-late-worker", { n: 2 });
    await queue.work("test-late-worker", async (payload) => {
      received.push(payload);
    });
    expect(await waitFor(() => received[0])).toEqual({ n: 2 });
  });
});
