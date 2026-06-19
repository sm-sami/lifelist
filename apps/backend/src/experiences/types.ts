import { type Experience, ExperienceSchema } from "@lifelist/shared";
import { z } from "zod";

export { ExperienceSchema };
export type { Experience };

export const ExperiencesResponseSchema = z.object({
  query: z.string(),
  count: z.number(),
  experiences: z.array(ExperienceSchema),
});

export type ExperiencesResponse = z.infer<typeof ExperiencesResponseSchema>;
