import { describe, expect, it } from "vitest";
import { PLACEHOLDER, assertLegalComplete, findPlaceholders } from "./legal.js";

const filled = {
  companyName: "Acme SAS",
  legalForm: "SAS",
  siren: "123 456 789",
  address: "1 rue de Paris, 75000 Paris",
  publisher: "Jeanne Martin",
  hostName: "Scaleway",
  hostAddress: "8 rue de la Ville l'Evêque, 75008 Paris",
  contactEmail: "contact@acme.fr",
  dpoEmail: "dpo@acme.fr",
  mailProvider: "Brevo",
  dataRetention: "12 mois",
};

describe("findPlaceholders", () => {
  it("lists the fields still to be filled in", () => {
    expect(
      findPlaceholders({
        ...filled,
        siren: PLACEHOLDER,
        dpoEmail: PLACEHOLDER,
      }),
    ).toEqual(["siren", "dpoEmail"]);
  });

  it("returns nothing once everything is filled", () => {
    expect(findPlaceholders(filled)).toEqual([]);
  });

  it("treats blank values as missing", () => {
    expect(findPlaceholders({ ...filled, address: "  " })).toEqual(["address"]);
  });
});

describe("assertLegalComplete", () => {
  it("throws in production, naming the missing fields", () => {
    expect(() =>
      assertLegalComplete({ ...filled, siren: PLACEHOLDER }, "production"),
    ).toThrow(/siren/);
  });

  it("lets development builds through with placeholders", () => {
    expect(() =>
      assertLegalComplete({ ...filled, siren: PLACEHOLDER }, undefined),
    ).not.toThrow();
    expect(() =>
      assertLegalComplete({ ...filled, siren: PLACEHOLDER }, "development"),
    ).not.toThrow();
  });

  it("passes in production when complete", () => {
    expect(() => assertLegalComplete(filled, "production")).not.toThrow();
  });
});
