import { createApiClient } from "@accessibility/contracts/client";

// Build-time public setting; must match an origin the API's CORS allows.
export const api = createApiClient(
  import.meta.env.PUBLIC_API_URL ?? "http://localhost:3000",
);
