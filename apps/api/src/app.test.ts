import { describe, expect, it } from "vitest";
import type { Database } from "@accessibility/db";
import { buildApp } from "./app.js";
import { FakeMailer, FakeQueue } from "./test/fakes.js";
import { defaultTestConfig } from "./test/harness.js";

// Routes under test here never touch the database.
const app = () =>
  buildApp({
    db: {} as Database,
    queue: new FakeQueue(),
    mailer: new FakeMailer(),
    config: defaultTestConfig,
  });

describe("GET /health", () => {
  it("returns ok", async () => {
    const response = await app().inject({ method: "GET", url: "/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: "ok" });
  });

  it("returns 404 in the error format on unknown routes", async () => {
    const response = await app().inject({ method: "GET", url: "/nope" });

    expect(response.statusCode).toBe(404);
    expect(response.json()).toMatchObject({ error: "not_found" });
  });
});

describe("CORS", () => {
  const preflight = (origin: string) =>
    app().inject({
      method: "OPTIONS",
      url: "/audits/free",
      headers: {
        origin,
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type",
      },
    });

  it("allows the public site origin, and only that origin", async () => {
    const response = await preflight(defaultTestConfig.corsOrigin);

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-origin"]).toBe(
      defaultTestConfig.corsOrigin,
    );
    expect(response.headers["access-control-allow-methods"]).toContain("POST");
  });

  it("does not allow another origin", async () => {
    const response = await preflight("https://evil.example");

    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("lets the customer app send credentials, with PATCH", async () => {
    const response = await preflight(defaultTestConfig.appOrigin);

    expect(response.headers["access-control-allow-origin"]).toBe(
      defaultTestConfig.appOrigin,
    );
    expect(response.headers["access-control-allow-credentials"]).toBe("true");
    expect(response.headers["access-control-allow-methods"]).toContain("PATCH");
  });

  it("exposes the allowed origin on actual responses", async () => {
    const response = await app().inject({
      method: "GET",
      url: "/health",
      headers: { origin: defaultTestConfig.corsOrigin },
    });

    expect(response.headers["access-control-allow-origin"]).toBe(
      defaultTestConfig.corsOrigin,
    );
  });
});
