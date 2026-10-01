import { describe, expect, it } from "vitest";
import {
  COMPLIANCE_STATUSES,
  COMPUTED_COMPLIANCE_STATUSES,
  MANUAL_STATUSES,
  STATEMENT_LOCALES,
  STATEMENT_STATUSES,
  manualCheckListSchema,
  publishStatementRequestSchema,
  statementSchema,
  updateStatementRequestSchema,
  upsertManualCheckRequestSchema,
} from "./schemas.js";
import {
  REQUIRED_STATEMENT_FIELDS,
  missingStatementFields,
} from "./statements.js";

const uuid = "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10";

describe("enums", () => {
  it("lists the manual statuses, compliance levels, statement states and locales", () => {
    expect(MANUAL_STATUSES).toEqual(["ok", "ko", "na"]);
    expect(COMPLIANCE_STATUSES).toEqual(["total", "partiel", "non"]);
    expect(COMPUTED_COMPLIANCE_STATUSES).toEqual([
      "total",
      "partiel",
      "non",
      "indetermine",
    ]);
    expect(STATEMENT_STATUSES).toEqual(["draft", "published", "superseded"]);
    expect(STATEMENT_LOCALES).toEqual(["fr"]);
  });
});

describe("upsertManualCheckRequestSchema", () => {
  it("accepts a status with optional notes and evidence", () => {
    expect(
      upsertManualCheckRequestSchema.safeParse({ status: "ok" }).success,
    ).toBe(true);
    expect(
      upsertManualCheckRequestSchema.safeParse({
        status: "ko",
        notes: "Le bouton n'a pas de nom.",
        evidenceUrl: "https://example.fr/capture.png",
      }).success,
    ).toBe(true);
    expect(
      upsertManualCheckRequestSchema.safeParse({
        status: "ok",
        evidenceUrl: null,
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown status, long notes and a non-http evidence link", () => {
    expect(
      upsertManualCheckRequestSchema.safeParse({ status: "maybe" }).success,
    ).toBe(false);
    expect(upsertManualCheckRequestSchema.safeParse({}).success).toBe(false);
    expect(
      upsertManualCheckRequestSchema.safeParse({
        status: "ok",
        notes: "x".repeat(5001),
      }).success,
    ).toBe(false);
    for (const evidenceUrl of [
      "javascript:alert(1)",
      "data:text/html,x",
      "ftp://x.fr/a",
      "nope",
    ]) {
      expect(
        upsertManualCheckRequestSchema.safeParse({ status: "ok", evidenceUrl })
          .success,
        evidenceUrl,
      ).toBe(false);
    }
  });
});

describe("manualCheckListSchema", () => {
  it("describes the criteria with what was checked by hand and what the scan sees", () => {
    const list = {
      referentialVersion: "4.1",
      themes: [{ number: 1, title: "Images" }],
      criteria: [
        {
          id: "1.1",
          theme: 1,
          title: "Chaque image a-t-elle une alternative textuelle ?",
          autoTested: true,
          axeRules: ["image-alt"],
          autoProblems: 0,
          check: null,
        },
      ],
      progress: { checked: 0, total: 1 },
    };

    expect(manualCheckListSchema.safeParse(list).success).toBe(true);
    expect(
      manualCheckListSchema.safeParse({
        ...list,
        criteria: [
          {
            ...list.criteria[0],
            check: {
              status: "ok",
              notes: "",
              evidenceUrl: null,
              checkedBy: "a@b.fr",
              checkedAt: "2026-10-02T10:00:00.000Z",
            },
          },
        ],
      }).success,
    ).toBe(true);
  });
});

describe("updateStatementRequestSchema", () => {
  it("accepts any subset of the editable fields", () => {
    expect(
      updateStatementRequestSchema.safeParse({ contactEmail: "a@b.fr" })
        .success,
    ).toBe(true);
    expect(
      updateStatementRequestSchema.safeParse({
        entityName: "Acme",
        contactUrl: "https://acme.fr/contact",
        derogations: "",
        samplePages: ["https://acme.fr/"],
        technologies: "HTML, CSS",
        testEnvironment: "Firefox + NVDA",
        tools: "axe-core",
      }).success,
    ).toBe(true);
  });

  it("refuses an empty update and unsafe values", () => {
    expect(updateStatementRequestSchema.safeParse({}).success).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({ contactEmail: "nope" }).success,
    ).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({
        contactUrl: "javascript:alert(1)",
      }).success,
    ).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({ samplePages: ["not a url"] })
        .success,
    ).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({ entityName: "x".repeat(201) })
        .success,
    ).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({ technologies: "x".repeat(2001) })
        .success,
    ).toBe(false);
    expect(
      updateStatementRequestSchema.safeParse({
        samplePages: Array(51).fill("https://a.fr/"),
      }).success,
    ).toBe(false);
  });
});

