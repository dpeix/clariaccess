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

  it("declares exactly the public and the account endpoints", () => {
    expect(Object.keys(doc.paths ?? {}).sort()).toEqual([
      "/audits/free",
      "/audits/{id}",
      "/audits/{id}/pages",
      "/audits/{id}/report",
      "/auth/login",
      "/auth/logout",
      "/auth/verify",
      "/d/{slug}",
      "/d/{slug}/pdf",
      "/findings/{id}",
      "/leads",
      "/me",
      "/orgs",
      "/orgs/{orgId}/members",
      "/orgs/{orgId}/sites",
      "/sites/{id}",
      "/sites/{id}/audits",
      "/sites/{id}/findings",
      "/sites/{id}/manual-checks",
      "/sites/{id}/manual-checks/{criterionId}",
      "/sites/{id}/schedule",
      "/sites/{id}/statements",
      "/sites/{id}/tasks",
      "/sites/{id}/verify",
      "/statements/{id}",
      "/statements/{id}/publish",
      "/tasks/{id}",
    ]);
    expect(doc.paths?.["/audits/free"]).toHaveProperty("post");
    expect(doc.paths?.["/audits/{id}"]).toHaveProperty("get");
    expect(doc.paths?.["/audits/{id}/report"]).toHaveProperty("get");
    expect(doc.paths?.["/leads"]).toHaveProperty("post");
    expect(doc.paths?.["/orgs"]).toHaveProperty("post");
    expect(doc.paths?.["/orgs"]).toHaveProperty("get");
    expect(doc.paths?.["/findings/{id}"]).toHaveProperty("patch");
  });

  it("protects account endpoints with the session cookie, and only those", () => {
    expect(doc.components?.securitySchemes?.cookieAuth).toMatchObject({
      type: "apiKey",
      in: "cookie",
    });
    const secured = (path: string, method: string) =>
      (doc.paths?.[path] as Record<string, { security?: unknown[] }>)[method]
        ?.security;
    expect(secured("/me", "get")).toEqual([{ cookieAuth: [] }]);
    expect(secured("/sites/{id}/audits", "post")).toEqual([{ cookieAuth: [] }]);
    expect(secured("/auth/login", "post")).toBeUndefined();
    expect(secured("/audits/free", "post")).toBeUndefined();
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

describe("shared enums in the generated client types", () => {
  it("never become nullable because one property using them is", () => {
    const { schemas } = buildOpenApiDocument().components ?? {};
    for (const name of [
      "ComplianceStatus",
      "ScanFrequency",
      "ManualStatus",
      "TaskStatus",
    ]) {
      const schema = schemas?.[name] as
        { type?: unknown; enum?: unknown[] } | undefined;
      expect(schema, name).toBeDefined();
      expect(JSON.stringify(schema), name).not.toContain("null");
    }
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
