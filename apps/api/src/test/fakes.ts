import type { JobQueue } from "@accessibility/queue";
import type { MailMessage, Mailer } from "../mail/mailer.js";

export interface EnqueuedJob {
  name: string;
  payload: object;
}

// Records jobs instead of running them; `failEnqueue` simulates a queue outage.
export class FakeQueue implements JobQueue {
  readonly jobs: EnqueuedJob[] = [];
  readonly handlers = new Map<string, (payload: unknown) => Promise<void>>();
  failEnqueue = false;

  async start(): Promise<void> {}
  async enqueue(name: string, payload: object): Promise<string | null> {
    if (this.failEnqueue) throw new Error("queue down");
    this.jobs.push({ name, payload });
    return `job-${this.jobs.length}`;
  }
  async work(
    name: string,
    handler: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    this.handlers.set(name, handler);
  }
  async stop(): Promise<void> {}
}

export class FakeMailer implements Mailer {
  readonly sent: MailMessage[] = [];
  fail = false;

  async send(message: MailMessage): Promise<void> {
    if (this.fail) throw new Error("smtp down");
    this.sent.push(message);
  }
}
