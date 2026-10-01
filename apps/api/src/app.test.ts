import { describe, expect, it } from "vitest";
import type { Database } from "@accessibility/db";
import { buildApp } from "./app.js";
import { FakeQueue } from "./test/fakes.js";
import { defaultTestConfig } from "./test/harness.js";

// Routes under test here never touch the database.
const app = () =>
  buildApp({
    db: {} as Database,
    queue: new FakeQueue(),
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
