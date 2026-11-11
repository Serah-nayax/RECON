import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// A connection attempt that hangs (DNS or office proxy trouble) fails after 20 s and is retried
// by the caller, instead of blocking the server. Keep-alive stops idle links being cut silently.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 20_000,
  keepAlive: true,
});
// An idle connection dropped by the server or the network emits "error" on the pool; without a
// listener that would crash the whole process. The pool replaces the connection on next use.
pool.on("error", (err) => {
  console.error(`Database connection lost (it will reconnect): ${err.message}`);
});
export const db = drizzle(pool, { schema });

export * from "./schema";
