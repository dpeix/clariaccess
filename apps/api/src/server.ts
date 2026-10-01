import { buildApp } from "./app.js";
import { parseEnv } from "./env.js";

const env = parseEnv(process.env);
const app = buildApp();

try {
  await app.listen({ host: env.HOST, port: env.PORT });
  console.log(`api listening on http://${env.HOST}:${env.PORT}`);
} catch (error) {
  console.error("api failed to start", error);
  process.exit(1);
}
