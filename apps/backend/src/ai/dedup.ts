import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { type SemanticItem, SemanticItemSchema } from "./analyze-item";
import type { DuplicateCandidate } from "./duplicate-verifier";
import { EMBEDDING_MODEL } from "./embed";

const DISTANCE_MAX = Number(process.env.DEDUP_CANDIDATE_DISTANCE_MAX ?? "0.4");
if (!Number.isFinite(DISTANCE_MAX) || DISTANCE_MAX <= 0 || DISTANCE_MAX >= 2) {
  throw new Error(
    "DEDUP_CANDIDATE_DISTANCE_MAX must be a finite number greater than 0 and less than 2",
  );
}

export interface DuplicateMatch {
  id: string;
  title: string;
  distance: number;
  similarity: number;
}

type Executor = Pick<typeof db, "execute">;

export async function findSemanticKeyDuplicate(
  userId: string,
  semanticKey: string | null,
  exec: Executor = db,
): Promise<DuplicateMatch | null> {
  if (!semanticKey) return null;

  const rows = await exec.execute<{ id: string; title: string }>(sql`
    select i.id, i.title
    from items i
    where i.user_id = ${userId}
      and i.semantic_key = ${semanticKey}
    limit 1
  `);

  const match = rows[0];
  if (!match) return null;

  return {
    id: match.id,
    title: match.title,
    distance: 0,
    similarity: 1,
  };
}

export async function findDuplicateCandidates(
  userId: string,
  queryEmbedding: number[],
  exec: Executor = db,
): Promise<DuplicateCandidate[]> {
  const literal = `[${queryEmbedding.join(",")}]`;

  const rows = await exec.execute<{
    id: string;
    title: string;
    semantic_data: unknown;
    distance: number;
  }>(sql`
    select
      i.id,
      i.title,
      i.semantic_data,
      (i.embedding <=> ${literal}::vector) as distance
    from items i
    where i.user_id = ${userId}
      and i.embedding is not null
      and i.embedding_model = ${EMBEDDING_MODEL}
    order by i.embedding <=> ${literal}::vector asc
    limit 5
  `);

  return rows.flatMap((row) => {
    const distance = Number(row.distance);
    if (!Number.isFinite(distance) || distance >= DISTANCE_MAX) return [];

    const parsed = SemanticItemSchema.safeParse(row.semantic_data);
    return [
      {
        id: row.id,
        title: row.title,
        semanticData: parsed.success ? (parsed.data as SemanticItem) : null,
        distance,
        similarity: Number((1 - distance).toFixed(4)),
      },
    ];
  });
}
