import Fastify from "fastify";

export function buildApp() {
  const app = Fastify({ logger: false });

  app.get("/health", () => ({ status: "ok" }));

  return app;
}
