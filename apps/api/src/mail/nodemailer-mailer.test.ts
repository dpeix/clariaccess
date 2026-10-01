import { describe, expect, it, vi } from "vitest";
import { NodemailerMailer } from "./nodemailer-mailer.js";

const message = {
  to: "visiteur@example.fr",
  subject: "Sujet",
  text: "texte",
  html: "<p>html</p>",
};

describe("NodemailerMailer", () => {
  it("sends the message from the configured address", async () => {
    const sendMail = vi.fn(async () => ({}));
    await new NodemailerMailer({ sendMail }, "audit@example.fr").send(message);
    expect(sendMail).toHaveBeenCalledWith({
      from: "audit@example.fr",
      ...message,
    });
  });

  it("rejects when the transport refuses the message", async () => {
    const sendMail = vi.fn(async () => {
      throw new Error("smtp down");
    });
    await expect(
      new NodemailerMailer({ sendMail }, "audit@example.fr").send(message),
    ).rejects.toThrow("smtp down");
  });
});
