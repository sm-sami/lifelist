import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migrationDirectory = join(import.meta.dirname, "../drizzle");
const migrationFiles = readdirSync(migrationDirectory)
  .filter((file) => file.endsWith(".sql"))
  .sort();

describe("initial database migration", () => {
  it("contains the manually maintained database invariants", () => {
    expect(migrationFiles).toHaveLength(8);

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

describe("embedding migration", () => {
  it("adds the vector column, embedding_model column, and pair consistency constraint", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[1]), "utf8");

    expect(migration).toContain('ADD COLUMN "embedding" vector(1536)');
    expect(migration).toContain('ADD COLUMN "embedding_model" text');
    expect(migration).toContain('"items_embedding_model_pair"');
  });
});

describe("user provisioning trigger migration", () => {
  it("creates INSERT and UPDATE triggers on auth.users", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[2]), "utf8");

    expect(migration).toContain("handle_new_auth_user");
    expect(migration).toContain("on_auth_user_created");
    expect(migration).toContain("after insert on auth.users");
    expect(migration).toContain("handle_auth_user_updated");
    expect(migration).toContain("on_auth_user_updated");
    expect(migration).toContain("after update of email, raw_user_meta_data on auth.users");
    expect(migration).toContain("security definer set search_path = public");
  });
});

describe("item image storage migration", () => {
  it("creates a private bucket with owner-folder storage policies", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[3]), "utf8");

    expect(migration).toContain("insert into storage.buckets");
    expect(migration).toContain("'item-images'");
    expect(migration).toContain("false");
    expect(migration).toContain("5242880");
    expect(migration).toContain("array['image/jpeg', 'image/png', 'image/webp']");
    expect(migration).toContain('create policy "users select own item images"');
    expect(migration).toContain('create policy "users insert own item images"');
    expect(migration).toContain('create policy "users update own item images"');
    expect(migration).toContain('create policy "users delete own item images"');
    expect(migration).toContain("(storage.foldername(name))[1] = auth.uid()::text");
    expect(migration).toContain("with check");
  });
});

describe("realtime item sync migration", () => {
  it("publishes items changes and secures private broadcast topics", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[4]), "utf8");

    expect(migration).toContain("alter publication supabase_realtime add table items");
    expect(migration).toContain("pg_publication_tables");
    expect(migration).toContain("alter table realtime.messages enable row level security");
    expect(migration).toContain('create policy "users read own broadcast topic"');
    expect(migration).toContain('create policy "users write own broadcast topic"');
    expect(migration).toContain("split_part(realtime.topic(), ':', 2)");
    expect(migration).toContain("realtime.messages.extension = 'broadcast'");
  });
});

describe("skipped foundation repair migration", () => {
  it("idempotently restores embedding columns and user provisioning triggers", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[5]), "utf8");

    expect(migration).toContain("add column embedding vector(1536)");
    expect(migration).toContain("add column embedding_model text");
    expect(migration).toContain("items_embedding_model_pair");
    expect(migration).toContain("handle_new_auth_user");
    expect(migration).toContain("on_auth_user_created");
    expect(migration).toContain("handle_auth_user_updated");
    expect(migration).toContain("on_auth_user_updated");
    expect(migration).toContain("on conflict (id) do nothing");
  });
});

describe("experience search metadata migration", () => {
  it("adds the normalized Headout query and location columns", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[6]), "utf8");

    expect(migration).toContain("experience_search_query text");
    expect(migration).toContain("experience_location text");
  });
});

describe("souvenir image migration", () => {
  it("adds a separate completed-item souvenir image column", () => {
    const migration = readFileSync(join(migrationDirectory, migrationFiles[7]), "utf8");

    expect(migration).toContain("souvenir_image_url text");
  });
});
