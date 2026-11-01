import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { cosineDistance, desc, gt, sql } from "drizzle-orm";
import pg from "pg";
import * as dotenv from "dotenv";
import * as schema from "../db/schema.js";
import { resumeChunks, type NewResumeChunkRow, type ResumeChunkRow } from "../db/schema.js";

dotenv.config();

const { Pool } = pg;

export const EXPECTED_VECTOR_DIMENSIONS = 768;

export interface VectorSearchOptions {
  topK?: number;
  minSimilarity?: number;
  sourceType?: string;
}

export interface VectorChunkMatch {
  id: string;
  sourceType: string;
  sourceTitle: string;
  chunkIndex: number;
  content: string;
  metadata: Record<string, unknown>;
  similarityScore: number;
}

/**
 * Resolves the PostgreSQL connection string from `DATABASE_URL` in `.env`.
 */
export function getDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Missing DATABASE_URL environment variable for PostgreSQL/pgvector connection."
    );
  }
  return url;
}

/**
 * Shared PostgreSQL connection pool connected to the local pgvector Docker container.
 */
export const pgPool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://pipeline_user:pipeline_secret_pw@localhost:5434/job_pipeline_db",
  max: 10,
  idleTimeoutMillis: 30_000,
});

/**
 * Drizzle ORM instance configured with the pgvector schema.
 */
export const ragDb: NodePgDatabase<typeof schema> = drizzle(pgPool, { schema });

/**
 * Verifies connectivity to the running local PostgreSQL container and confirms the `vector` extension is active.
 */
export async function verifyPgVectorConnection(): Promise<boolean> {
  const client = await pgPool.connect();
  try {
    const result = await client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'vector';"
    );
    return (result.rowCount ?? 0) > 0;
  } finally {
    client.release();
  }
}

/**
 * Inserts one or more embedded resume/project chunks into the `resume_chunks` pgvector table.
 */
export async function insertResumeChunks(
  chunks: NewResumeChunkRow[]
): Promise<ResumeChunkRow[]> {
  if (chunks.length === 0) {
    return [];
  }

  for (const chunk of chunks) {
    if (chunk.embedding.length !== EXPECTED_VECTOR_DIMENSIONS) {
      throw new Error(
        `Invalid embedding dimension: expected ${EXPECTED_VECTOR_DIMENSIONS}, received ${chunk.embedding.length}`
      );
    }
  }

  return ragDb.insert(resumeChunks).values(chunks).returning();
}

/**
 * Queries the local pgvector `resume_chunks` table for the top-k most similar chunks
 * using Cosine Distance (`<=>`) accelerated by the HNSW index.
 */
export async function queryTopKVectorMatches(
  queryEmbedding: number[],
  options: VectorSearchOptions = {}
): Promise<VectorChunkMatch[]> {
  if (queryEmbedding.length !== EXPECTED_VECTOR_DIMENSIONS) {
    throw new Error(
      `Query embedding must have ${EXPECTED_VECTOR_DIMENSIONS} dimensions, received ${queryEmbedding.length}`
    );
  }

  const topK = options.topK ?? 5;
  const minSimilarity = options.minSimilarity ?? 0.0;

  // Cosine similarity = 1 - Cosine Distance (<=>)
  const similarityExpr = sql<number>`1 - (${cosineDistance(
    resumeChunks.embedding,
    queryEmbedding
  )})`;

  const rows = await ragDb
    .select({
      id: resumeChunks.id,
      sourceType: resumeChunks.sourceType,
      sourceTitle: resumeChunks.sourceTitle,
      chunkIndex: resumeChunks.chunkIndex,
      content: resumeChunks.content,
      metadata: resumeChunks.metadata,
      similarityScore: similarityExpr,
    })
    .from(resumeChunks)
    .where(gt(similarityExpr, minSimilarity))
    .orderBy(desc(similarityExpr))
    .limit(topK);

  return rows.map((row) => ({
    id: row.id,
    sourceType: row.sourceType,
    sourceTitle: row.sourceTitle,
    chunkIndex: row.chunkIndex,
    content: row.content,
    metadata: row.metadata,
    similarityScore: Number(row.similarityScore),
  }));
}

/**
 * Gracefully closes the underlying PostgreSQL connection pool.
 */
export async function closePgVectorPool(): Promise<void> {
  await pgPool.end();
}
