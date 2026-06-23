import OpenAI from "openai";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set.`);
  return v;
}

export const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const MODEL = EMBEDDING_MODEL;
const EXPECTED_DIMS = 1536;

const openai = new OpenAI({ apiKey: requireEnv("OPENAI_API_KEY") });

export function normalizeEmbeddingInput(value: string): string {
  return value.trim().normalize("NFKC").replace(/\s+/g, " ");
}

export async function embed(text: string): Promise<number[]> {
  const input = normalizeEmbeddingInput(text);
  const res = await openai.embeddings.create({
    model: MODEL,
    input,
    dimensions: EXPECTED_DIMS,
  });
  const vec = res.data[0]?.embedding;
  if (!vec || vec.length !== EXPECTED_DIMS) {
    throw new Error(`Embedding dim mismatch: expected ${EXPECTED_DIMS}, got ${vec?.length ?? 0}`);
  }
  return vec;
}
