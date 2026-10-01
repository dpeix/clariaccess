import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildArtifacts } from "./generate.js";
import { buildOpenApiDocument } from "./openapi.js";

const readCommitted = (relativePath: string) =>
  readFileSync(new URL(relativePath, import.meta.url), "utf8");

describe("buildOpenApiDocument", () => {
  const doc = buildOpenApiDocument();

  it("is an OpenAPI 3.1 document with title and version", () => {
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.info.title).toBeTruthy();
    expect(doc.info.version).toBeTruthy();
  });

  it("declares exactly the step 3 endpoints", () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      "/audits/free",
      "/audits/{id}",
      "/audits/{id}/report",
      "/leads",
    ]);
    expect(doc.paths?.["/audits/free"]).toHaveProperty("post");
    expect(doc.paths?.["/audits/{id}"]).toHaveProperty("get");
    expect(doc.paths?.["/audits/{id}/report"]).toHaveProperty("get");
    expect(doc.paths?.["/leads"]).toHaveProperty("post");
  });

  it("makes consent a required property of the lead request", () => {
    const lead = doc.components?.schemas?.LeadRequest as {
      required?: string[];
    };
    expect(lead.required).toEqual(
      expect.arrayContaining(["email", "auditId", "consent"]),
    );
  });
});

describe("generated artifacts", () => {
  it("openapi.json is up to date (run `pnpm --filter @accessibility/contracts generate`)", async () => {
    const { openapiJson } = await buildArtifacts();
    expect(readCommitted("../openapi.json")).toBe(openapiJson);
  });

  it("src/generated/api.d.ts is up to date (run `pnpm --filter @accessibility/contracts generate`)", async () => {
    const { apiTypes } = await buildArtifacts();
    expect(readCommitted("./generated/api.d.ts")).toBe(apiTypes);
  });
});
