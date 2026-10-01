import createClient, { type ClientOptions } from "openapi-fetch";
import type { paths } from "./generated/api.js";

export function createApiClient(
  baseUrl: string,
  options: Omit<ClientOptions, "baseUrl"> = {},
) {
  return createClient<paths>({ baseUrl, ...options });
}
