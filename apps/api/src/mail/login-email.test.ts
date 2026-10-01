import { describe, expect, it } from "vitest";
import { renderLoginEmail } from "./login-email.js";

const link = "https://app.example.fr/auth/callback?token=abc_DEF-123";

describe("renderLoginEmail", () => {
  it("has a fixed subject, so nothing variable reaches a header", () => {
    expect(renderLoginEmail(link).subject).toBe("Votre lien de connexion");
  });

  it("puts the link in both the text and the html parts", () => {
    const { text, html } = renderLoginEmail(link);

    expect(text).toContain(link);
    expect(html).toContain(`href="${link}"`);
  });

  it("tells the reader the link is short-lived and can be ignored", () => {
    const { text } = renderLoginEmail(link);

    expect(text).toMatch(/15 minutes/);
    expect(text).toMatch(/ignorez/i);
  });

  it("escapes the link in html", () => {
    const { html } = renderLoginEmail('https://x.fr/?a="><script>');

    expect(html).not.toContain("<script>");
  });
});
