import type { FastifyReply } from "fastify";
import type { z } from "zod";
import type { errorSchema } from "@accessibility/contracts";

// Every error answer has the shape of errorSchema (the OpenAPI contract).
export function sendError(
  reply: FastifyReply,
  status: number,
  error: string,
  message: string,
) {
  const body: z.infer<typeof errorSchema> = { error, message };
  return reply.status(status).send(body);
}
