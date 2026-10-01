import { describe, expect, it } from "vitest";
import { errorMessage, safeHttpUrl } from "./messages.js";

describe("errorMessage", () => {
  it("shows the message the API wrote for the user", () => {
    expect(
      errorMessage(409, {
        error: "audit_in_progress",
        message: "Un audit est déjà en cours.",
      }),
    ).toBe("Un audit est déjà en cours.");
  });

  it("falls back on the status when the body has no message", () => {
    expect(errorMessage(429, undefined)).toMatch(/trop de demandes/i);
    expect(errorMessage(404, {})).toMatch(/introuvable/i);
    expect(errorMessage(500, null)).toMatch(/réessayez/i);
  });

  it("ignores a message that is not a non-empty string", () => {
    expect(errorMessage(400, { message: 42 })).toMatch(/invalide|vérifiez/i);
    expect(errorMessage(400, { message: "" })).toMatch(/invalide|vérifiez/i);
  });

  it("explains a network failure", () => {
    expect(errorMessage("network", undefined)).toMatch(/connexion/i);
  });

  it("has a generic message for anything else", () => {
    expect(errorMessage(418, undefined).length).toBeGreaterThan(0);
  });

  it("asks to sign in again on a 401", () => {
    expect(errorMessage(401, undefined)).toMatch(/connect/i);
  });
});

describe("safeHttpUrl", () => {
  it("keeps http(s) urls", () => {
    expect(safeHttpUrl("https://dequeuniversity.com/rules/axe/x")).toBe(
      "https://dequeuniversity.com/rules/axe/x",
    );
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "nope", ""])(
    "rejects %j",
    (value) => {
      expect(safeHttpUrl(value)).toBeNull();
    },
  );

  it("passes null through", () => {
    expect(safeHttpUrl(null)).toBeNull();
  });
});
