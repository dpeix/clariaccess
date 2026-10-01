import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from "@asteasolutions/zod-to-openapi";
import { z } from "zod";
import {
  auditPageSchema,
  auditReportSchema,
  auditSchema,
  createOrganizationRequestSchema,
  createSiteRequestSchema,
  errorSchema,
  findingListSchema,
  findingSchema,
  findingsQuerySchema,
  freeAuditRequestSchema,
  leadRequestSchema,
  loginRequestSchema,
  manualCheckListSchema,
  meSchema,
  memberSchema,
  organizationSchema,
  setScheduleRequestSchema,
  siteSchema,
  taskListSchema,
  statementSchema,
  taskSchema,
  tasksQuerySchema,
  publishStatementRequestSchema,
  updateStatementRequestSchema,
  updateTaskRequestSchema,
  upsertManualCheckRequestSchema,
  updateFindingRequestSchema,
  verifyLoginRequestSchema,
} from "./schemas.js";

const json = <T extends z.ZodType>(schema: T) => ({
  content: { "application/json": { schema } },
});

const auditIdParams = z.object({ id: z.uuid() });
const idParams = z.object({ id: z.uuid() });
const orgIdParams = z.object({ orgId: z.uuid() });
const secured = [{ cookieAuth: [] }];
const unauthorized = { description: "Not signed in", ...json(errorSchema) };
const notFound = { description: "Not found", ...json(errorSchema) };

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

  registry.registerComponent("securitySchemes", "cookieAuth", {
    type: "apiKey",
    in: "cookie",
    name: "session",
  });

  registry.registerPath({
    method: "post",
    path: "/auth/login",
    summary: "Email a one-time login link (answers the same for any address)",
    request: { body: { required: true, ...json(loginRequestSchema) } },
    responses: {
      202: { description: "Link sent if the address can sign in" },
      400: { description: "Invalid request", ...json(errorSchema) },
      429: { description: "Rate limited", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/verify",
    summary: "Exchange a login link token for a session cookie",
    request: { body: { required: true, ...json(verifyLoginRequestSchema) } },
    responses: {
      200: { description: "Signed in", ...json(meSchema) },
      400: { description: "Invalid or expired link", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/auth/logout",
    summary: "End the current session",
    security: secured,
    responses: { 204: { description: "Signed out" }, 401: unauthorized },
  });

  registry.registerPath({
    method: "get",
    path: "/me",
    summary: "The signed-in user and their organizations",
    security: secured,
    responses: {
      200: { description: "Current user", ...json(meSchema) },
      401: unauthorized,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/orgs",
    summary: "Create an organization owned by the caller",
    security: secured,
    request: {
      body: { required: true, ...json(createOrganizationRequestSchema) },
    },
    responses: {
      201: { description: "Created", ...json(organizationSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/orgs",
    summary: "Organizations the caller belongs to",
    security: secured,
    responses: {
      200: {
        description: "Organizations",
        ...json(z.array(organizationSchema)),
      },
      401: unauthorized,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/orgs/{orgId}/sites",
    summary: "Add a site to an organization",
    security: secured,
    request: {
      params: orgIdParams,
      body: { required: true, ...json(createSiteRequestSchema) },
    },
    responses: {
      201: { description: "Created", ...json(siteSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
      403: {
        description: "The organization's plan allows no more sites",
        ...json(errorSchema),
      },
      409: { description: "Site already added", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/orgs/{orgId}/sites",
    summary: "Sites of an organization",
    security: secured,
    request: { params: orgIdParams },
    responses: {
      200: { description: "Sites", ...json(z.array(siteSchema)) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}",
    summary: "One site, with its verification instructions",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Site", ...json(siteSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/sites/{id}/verify",
    summary: "Check ownership of the site (asynchronous)",
    security: secured,
    request: { params: idParams },
    responses: {
      202: { description: "Verification queued", ...json(siteSchema) },
      401: unauthorized,
      404: notFound,
      503: { description: "Queue unavailable", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "put",
    path: "/sites/{id}/schedule",
    summary: "Set or switch off the re-scan schedule of a verified site",
    security: secured,
    request: {
      params: idParams,
      body: { required: true, ...json(setScheduleRequestSchema) },
    },
    responses: {
      200: { description: "Schedule updated", ...json(siteSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      403: {
        description: "The organization's plan does not allow this frequency",
        ...json(errorSchema),
      },
      404: notFound,
      409: { description: "Site not verified", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/sites/{id}/audits",
    summary: "Start a multi-page audit of a verified site",
    security: secured,
    request: { params: idParams },
    responses: {
      202: { description: "Audit queued", ...json(auditSchema) },
      401: unauthorized,
      404: notFound,
      409: {
        description: "Site not verified or an audit is already running",
        ...json(errorSchema),
      },
      429: { description: "Daily limit reached", ...json(errorSchema) },
      503: { description: "Queue unavailable", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}/audits",
    summary: "Audit history of a site, newest first",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Audits", ...json(z.array(auditSchema)) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/audits/{id}/pages",
    summary: "Pages of an organization audit and their scan status",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Pages", ...json(z.array(auditPageSchema)) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}/findings",
    summary: "Problems followed over time on a site, most urgent first",
    security: secured,
    request: { params: idParams, query: findingsQuerySchema },
    responses: {
      200: { description: "Findings", ...json(findingListSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  const criterionParams = z.object({
    id: z.uuid(),
    criterionId: z.string().regex(/^\d{1,2}\.\d{1,2}$/),
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}/manual-checks",
    summary:
      "RGAA criteria with what was verified by hand and what the scan sees",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Criteria", ...json(manualCheckListSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "put",
    path: "/sites/{id}/manual-checks/{criterionId}",
    summary: "Record the manual verification of one criterion",
    security: secured,
    request: {
      params: criterionParams,
      body: { required: true, ...json(upsertManualCheckRequestSchema) },
    },
    responses: {
      204: { description: "Recorded" },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "delete",
    path: "/sites/{id}/manual-checks/{criterionId}",
    summary: "Forget the manual verification of one criterion",
    security: secured,
    request: { params: criterionParams },
    responses: {
      204: { description: "Removed" },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "post",
    path: "/sites/{id}/statements",
    summary: "Start a draft accessibility statement from the current audit",
    security: secured,
    request: { params: idParams },
    responses: {
      201: { description: "Draft created", ...json(statementSchema) },
      401: unauthorized,
      404: notFound,
      409: { description: "A draft already exists", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}/statements",
    summary: "Versions of the accessibility statement, newest first",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Statements", ...json(z.array(statementSchema)) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/statements/{id}",
    summary: "One statement (a draft is computed from the live audit)",
    security: secured,
    request: { params: idParams },
    responses: {
      200: { description: "Statement", ...json(statementSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "put",
    path: "/statements/{id}",
    summary: "Edit a draft statement",
    security: secured,
    request: {
      params: idParams,
      body: { required: true, ...json(updateStatementRequestSchema) },
    },
    responses: {
      200: { description: "Updated", ...json(statementSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
      409: { description: "Not a draft", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "post",
    path: "/statements/{id}/publish",
    summary:
      "Publish a draft: the page becomes public, the previous version is superseded",
    security: secured,
    request: {
      params: idParams,
      body: { required: true, ...json(publishStatementRequestSchema) },
    },
    responses: {
      200: { description: "Published", ...json(statementSchema) },
      400: {
        description: "Incomplete or level not supported by the audit",
        ...json(errorSchema),
      },
      401: unauthorized,
      403: { description: "Only an owner may publish", ...json(errorSchema) },
      404: notFound,
      409: { description: "Not a draft", ...json(errorSchema) },
    },
  });

  registry.registerPath({
    method: "get",
    path: "/d/{slug}",
    summary: "Public accessibility statement (HTML)",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: "The statement as an HTML page",
        content: { "text/html": { schema: z.string() } },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/d/{slug}/pdf",
    summary: "Public accessibility statement (PDF)",
    request: { params: z.object({ slug: z.string() }) },
    responses: {
      200: {
        description: "The statement as a PDF",
        content: {
          "application/pdf": { schema: z.string().meta({ format: "binary" }) },
        },
      },
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/orgs/{orgId}/members",
    summary: "People of an organization, to assign tasks to",
    security: secured,
    request: { params: orgIdParams },
    responses: {
      200: { description: "Members", ...json(z.array(memberSchema)) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "get",
    path: "/sites/{id}/tasks",
    summary: "The correction plan: one task per rule, most urgent first",
    security: secured,
    request: { params: idParams, query: tasksQuerySchema },
    responses: {
      200: { description: "Tasks", ...json(taskListSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/tasks/{id}",
    summary: "Move a task along, or assign it to a member",
    security: secured,
    request: {
      params: idParams,
      body: { required: true, ...json(updateTaskRequestSchema) },
    },
    responses: {
      200: { description: "Updated", ...json(taskSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  registry.registerPath({
    method: "patch",
    path: "/findings/{id}",
    summary: "Ignore a finding or reopen it",
    security: secured,
    request: {
      params: idParams,
      body: { required: true, ...json(updateFindingRequestSchema) },
    },
    responses: {
      200: { description: "Updated", ...json(findingSchema) },
      400: { description: "Invalid request", ...json(errorSchema) },
      401: unauthorized,
      404: notFound,
    },
  });

  return new OpenApiGeneratorV31(registry.definitions).generateDocument({
    openapi: "3.1.0",
    info: { title: "Accessibility API", version: "0.0.0" },
  });
}
