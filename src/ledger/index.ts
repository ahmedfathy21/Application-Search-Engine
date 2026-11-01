import fs from "node:fs/promises";
import path from "node:path";
import Database from "better-sqlite3";
import type { Page } from "playwright";
import type { ApplicationMethod } from "../scraper/index.js";

export type LedgerApplicationStatus =
  | "APPLIED"
  | "EVALUATED_SKIP"
  | "FAILED"
  | "PENDING";

export interface ApplicationLedgerInput {
  jobId: string;
  companyName: string;
  jobTitle: string;
  jobUrl: string;
  applicationMethod: ApplicationMethod;
  matchScore: number;
  decision: boolean;
  status: LedgerApplicationStatus;
  evidencePath: string;
  appliedAt?: string;
}

export interface ApplicationLedgerRow {
  id: number;
  job_id: string;
  company_name: string;
  job_title: string;
  job_url: string;
  application_method: ApplicationMethod;
  match_score: number;
  decision: number;
  status: LedgerApplicationStatus;
  evidence_path: string;
  applied_at: string;
  created_at: string;
}

export interface EvidenceSaveResult {
  fileName: string;
  evidencePath: string;
  byteLength: number;
}

export interface LedgerRecordResult {
  rowId: number;
  evidencePath: string;
  appliedAt: string;
}

const DEFAULT_SQLITE_DB_PATH = path.resolve(process.cwd(), "applications.db");
const DEFAULT_EVIDENCE_DIR = path.resolve(process.cwd(), "evidence");

/**
 * Opens or initializes the local SQLite database (`applications.db`) and ensures the schema exists.
 */
export function initLedgerDatabase(
  dbPath: string = DEFAULT_SQLITE_DB_PATH
): Database.Database {
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job_id TEXT NOT NULL,
      company_name TEXT NOT NULL,
      job_title TEXT NOT NULL,
      job_url TEXT NOT NULL,
      application_method TEXT NOT NULL CHECK (application_method IN ('EMAIL', 'PORTAL')),
      match_score REAL NOT NULL,
      decision INTEGER NOT NULL CHECK (decision IN (0, 1)),
      status TEXT NOT NULL,
      evidence_path TEXT NOT NULL,
      applied_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_applications_job_id ON applications (job_id);
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
  `);

  return db;
}

/**
 * Saves a Playwright screenshot Buffer directly to the local `/evidence` directory.
 */
export async function saveEvidenceBuffer(
  screenshotBuffer: Buffer,
  identifier: string,
  evidenceDir: string = DEFAULT_EVIDENCE_DIR
): Promise<EvidenceSaveResult> {
  await fs.mkdir(evidenceDir, { recursive: true });

  const sanitizedId = identifier
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${sanitizedId || "application"}-${timestamp}.png`;
  const evidencePath = path.join(evidenceDir, fileName);

  await fs.writeFile(evidencePath, screenshotBuffer);

  return {
    fileName,
    evidencePath,
    byteLength: screenshotBuffer.byteLength,
  };
}

/**
 * Captures a full-page PNG screenshot from a Playwright Page and saves it to `/evidence`.
 */
export async function captureAndSavePageEvidence(
  page: Page,
  identifier: string,
  evidenceDir: string = DEFAULT_EVIDENCE_DIR
): Promise<EvidenceSaveResult> {
  const buffer = await page.screenshot({ fullPage: true, type: "png" });
  return saveEvidenceBuffer(buffer, identifier, evidenceDir);
}

/**
 * Inserts an application audit record into `applications.db` using better-sqlite3.
 */
export function insertApplicationRecord(
  input: ApplicationLedgerInput,
  dbPath: string = DEFAULT_SQLITE_DB_PATH
): LedgerRecordResult {
  const db = initLedgerDatabase(dbPath);
  try {
    const appliedAt = input.appliedAt ?? new Date().toISOString();
    const stmt = db.prepare(`
      INSERT INTO applications (
        job_id,
        company_name,
        job_title,
        job_url,
        application_method,
        match_score,
        decision,
        status,
        evidence_path,
        applied_at
      ) VALUES (
        @jobId,
        @companyName,
        @jobTitle,
        @jobUrl,
        @applicationMethod,
        @matchScore,
        @decision,
        @status,
        @evidencePath,
        @appliedAt
      )
    `);

    const info = stmt.run({
      jobId: input.jobId,
      companyName: input.companyName,
      jobTitle: input.jobTitle,
      jobUrl: input.jobUrl,
      applicationMethod: input.applicationMethod,
      matchScore: input.matchScore,
      decision: input.decision ? 1 : 0,
      status: input.status,
      evidencePath: input.evidencePath,
      appliedAt,
    });

    return {
      rowId: Number(info.lastInsertRowid),
      evidencePath: input.evidencePath,
      appliedAt,
    };
  } finally {
    db.close();
  }
}

/**
 * End-to-end local ledger function: writes the Playwright screenshot buffer to `/evidence`
 * and inserts the application record into `applications.db`.
 */
export async function recordApplicationWithScreenshot(
  screenshotBuffer: Buffer,
  record: Omit<ApplicationLedgerInput, "evidencePath">,
  options?: { dbPath?: string; evidenceDir?: string }
): Promise<LedgerRecordResult> {
  const evidence = await saveEvidenceBuffer(
    screenshotBuffer,
    `${record.companyName}-${record.jobId}`,
    options?.evidenceDir
  );

  return insertApplicationRecord(
    {
      ...record,
      evidencePath: evidence.evidencePath,
    },
    options?.dbPath
  );
}

/**
 * Queries all recorded applications from `applications.db`, ordered newest first.
 */
export function listApplicationRecords(
  dbPath: string = DEFAULT_SQLITE_DB_PATH
): ApplicationLedgerRow[] {
  const db = initLedgerDatabase(dbPath);
  try {
    const stmt = db.prepare<[], ApplicationLedgerRow>(
      "SELECT * FROM applications ORDER BY id DESC"
    );
    return stmt.all();
  } finally {
    db.close();
  }
}
