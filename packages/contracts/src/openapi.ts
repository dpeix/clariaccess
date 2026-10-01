import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  auditReportSchema,
  auditSchema,
  errorSchema,
  freeAuditRequestSchema,
  leadRequestSchema,
} from "./schemas.js";

const json = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});

const auditIdParams = z.object({ id: z.uuid() });

export function buildOpenApiDocument() {
  const registry = new OpenAPIRegistry();

  registry.registerPath({
    method: "post",
    path: "/audits/free",
    summary: "Start a free audit of a public URL",
    request: { body: { required: true, ...json(freeAuditRequestSchema) } },
    responses: {
      202: { description: "Audit queued", ...json(auditSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      429: { description: "Rate limited", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/audits/{id}",
    summary: "Get the status of an audit",
    request: { params: auditIdParams },
    responses: {
      200: { description: "Audit", ...json(auditSchema) },
      404: { description: "Audit not found", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/audits/{id}/report",
    summary: "Get the report of a completed audit",
    request: { params: auditIdParams },
    responses: {
      200: { description: "Report", ...json(auditReportSchema) },
      404: { description: "Audit not found", ...json(errorSchema) },
      409: { description: "Audit not completed", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/leads",
    summary: "Record a lead with explicit consent",
    request: { body: { required: true, ...json(leadRequestSchema) } },
    responses: {
      201: { description: "Lead recorded" },
      400: { description: "Invalid request", ...json(errorSchema) },
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "Accessibility API", version: "0.0.0" },
  });
}
