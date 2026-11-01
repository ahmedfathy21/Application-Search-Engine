import * as dotenv from "dotenv";

dotenv.config();

export * as scraper from "./scraper/index.js";
export * as rag from "./rag/index.js";
export * as ai from "./ai/index.js";
export * as executor from "./executor/index.js";
export * as ledger from "./ledger/index.js";
export * as db from "./db/index.js";

/**
 * Main 4-Stage Automated Job Application Pipeline Orchestrator:
 *   Stage 1 (/scraper)  -> Stealth Chromium DOM extraction
 *   Stage 2 (/rag, /ai) -> pgvector Top-K retrieval + Gemini 1.5 Zod-enforced evaluation
 *   Stage 3 (/executor) -> Gmail API PDF dispatch OR Playwright DOM form auto-submission
 *   Stage 4 (/ledger)   -> Full-page screenshot -> Google Drive public URL -> Google Sheets append
 */
export async function runPipeline(targetJobUrls: string[]): Promise<void> {
  console.log(
    `[Pipeline] Initialized 4-stage local automation pipeline for ${targetJobUrls.length} job target(s).`
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runPipeline([]).catch((err: unknown) => {
    console.error("[Pipeline] Fatal error:", err);
    process.exit(1);
  });
}
