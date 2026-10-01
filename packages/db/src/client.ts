import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

export function createDb(connectionString: string) {
  return drizzle({ client: new pg.Pool({ connectionString }), schema });
}

export type Database = ReturnType<typeof createDb>;
