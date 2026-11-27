import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required. Configure a PostgreSQL connection before using the current data layer.");
}

const globalForDb = globalThis as typeof globalThis & {
  __roleplayPostgresPool?: Pool;
};

export const pool =
  globalForDb.__roleplayPostgresPool ??
  new Pool({
    connectionString: databaseUrl,
    max: process.env.NODE_ENV === "production" ? 3 : 10,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
    ...(process.env.NODE_ENV === "production" ? { ssl: { rejectUnauthorized: false } } : {}),
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__roleplayPostgresPool = pool;
}

export const db = drizzle(pool);
