import { createTransport } from "nodemailer";
import type { MailMessage, Mailer } from "./mailer.js";

// The part of a nodemailer transport we use, so tests need no SMTP server.
interface Transport {
  sendMail(options: MailMessage & { from: string }): Promise<unknown>;
}

export class NodemailerMailer implements Mailer {
  readonly #transport: Transport;
  readonly #from: string;

  constructor(transport: Transport, from: string) {
    this.#transport = transport;
    this.#from = from;
  }

  async send(message: MailMessage): Promise<void> {
    await this.#transport.sendMail({ from: this.#from, ...message });
  }
}

export function createSmtpMailer(smtpUrl: string, from: string): Mailer {
  return new NodemailerMailer(createTransport(smtpUrl), from);
}
