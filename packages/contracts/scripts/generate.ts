import { writeFileSync } from "node:fs";
import { buildArtifacts } from "../src/generate.js";

const { openapiJson, apiTypes } = await buildArtifacts();
writeFileSync(new URL("../openapi.json", import.meta.url), openapiJson);
writeFileSync(new URL("../src/generated/api.d.ts", import.meta.url), apiTypes);
