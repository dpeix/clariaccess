import { describe, expect, it } from "vitest";
import { verificationInstructions } from "./verification.js";

describe("verificationInstructions", () => {
  const token = "tok_123-abc";

  it("puts the proof in a TXT record on a dedicated subdomain", () => {
    expect(
      verificationInstructions("https://www.acme.fr/", token).dnsRecord,
    ).toEqual({
      type: "TXT",
      name: "_clariaccess.www.acme.fr",
      value: "clariaccess-verify=tok_123-abc",
    });
  });

  it("ignores the port in the DNS name", () => {
    expect(
      verificationInstructions("http://acme.fr:8080", token).dnsRecord.name,
    ).toBe("_clariaccess.acme.fr");
  });

  it("asks for a well-known file whose content is the same proof", () => {
    expect(verificationInstructions("https://acme.fr", token).file).toEqual({
      path: "/.well-known/clariaccess-tok_123-abc.txt",
      content: "clariaccess-verify=tok_123-abc",
    });
  });
});
