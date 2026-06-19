import { z } from "zod";

/** The sanitized Headout experience exposed to the mobile client. */
export const ExperienceSchema = z.object({
  title: z.string(),
  description: z.string(),
  priceToken: z.string(),
  rating: z.number().min(0).max(5).nullable(),
  bookingUrl: z.string().url(),
});
export type Experience = z.infer<typeof ExperienceSchema>;

/** A category expanded onto an item for rendering its card gradient. */
export const CategoryDtoSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  gradientStart: z.string(),
  gradientEnd: z.string(),
});
export type CategoryDto = z.infer<typeof CategoryDtoSchema>;

/** The canonical item shape shared by the backend and mobile app. */
export const ItemDtoSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  notes: z.string().nullable(),
  imageUrl: z.string().nullable(),
  imageAttribution: z.string().nullable(),
  imageAttributionUrl: z.string().nullable(),
  experienceSearchQuery: z.string().nullable(),
  experienceLocation: z.string().nullable(),
  status: z.enum(["pending_enrichment", "active", "completed"]),
  categoryId: z.string().uuid().nullable(),
  category: CategoryDtoSchema.nullable(),
  completedAt: z.string().nullable(),
  createdAt: z.string(),
});
export type ItemDto = z.infer<typeof ItemDtoSchema>;
