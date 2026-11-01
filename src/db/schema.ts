import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  integer,
  text,
  jsonb,
  numeric,
  boolean,
  timestamp,
  vector,
  index,
} from "drizzle-orm/pg-core";

export const applicationMethodEnum = pgEnum("application_method_enum", [
  "EMAIL",
  "PORTAL",
]);

export const applicationStatusEnum = pgEnum("application_status_enum", [
  "SCRAPED",
  "EVALUATED_SKIP",
  "EVALUATED_MATCH",
  "EXECUTING",
  "APPLIED",
  "LEDGER_SYNCED",
  "FAILED",
]);

/**
 * RAG Knowledge Base table storing chunked resume/project data and 768-dim Gemini embeddings.
 */
export const resumeChunks = pgTable(
  "resume_chunks",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    sourceType: varchar("source_type", { length: 50 }).notNull(),
    sourceTitle: varchar("source_title", { length: 255 }).notNull(),
    chunkIndex: integer("chunk_index").notNull().default(0),
    content: text("content").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    embedding: vector("embedding", { dimensions: 768 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    embeddingHnswIdx: index("idx_resume_chunks_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops")
    ),
  })
);

/**
 * Job Postings table tracking scraped metadata, AI evaluation output, and execution/ledger state.
 */
export const jobPostings = pgTable(
  "job_postings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    externalId: varchar("external_id", { length: 255 }),
    jobUrl: text("job_url").notNull().unique(),
    companyName: varchar("company_name", { length: 255 }).notNull(),
    jobTitle: varchar("job_title", { length: 255 }).notNull(),
    location: varchar("location", { length: 255 }),
    compensationRange: varchar("compensation_range", { length: 255 }),
    recruiterEmail: varchar("recruiter_email", { length: 255 }),
    applicationMethod: applicationMethodEnum("application_method")
      .notNull()
      .default("PORTAL"),
    rawDescription: text("raw_description").notNull(),
    scrapedMetadata: jsonb("scraped_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    descriptionEmbedding: vector("description_embedding", { dimensions: 768 }),

    // Stage 2: AI Evaluation Output
    matchScore: numeric("match_score", { precision: 5, scale: 2 }),
    decision: boolean("decision"),
    proposalText: text("proposal_text"),
    matchedChunkIds: uuid("matched_chunk_ids").array(),

    // Stage 3 & 4: Execution & Ledger State
    status: applicationStatusEnum("status").notNull().default("SCRAPED"),
    screenshotLocalPath: text("screenshot_local_path"),
    screenshotDriveFileId: varchar("screenshot_drive_file_id", { length: 255 }),
    screenshotDriveUrl: text("screenshot_drive_url"),
    sheetsRowNumber: integer("sheets_row_number"),
    errorLog: text("error_log"),

    appliedAt: timestamp("applied_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    embeddingHnswIdx: index("idx_job_postings_embedding_hnsw").using(
      "hnsw",
      table.descriptionEmbedding.op("vector_cosine_ops")
    ),
  })
);

export type ResumeChunkRow = typeof resumeChunks.$inferSelect;
export type NewResumeChunkRow = typeof resumeChunks.$inferInsert;
export type JobPostingRow = typeof jobPostings.$inferSelect;
export type NewJobPostingRow = typeof jobPostings.$inferInsert;
