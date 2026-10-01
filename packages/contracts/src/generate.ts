import openapiTS, { astToString } from "openapi-typescript";
import { buildOpenApiDocument } from "./openapi.js";

// Single source for both the CLI (scripts/generate.ts) and the "up to date" tests.
export async function buildArtifacts() {
  const document = buildOpenApiDocument();
  const ast = await openapiTS(
    document as unknown as Parameters<typeof openapiTS>[0],
  );
  return {
    openapiJson: `${JSON.stringify(document, null, 2)}\n`,
    apiTypes: astToString(ast),
  };
}