describe("publishStatementRequestSchema", () => {
  it("needs a level the publisher chooses, never the undetermined one", () => {
    expect(
      publishStatementRequestSchema.safeParse({ declaredStatus: "partiel" })
        .success,
    ).toBe(true);
    expect(
      publishStatementRequestSchema.safeParse({ declaredStatus: "indetermine" })
        .success,
    ).toBe(false);
    expect(publishStatementRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe("statementSchema", () => {
  const statement = {
    id: uuid,
    siteId: uuid,
    version: 1,
    status: "draft",
    computedStatus: "indetermine",
    declaredStatus: null,
    complianceRate: null,
    allowedStatuses: [],
    counts: { conforme: 0, nonConforme: 0, na: 0, aVerifier: 106 },
    unattributed: 0,
    entityName: null,
    contactEmail: null,
    contactUrl: null,
    derogations: null,
    samplePages: [],
    technologies: null,
    testEnvironment: null,
    tools: null,
    nonAccessibleContent: [],
    locale: "fr",
    referentialVersion: "4.1",
    missing: ["entityName"],
    publicPath: null,
    pdfReady: false,
    publishedAt: null,
    createdAt: "2026-10-02T10:00:00.000Z",
    updatedAt: "2026-10-02T10:00:00.000Z",
  };

  it("describes a draft and a published statement", () => {
    expect(statementSchema.safeParse(statement).success).toBe(true);
    expect(
      statementSchema.safeParse({
        ...statement,
        status: "published",
        declaredStatus: "partiel",
        publicPath: "/d/abcdefghijkl",
        publishedAt: "2026-10-02T10:00:00.000Z",
      }).success,
    ).toBe(true);
  });

  it("rejects an unknown status", () => {
    expect(
      statementSchema.safeParse({ ...statement, status: "weird" }).success,
    ).toBe(false);
  });
});

describe("missingStatementFields", () => {
  const complete = {
    entityName: "Acme",
    contactEmail: "contact@acme.fr",
    contactUrl: null,
    samplePages: ["https://acme.fr/"],
    technologies: "HTML, CSS",
    testEnvironment: "Firefox + NVDA",
    tools: "axe-core",
  };

  it("lists what a statement still needs", () => {
    expect(missingStatementFields(complete)).toEqual([]);
    expect(
      missingStatementFields({
        entityName: null,
        contactEmail: null,
        contactUrl: null,
        samplePages: [],
        technologies: "  ",
        testEnvironment: null,
        tools: "",
      }),
    ).toEqual([...REQUIRED_STATEMENT_FIELDS]);
  });

  it("accepts a contact page instead of an email", () => {
    expect(
      missingStatementFields({
        ...complete,
        contactEmail: null,
        contactUrl: "https://acme.fr/contact",
      }),
    ).toEqual([]);
  });

  it("asks for a contact when there is neither", () => {
    expect(missingStatementFields({ ...complete, contactEmail: null })).toEqual(
      ["contact"],
    );
  });

  it("names each missing field once", () => {
    expect(
      missingStatementFields({ ...complete, tools: null, technologies: null }),
    ).toEqual(["technologies", "tools"]);
  });
});
