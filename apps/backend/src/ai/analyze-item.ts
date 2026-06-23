import OpenAI from "openai";
import { z } from "zod";
import { slugify } from "../services/gradient";

export const ITEM_ANALYSIS_MODEL = process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini";
export const ITEM_ANALYSIS_VERSION = 1;

export const SemanticItemSchema = z
  .object({
    canonicalTitle: z.string().trim().min(1).max(140),
    action: z.enum(["visit", "see", "experience", "learn", "do", "eat", "other"]),
    subject: z.string().trim().min(1).max(120),
    subjectType: z.enum([
      "landmark",
      "place",
      "activity",
      "event",
      "skill",
      "food",
      "natural_phenomenon",
      "other",
    ]),
    location: z.string().trim().min(1).max(120).nullable(),
    concepts: z.array(z.string().trim().min(1).max(80)).max(8),
    entityConfidence: z.number().min(0).max(1),
    entityWasInferred: z.boolean(),
    matchedCategoryId: z.string().min(1).nullable(),
    newCategoryName: z.string().trim().min(1).max(60).nullable(),
    imageKeywords: z.array(z.string().trim().min(1).max(80)).min(2).max(4),
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

export type SemanticItem = z.infer<typeof SemanticItemSchema>;

export interface AnalyzeItemInput {
  title: string;
  existingCategories: { id: string; name: string }[];
}

function normalizeModelPayload(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;

  const payload = value as Record<string, unknown>;
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const canonicalTitle =
    typeof payload.canonicalTitle === "string" ? payload.canonicalTitle.trim() : "";
  const imageKeywords = Array.isArray(payload.imageKeywords)
    ? [
        ...new Set(
          payload.imageKeywords.filter((keyword): keyword is string => typeof keyword === "string"),
        ),
      ]
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .slice(0, 4)
    : [];
  for (const fallback of [subject, canonicalTitle]) {
    if (imageKeywords.length >= 2) break;
    if (fallback && !imageKeywords.includes(fallback)) imageKeywords.push(fallback);
  }

  return {
    ...payload,
    concepts: Array.isArray(payload.concepts) ? payload.concepts.slice(0, 8) : payload.concepts,
    imageKeywords,
  };
}

const SYSTEM_PROMPT = `You are the semantic understanding engine for Lifelist, a bucket-list app.

Interpret the user's goal by meaning, not by surface wording.

- Keep canonicalTitle concise and natural while preserving the user's actual goal.
- Identify the real-world subject when it is unambiguous. For example, a unique superlative
  landmark may resolve to its proper name, and common scientific and everyday names may resolve
  to one canonical subject.
- Set entityWasInferred=true when the subject was not explicitly named.
- entityConfidence measures confidence that the canonical subject identifies the user's intended
  real-world goal. Be conservative with ambiguous, time-sensitive, or underspecified wording.
- concepts are short semantic synonyms, properties, or alternate names useful for retrieval.
- STRONGLY PREFER an existing category. Invent a broad 1-3 word category only if none fits.
- imageKeywords must be concrete visual search phrases.
- experienceSearchQuery must be a concise commercial attraction or activity query with bucket-list
  framing removed. Use the canonical landmark or phenomenon name when resolved.
- experienceLocation is a city, region, or country only when explicit or unambiguously implied.
- Do not add facts that are not needed to resolve or enrich the goal.

Return only JSON matching the supplied schema.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "lifelist_item_analysis",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        canonicalTitle: { type: "string" },
        action: {
          type: "string",
          enum: ["visit", "see", "experience", "learn", "do", "eat", "other"],
        },
        subject: { type: "string" },
        subjectType: {
          type: "string",
          enum: [
            "landmark",
            "place",
            "activity",
            "event",
            "skill",
            "food",
            "natural_phenomenon",
            "other",
          ],
        },
        location: { type: ["string", "null"] },
        concepts: { type: "array", items: { type: "string" } },
        entityConfidence: { type: "number" },
        entityWasInferred: { type: "boolean" },
        matchedCategoryId: { type: ["string", "null"] },
        newCategoryName: { type: ["string", "null"] },
        imageKeywords: { type: "array", items: { type: "string" } },
        experienceSearchQuery: { type: ["string", "null"] },
        experienceLocation: { type: ["string", "null"] },
      },
      required: [
        "canonicalTitle",
        "action",
        "subject",
        "subjectType",
        "location",
        "concepts",
        "entityConfidence",
        "entityWasInferred",
        "matchedCategoryId",
        "newCategoryName",
        "imageKeywords",
        "experienceSearchQuery",
        "experienceLocation",
      ],
    },
  },
};

export async function analyzeItem(input: AnalyzeItemInput): Promise<SemanticItem> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: ITEM_ANALYSIS_MODEL,
    temperature: 0.1,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          title: input.title,
          existingCategories: input.existingCategories,
        }),
      },
    ],
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error(`Item analysis refused: ${message.refusal}`);
  if (!message?.content) throw new Error("Item analysis returned empty content");

  const parsed = SemanticItemSchema.parse(normalizeModelPayload(JSON.parse(message.content)));
  if (
    parsed.matchedCategoryId &&
    !input.existingCategories.some((category) => category.id === parsed.matchedCategoryId)
  ) {
    return {
      ...parsed,
      matchedCategoryId: null,
      newCategoryName: parsed.newCategoryName ?? "General",
    };
  }
  return parsed;
}

export function buildSemanticKey(analysis: SemanticItem): string | null {
  if (analysis.entityConfidence < 0.9) return null;

  const subject = slugify(analysis.subject);
  if (!subject) return null;

  const intent = ["visit", "see", "experience"].includes(analysis.action)
    ? "experience"
    : analysis.action;
  const location = analysis.location ? slugify(analysis.location) : "";
  return [intent, analysis.subjectType, subject, location].filter(Boolean).join(":");
}

export function buildEmbeddingInput(analysis: SemanticItem): string {
  return [
    `action: ${analysis.action}`,
    `subject: ${analysis.subject}`,
    `type: ${analysis.subjectType}`,
    analysis.location ? `location: ${analysis.location}` : null,
    analysis.concepts.length > 0 ? `concepts: ${analysis.concepts.join(", ")}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join("\n");
}
