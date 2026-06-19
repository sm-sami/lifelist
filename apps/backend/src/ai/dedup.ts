import { sql } from "drizzle-orm";
import { db } from "../../db/client";
import { EMBEDDING_MODEL } from "./embed";

const DISTANCE_MAX = Number(process.env.DEDUP_DISTANCE_MAX ?? "0.15");
if (!Number.isFinite(DISTANCE_MAX) || DISTANCE_MAX <= 0 || DISTANCE_MAX >= 2) {
  throw new Error("DEDUP_DISTANCE_MAX must be a finite number greater than 0 and less than 2");
}

export interface DuplicateMatch {
  id: string;
  title: string;
  distance: number;
  similarity: number;
}

type Executor = Pick<typeof db, "execute">;

export async function findSemanticDuplicate(
  userId: string,
  queryEmbedding: number[],
  exec: Executor = db,
): Promise<DuplicateMatch | null> {
  const literal = `[${queryEmbedding.join(",")}]`;

  const rows = await exec.execute<{
    id: string;
    title: string;
    distance: number;
  }>(sql`
    select
      i.id,
      i.title,
      (i.embedding <=> ${literal}::vector) as distance
    from items i
    where i.user_id = ${userId}
      and i.embedding is not null
      and i.embedding_model = ${EMBEDDING_MODEL}
    order by i.embedding <=> ${literal}::vector asc
    limit 1
  `);

  const top = rows[0];
  if (!top) return null;

  const distance = Number(top.distance);
  if (distance >= DISTANCE_MAX) return null;

  return {
    id: top.id,
    title: top.title,
    distance,
    similarity: Number((1 - distance).toFixed(4)),
  };
}
