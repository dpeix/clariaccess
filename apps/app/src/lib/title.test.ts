import { describe, expect, it } from "vitest";
import { siteTitle } from "./title.js";

describe("siteTitle", () => {
  it("puts the page first and the app name after", () => {
    expect(siteTitle("Connexion")).toBe("Connexion | Espace client");
  });
});
