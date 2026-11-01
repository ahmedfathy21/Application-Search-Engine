import { z } from "zod";
import { SchemaType, type ResponseSchema } from "@google/generative-ai";
import type { ScrapedJobPosting } from "../scraper/index.js";
import type { RetrievedChunkMatch } from "../rag/index.js";

/**
 * Strict Zod schema enforcing the LLM decision output contract.
 */
export const JobApplicationDecisionSchema = z.object({
  match_score: z
    .number()
    .min(0)
    .max(100)
    .describe("Quantitative fit score between 0 and 100 based on RAG context"),
  decision: z
    .boolean()
    .describe("True if match_score meets threshold and candidate qualifies"),
  proposal_text: z
    .string()
    .min(1)
    .describe(
      "Tailored cover letter / outreach email grounded strictly in retrieved resume chunks"
    ),
});

export type JobApplicationDecision = z.infer<typeof JobApplicationDecisionSchema>;

/**
 * Native Gemini responseSchema definition mirroring JobApplicationDecisionSchema
 * for deterministic JSON generation (`responseMimeType: "application/json"`).
 */
export const GeminiDecisionResponseSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    match_score: {
      type: SchemaType.NUMBER,
      description: "Quantitative match score from 0 to 100.",
    },
    decision: {
      type: SchemaType.BOOLEAN,
      description: "Whether to proceed with applying to this role.",
    },
    proposal_text: {
      type: SchemaType.STRING,
      description:
        "Personalized proposal or cover letter citing the candidate's matched projects and experience.",
    },
  },
  required: ["match_score", "decision", "proposal_text"],
};

export const SYSTEM_EVALUATION_PROMPT = `
You are an elite technical recruiter and career evaluation engine.
Given a scraped Job Posting and the Top-K most relevant chunks from the candidate's Resume & Project Portfolio:
1. Evaluate technical alignment, seniority fit, and domain overlap to compute a strict 'match_score' (0-100).
2. Set 'decision' to true ONLY if the candidate satisfies core requirements and match_score >= threshold.
3. Draft a concise, high-impact 'proposal_text' (cover letter / direct recruiter email) referencing specific metrics and projects from the retrieved RAG chunks. Never hallucinate experience not present in the context.
Return strictly valid JSON adhering to the schema.
`.trim();

export interface EvaluationInput {
  job: ScrapedJobPosting;
  matchedChunks: RetrievedChunkMatch[];
  minScoreThreshold?: number;
}

export interface IAiDecisionService {
  /**
   * Calls Gemini 1.5 Flash/Pro with JSON schema enforcement and validates the response via Zod.
   */
  evaluateJobAndDraftProposal(
    input: EvaluationInput
  ): Promise<JobApplicationDecision>;
}

/**
 * Evaluates a scraped job against top-k RAG chunks using Gemini 1.5 and validates via Zod.
 */
export async function evaluateJobAndDraftProposal(
  _input: EvaluationInput
): Promise<JobApplicationDecision> {
  throw new Error("Not implemented: evaluateJobAndDraftProposal");
}
