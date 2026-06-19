import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL is not set. Expected the Supavisor transaction pooler URL (port 6543).",
  );
}

const globalForDb = globalThis as unknown as {
  __lifelistSql?: ReturnType<typeof postgres>;
};

const sql =
  globalForDb.__lifelistSql ??
  postgres(connectionString, {
    prepare: false,
    max: 1,
    idle_timeout: 20,
    max_lifetime: 60 * 30,
    connection: {
      application_name: "lifelist-backend",
    },
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__lifelistSql = sql;
}

export const db = drizzle(sql, {
  schema,
  logger: process.env.NODE_ENV !== "production",
});
export { schema };
