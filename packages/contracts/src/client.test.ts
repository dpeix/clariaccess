import { describe, expect, expectTypeOf, it } from "vitest";
import { createApiClient } from "./client.js";

const auditId = "6f1c1c1e-8d5e-4a37-9d57-3c1a4f0f2a10";

describe("createApiClient", () => {
  it("posts the JSON body to the free audit endpoint and returns the typed audit", async () => {
    const requests: Request[] = [];
    const client = createApiClient("https://api.example.test", {
      fetch: async (request) => {
        requests.push(request.clone());
        return Response.json(
          {
            id: auditId,
            url: "https://example.fr/",
            type: "free",
            status: "queued",
            startedAt: null,
            finishedAt: null,
            pagesScanned: 0,
            score: null,
          },
          { status: 202 },
        );
      },
    });

    const { data, error } = await client.POST("/audits/free", {
      body: { url: "https://example.fr/" },
    });

    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe("https://api.example.test/audits/free");
    expect(requests[0]?.method).toBe("POST");
    expect(await requests[0]?.json()).toEqual({ url: "https://example.fr/" });
    expect(error).toBeUndefined();
    expect(data?.id).toBe(auditId);
    expectTypeOf(data?.status).toEqualTypeOf<
      "queued" | "running" | "completed" | "failed" | undefined
    >();
  });

  it("rejects, at type level, a lead without consent", () => {
    const client = createApiClient("https://api.example.test");
    // Never called: only the compiler check matters.
    const postLead = () =>
      client.POST("/leads", {
        // @ts-expect-error consent must be the literal `true`
        body: { email: "a@b.fr", auditId, consent: false },
      });
    expect(postLead).toBeTypeOf("function");
  });
});
