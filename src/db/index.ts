import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema.js";

const { Pool } = pg;

export const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ??
    "postgresql://pipeline_user:pipeline_secret_pw@localhost:5432/job_pipeline_db",
});

export const db = drizzle(pool, { schema });
