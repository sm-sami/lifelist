CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"gradient_start" text NOT NULL,
	"gradient_end" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_gradient_start_hex_ck" CHECK ("categories"."gradient_start" ~ '^#[0-9A-Fa-f]{6}$'),
	CONSTRAINT "categories_gradient_end_hex_ck" CHECK ("categories"."gradient_end" ~ '^#[0-9A-Fa-f]{6}$')
);
--> statement-breakpoint
CREATE TABLE "items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"category_id" uuid,
	"title" text NOT NULL,
	"notes" text,
	"image_url" text,
	"image_attribution" text,
	"image_attribution_url" text,
	"status" text DEFAULT 'pending_enrichment' NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "items_completed_consistency_ck" CHECK (("items"."status" = 'completed') = ("items"."completed_at" is not null)),
	CONSTRAINT "items_status_values_ck" CHECK ("items"."status" in ('pending_enrichment', 'active', 'completed')),
	CONSTRAINT "items_title_not_empty_ck" CHECK (char_length(trim("items"."title")) > 0)
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_id_user_unique_idx" ON "categories" USING btree ("id","user_id");--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_category_user_fk" FOREIGN KEY ("category_id","user_id") REFERENCES "public"."categories"("id","user_id") ON DELETE SET NULL ("category_id") ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "categories_user_slug_unique_idx" ON "categories" USING btree ("user_id","slug");--> statement-breakpoint
CREATE INDEX "categories_user_id_idx" ON "categories" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_user_id_idx" ON "items" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "items_category_id_idx" ON "items" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "items_user_status_created_idx" ON "items" USING btree ("user_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique_idx" ON "users" USING btree ("email") WHERE "users"."email" is not null;--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "categories" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "users", "categories", "items" FROM anon;--> statement-breakpoint
REVOKE ALL PRIVILEGES ON TABLE "users", "categories", "items" FROM authenticated;--> statement-breakpoint
GRANT SELECT ON TABLE "users", "categories", "items" TO authenticated;--> statement-breakpoint
DROP POLICY IF EXISTS "categories_owner_all" ON "categories";--> statement-breakpoint
DROP POLICY IF EXISTS "categories_owner_select" ON "categories";--> statement-breakpoint
CREATE POLICY "categories_owner_select" ON "categories"
  FOR SELECT TO authenticated
  USING ("user_id" = auth.uid());--> statement-breakpoint
DROP POLICY IF EXISTS "items_owner_all" ON "items";--> statement-breakpoint
DROP POLICY IF EXISTS "items_owner_select" ON "items";--> statement-breakpoint
CREATE POLICY "items_owner_select" ON "items"
  FOR SELECT TO authenticated
  USING ("user_id" = auth.uid());--> statement-breakpoint
DROP POLICY IF EXISTS "users_self_select" ON "users";--> statement-breakpoint
CREATE POLICY "users_self_select" ON "users"
  FOR SELECT TO authenticated
  USING ("id" = auth.uid());
