import { GoogleGenerativeAI } from "@google/generative-ai";
import * as dotenv from "dotenv";
import {
  ragDb,
  pgPool,
  verifyPgVectorConnection,
  insertResumeChunks,
  queryTopKVectorMatches,
  closePgVectorPool,
  EXPECTED_VECTOR_DIMENSIONS,
  type VectorSearchOptions,
  type VectorChunkMatch,
} from "./db.js";

dotenv.config();

export {
  ragDb,
  pgPool,
  verifyPgVectorConnection,
  insertResumeChunks,
  queryTopKVectorMatches,
  closePgVectorPool,
  EXPECTED_VECTOR_DIMENSIONS,
  type VectorSearchOptions,
  type VectorChunkMatch,
};

export type ChunkSourceType =
  | "resume"
  | "project"
  | "experience"
  | "skill"
  | "achievement";

export interface KnowledgeDocumentInput {
  sourceType: ChunkSourceType;
  sourceTitle: string;
  rawText: string;
  metadata?: Record<string, unknown>;
}

export type RetrievedChunkMatch = VectorChunkMatch;

/**
 * Generates a 768-dimensional vector embedding for a text string using Gemini `text-embedding-004`.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY in .env for embedding generation.");
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const modelName = process.env.GEMINI_EMBEDDING_MODEL ?? "text-embedding-004";
  const model = genAI.getGenerativeModel({ model: modelName });

  const response = await model.embedContent(text);
  return response.embedding.values;
}

/**
 * Embeds a job description string and queries the local pgvector database for the top-k matching chunks.
 */
export async function queryTopKMatches(
  jobDescriptionText: string,
  topK = 5
): Promise<RetrievedChunkMatch[]> {
  const queryVector = await generateEmbedding(jobDescriptionText);
  return queryTopKVectorMatches(queryVector, { topK });
}
