import { relations, sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(),
    email: text("email"),
    displayName: text("display_name"),
    avatarUrl: text("avatar_url"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("users_email_unique_idx").on(table.email).where(sql`${table.email} is not null`),
  ],
);

export const categories = pgTable(
  "categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    gradientStart: text("gradient_start").notNull(),
    gradientEnd: text("gradient_end").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("categories_user_slug_unique_idx").on(table.userId, table.slug),
    index("categories_user_id_idx").on(table.userId),
    uniqueIndex("categories_id_user_unique_idx").on(table.id, table.userId),
    check("categories_gradient_start_hex_ck", sql`${table.gradientStart} ~ '^#[0-9A-Fa-f]{6}$'`),
    check("categories_gradient_end_hex_ck", sql`${table.gradientEnd} ~ '^#[0-9A-Fa-f]{6}$'`),
  ],
);

export const items = pgTable(
  "items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id"),
    title: text("title").notNull(),
    notes: text("notes"),
    imageUrl: text("image_url"),
    imageAttribution: text("image_attribution"),
    imageAttributionUrl: text("image_attribution_url"),
    status: text("status", {
      enum: ["pending_enrichment", "active", "completed"],
    })
      .notNull()
      .default("pending_enrichment"),
    embedding: vector("embedding", { dimensions: 1536 }),
    embeddingModel: text("embedding_model"),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("items_user_id_idx").on(table.userId),
    index("items_category_id_idx").on(table.categoryId),
    index("items_user_status_created_idx").on(table.userId, table.status, table.createdAt),
    foreignKey({
      columns: [table.categoryId, table.userId],
      foreignColumns: [categories.id, categories.userId],
      name: "items_category_user_fk",
    }).onDelete("set null"),
    check(
      "items_completed_consistency_ck",
      sql`(${table.status} = 'completed') = (${table.completedAt} is not null)`,
    ),
    check(
      "items_status_values_ck",
      sql`${table.status} in ('pending_enrichment', 'active', 'completed')`,
    ),
    check("items_title_not_empty_ck", sql`char_length(trim(${table.title})) > 0`),
    check(
      "items_embedding_model_pair",
      sql`(${table.embedding} is null) = (${table.embeddingModel} is null)`,
    ),
  ],
);

export const usersRelations = relations(users, ({ many }) => ({
  categories: many(categories),
  items: many(items),
}));

export const categoriesRelations = relations(categories, ({ many, one }) => ({
  user: one(users, {
    fields: [categories.userId],
    references: [users.id],
  }),
  items: many(items),
}));

export const itemsRelations = relations(items, ({ one }) => ({
  user: one(users, {
    fields: [items.userId],
    references: [users.id],
  }),
  category: one(categories, {
    fields: [items.categoryId],
    references: [categories.id],
  }),
}));

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Category = typeof categories.$inferSelect;
export type NewCategory = typeof categories.$inferInsert;
export type Item = typeof items.$inferSelect;
export type NewItem = typeof items.$inferInsert;
