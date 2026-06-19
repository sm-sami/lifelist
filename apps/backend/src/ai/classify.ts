import OpenAI from "openai";
import { z } from "zod";

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
const MODEL = process.env.OPENAI_CLASSIFY_MODEL ?? "gpt-4o-mini";

export interface ClassifyInput {
  title: string;
  existingCategories: { id: string; name: string }[];
}

export interface ClassifyResult {
  matchedCategoryId: string | null;
  newCategoryName: string | null;
  imageKeywords: string[];
  experienceSearchQuery: string | null;
  experienceLocation: string | null;
}

const SYSTEM_PROMPT = `You are the categorization engine for "Lifelist", a bucket-list app.
Given a single bucket-list item title and the user's EXISTING categories, you must:

1. STRONGLY PREFER reusing an existing category. Only invent a new category if NONE of
   the existing ones is a reasonable fit. Reusing keeps the user's taxonomy clean.
2. If you reuse, return that category's exact id in "matchedCategoryId" and set
   "newCategoryName" to null.
3. If and ONLY IF nothing fits, set "matchedCategoryId" to null and return a SHORT,
   broad, title-cased "newCategoryName" (1-3 words, e.g. "Travel", "Food & Drink",
   "Outdoor Adventure"). Prefer broad buckets over narrow ones to avoid sprawl.
4. Always return "imageKeywords": 2-4 short, concrete, visually evocative search terms
   for a background photo (e.g. ["machu picchu","sunrise","peru"]). No abstract words.
5. Return "experienceSearchQuery" as a concise 1-5 word commercial activity, attraction,
   or landmark query suitable for a travel-experience search engine. Remove bucket-list
   intent such as "visit", "see", "go to", "experience", "take a", and "I want to".
   Preserve meaningful activity words such as "surfing", "cooking class", or "skydiving".
   Use null only when no meaningful bookable experience query can be derived.
6. Return "experienceLocation" as the city, region, or country explicitly stated or
   unambiguously implied by a named landmark (e.g. "Paris, France" for Eiffel Tower).
   Otherwise return null. Do not guess a location for generic activities.

Return ONLY JSON that conforms to the provided schema. No prose.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "classification",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        matchedCategoryId: { type: ["string", "null"] },
        newCategoryName: { type: ["string", "null"] },
        imageKeywords: { type: "array", items: { type: "string" } },
        experienceSearchQuery: { type: ["string", "null"] },
        experienceLocation: { type: ["string", "null"] },
      },
      required: [
        "matchedCategoryId",
        "newCategoryName",
        "imageKeywords",
        "experienceSearchQuery",
        "experienceLocation",
      ],
    },
  },
};

const ClassifyValidator = z
  .object({
    matchedCategoryId: z.string().min(1).nullable(),
    newCategoryName: z.string().trim().min(1).nullable(),
    imageKeywords: z.array(z.string().trim().min(1)).min(2).max(4),
    experienceSearchQuery: z.string().trim().min(1).max(80).nullable(),
    experienceLocation: z.string().trim().min(1).max(80).nullable(),
  })
  .superRefine((value, ctx) => {
    const reusesExisting = value.matchedCategoryId !== null;
    const inventsNew = value.newCategoryName !== null;
    if (reusesExisting === inventsNew) {
      ctx.addIssue({
        code: "custom",
        message: "Exactly one of matchedCategoryId or newCategoryName must be present",
      });
    }
  });

export async function classifyItem(input: ClassifyInput): Promise<ClassifyResult> {
  const userMsg = JSON.stringify({
    title: input.title,
    existingCategories: input.existingCategories,
  });

  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0.2,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMsg },
    ],
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error(`Classification refused: ${message.refusal}`);
  const raw = message?.content;
  if (!raw) throw new Error("Classification returned empty content");

  const parsed = ClassifyValidator.parse(JSON.parse(raw)) as ClassifyResult;

  if (
    parsed.matchedCategoryId &&
    !input.existingCategories.some((c) => c.id === parsed.matchedCategoryId)
  ) {
    parsed.matchedCategoryId = null;
    if (!parsed.newCategoryName) parsed.newCategoryName = "General";
  }
  return parsed;
}
