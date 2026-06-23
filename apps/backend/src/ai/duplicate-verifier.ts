import OpenAI from "openai";
import { z } from "zod";
import type { SemanticItem } from "./analyze-item";

const MODEL =
  process.env.OPENAI_DUPLICATE_MODEL ?? process.env.OPENAI_ANALYSIS_MODEL ?? "gpt-4o-mini";

export const DuplicateDecisionSchema = z.object({
  candidateId: z.string().nullable(),
  relationship: z.enum(["same_goal", "related_goal", "different_goal"]),
  confidence: z.number().min(0).max(1),
  reason: z.string().trim().min(1).max(240),
});

export type DuplicateDecision = z.infer<typeof DuplicateDecisionSchema>;

export interface DuplicateCandidate {
  id: string;
  title: string;
  semanticData: SemanticItem | null;
  distance: number;
  similarity: number;
}

const SYSTEM_PROMPT = `Determine whether a new bucket-list goal duplicates one of the candidates.

Definitions:
- same_goal: completing either goal would substantially satisfy both goals.
- related_goal: they overlap or share a destination/theme, but are independently completable.
- different_goal: materially different desired outcomes.

Judge meaning rather than wording. Account for action, subject, specificity, and location.
Return same_goal only when the evidence is strong. If none is the same goal, choose the closest
candidate and classify it as related_goal or different_goal. candidateId must be null only when
there are no candidates. Return only JSON matching the supplied schema.`;

const RESPONSE_FORMAT = {
  type: "json_schema" as const,
  json_schema: {
    name: "duplicate_decision",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        candidateId: { type: ["string", "null"] },
        relationship: {
          type: "string",
          enum: ["same_goal", "related_goal", "different_goal"],
        },
        confidence: { type: "number" },
        reason: { type: "string" },
      },
      required: ["candidateId", "relationship", "confidence", "reason"],
    },
  },
};

export async function verifyDuplicateCandidates(
  incoming: SemanticItem,
  candidates: DuplicateCandidate[],
): Promise<DuplicateDecision> {
  if (candidates.length === 0) {
    return {
      candidateId: null,
      relationship: "different_goal",
      confidence: 1,
      reason: "No candidates were retrieved.",
    };
  }

  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: RESPONSE_FORMAT,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: JSON.stringify({
          incoming,
          candidates: candidates.map((candidate) => ({
            id: candidate.id,
            title: candidate.title,
            semantics: candidate.semanticData,
            similarity: candidate.similarity,
          })),
        }),
      },
    ],
  });

  const message = completion.choices[0]?.message;
  if (message?.refusal) throw new Error(`Duplicate verification refused: ${message.refusal}`);
  if (!message?.content) throw new Error("Duplicate verification returned empty content");

  const decision = DuplicateDecisionSchema.parse(JSON.parse(message.content));
  if (
    decision.candidateId &&
    !candidates.some((candidate) => candidate.id === decision.candidateId)
  ) {
    throw new Error("Duplicate verification returned an unknown candidate");
  }
  return decision;
}
