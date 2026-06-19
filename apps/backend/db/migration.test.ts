import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(import.meta.dirname, "../drizzle");
const migrationFiles = readdirSync(migrationDirectory).filter((file) => file.endsWith(".sql"));

describe("initial database migration", () => {
  it("contains the manually maintained database invariants", () => {
    expect(migrationFiles).toHaveLength(1);

    const migration = readFileSync(join(migrationDirectory, migrationFiles[0]), "utf8");

    expect(migration).toContain("CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions");
    expect(migration).toContain('CONSTRAINT "items_completed_consistency_ck"');
    expect(migration).toContain('CONSTRAINT "items_status_values_ck"');
    expect(migration).toContain('CONSTRAINT "items_title_not_empty_ck"');
    expect(migration).toContain('ON DELETE SET NULL ("category_id") ON UPDATE no action');
    expect(migration).toContain('ALTER TABLE "users" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain('ALTER TABLE "items" ENABLE ROW LEVEL SECURITY');
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "users", "categories", "items" FROM anon',
    );
    expect(migration).toContain(
      'REVOKE ALL PRIVILEGES ON TABLE "users", "categories", "items" FROM authenticated',
    );
    expect(migration).toContain(
      'GRANT SELECT ON TABLE "users", "categories", "items" TO authenticated',
    );
    expect(migration).toContain('CREATE POLICY "categories_owner_select"');
    expect(migration).toContain('CREATE POLICY "items_owner_select"');
    expect(migration).toContain('CREATE POLICY "users_self_select"');
  });
});
