import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const directUrl = process.env.DIRECT_URL;
  if (!directUrl) {
    throw new Error("DIRECT_URL is not set.");
  }

  const migrationClient = postgres(directUrl, { max: 1 });

  try {
    const db = drizzle(migrationClient);
    console.log("[migrate] applying migrations from ./drizzle ...");
    await migrate(db, { migrationsFolder: "./drizzle" });
    console.log("[migrate] done.");
  } finally {
    await migrationClient.end({ timeout: 5 });
  }
}

main().catch((error: unknown) => {
  console.error("[migrate] failed:", error);
  process.exit(1);
});
