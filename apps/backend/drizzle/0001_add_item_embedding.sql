ALTER TABLE "items" ADD COLUMN "embedding" vector(1536);--> statement-breakpoint
ALTER TABLE "items" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "items" ADD CONSTRAINT "items_embedding_model_pair" CHECK (("items"."embedding" IS NULL) = ("items"."embedding_model" IS NULL));
