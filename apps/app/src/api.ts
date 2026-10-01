import { createApiClient } from "@accessibility/contracts/client";
import { errorMessage } from "./lib/messages.js";

// Cookies travel only because of `credentials: "include"`; the API answers
// them only to this app's origin (CORS + Origin check on its side).
export const api = createApiClient(
  import.meta.env.VITE_API_URL ?? "http://localhost:3000",
  { credentials: "include" },
);

export class ApiError extends Error {
  constructor(
    readonly status: number | "network",
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

// Turns an openapi-fetch answer into data or an ApiError whose message is fit
// to show to the user.
export async function call<T>(request: Promise<Result<T>>): Promise<T> {
  let result: Result<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError("network", errorMessage("network", undefined));
  }
  if (!result.response.ok) {
    throw new ApiError(
      result.response.status,
      errorMessage(result.response.status, result.error),
    );
  }
  return result.data as T;
}

export const isUnauthorized = (error: unknown): boolean =>
  error instanceof ApiError && error.status === 401;
