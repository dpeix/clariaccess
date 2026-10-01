import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, MESSAGES_FR, isLocale, t } from "./i18n.js";

describe("t", () => {
  it("returns the message of a key", () => {
    expect(t("fr", "statement.title")).toBe("Déclaration d'accessibilité");
  });

  it("fills in {placeholders}", () => {
    expect(
      t("fr", "statement.commitment", {
        entity: "Acme",
        site: "https://acme.fr",
      }),
    ).toContain("Acme");
    expect(
      t("fr", "statement.commitment", {
        entity: "Acme",
        site: "https://acme.fr",
      }),
    ).toContain("https://acme.fr");
  });

  it("leaves a placeholder visible when its value is missing, rather than printing 'undefined'", () => {
    expect(t("fr", "statement.commitment", { entity: "Acme" })).toContain(
      "{site}",
    );
  });

  it("does not re-interpret placeholders inside a value", () => {
    const text = t("fr", "statement.commitment", {
      entity: "{site}",
      site: "S",
    });

    expect(text).toContain("{site}");
    expect(text.match(/S\b/g)?.length).toBeGreaterThan(0);
  });

  it("falls back on French for a language that is not offered", () => {
    expect(t("xx" as never, "statement.title")).toBe(
      t("fr", "statement.title"),
    );
  });
});

describe("locales", () => {
  it("offers French, the default", () => {
    expect(DEFAULT_LOCALE).toBe("fr");
    expect(isLocale("fr")).toBe(true);
    expect(isLocale("en")).toBe(false);
    expect(isLocale("constructor")).toBe(false);
  });
});

describe("the French dictionary", () => {
  it("has no empty message", () => {
    for (const [key, message] of Object.entries(MESSAGES_FR)) {
      expect(message.length, key).toBeGreaterThan(0);
    }
  });

  it("only uses placeholders that are plain words", () => {
    for (const [key, message] of Object.entries(MESSAGES_FR)) {
      for (const match of message.matchAll(/\{([^}]*)\}/g)) {
        expect(match[1], key).toMatch(/^[a-zA-Z]+$/);
      }
    }
  });

  it("states each compliance level in words", () => {
    expect(t("fr", "level.total")).toBe("totalement conforme");
    expect(t("fr", "level.partiel")).toBe("partiellement conforme");
    expect(t("fr", "level.non")).toBe("non conforme");
  });
});
