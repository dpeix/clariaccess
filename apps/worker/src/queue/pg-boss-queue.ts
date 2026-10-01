import { PgBoss } from "pg-boss";
import type { JobQueue } from "./job-queue.js";

export interface PgBossQueueOptions {
  retryLimit?: number;
  retryDelaySeconds?: number;
  // How long a job may run before the queue considers it lost and retries it.
  jobExpireSeconds?: number;
}

export class PgBossQueue implements JobQueue {
  readonly #boss: PgBoss;
  readonly #options: PgBossQueueOptions;
  readonly #queues = new Set<string>();

  constructor(connectionString: string, options: PgBossQueueOptions = {}) {
    this.#boss = new PgBoss(connectionString);
    this.#options = options;
    // Without a listener an 'error' event would crash the process.
    this.#boss.on("error", (error) => {
      console.error(`pg-boss error: ${error.message}`);
    });
  }

  async start(): Promise<void> {
    await this.#boss.start();
  }

  async enqueue(name: string, payload: object): Promise<string | null> {
    await this.#ensureQueue(name);
    return this.#boss.send(name, payload);
  }

  async work(
    name: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    await this.#ensureQueue(name);
    await this.#boss.work<unknown>(name, async (jobs) => {
      for (const job of jobs) await handler(job.data);
    });
  }

  async stop(): Promise<void> {
    await this.#boss.stop({ graceful: true });
  }

  async #ensureQueue(name: string): Promise<void> {
    if (this.#queues.has(name)) return;
    await this.#boss.createQueue(name, {
      retryLimit: this.#options.retryLimit ?? 2,
      retryDelay: this.#options.retryDelaySeconds ?? 30,
      expireInSeconds: this.#options.jobExpireSeconds ?? 600,
    });
    this.#queues.add(name);
  }
}
