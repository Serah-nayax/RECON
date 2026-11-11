import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@workspace/db";
import { inArray, sql } from "drizzle-orm";
import type { AnyPgColumn, PgTable } from "drizzle-orm/pg-core";
import { logger } from "./logger.js";

/**
 * Loading every Maps job and Qualify batch at startup downloaded the whole database (~40 MB)
 * each time the server started, and Neon's free plan caps data sent out at 5 GB a month.
 * This keeps a copy of the rows on disk and asks the database only for a fingerprint of each
 * row (an md5 of the whole row, computed by Postgres): rows whose fingerprint is unchanged come
 * from the copy, new or changed rows (another teammate's work included) are downloaded.
 * A missing or unreadable copy just means a full download, as before.
 */
const CACHE_DIR = path.resolve(process.cwd(), ".db-cache");

interface CacheFile {
  rows: Record<string, { hash: string; row: Record<string, unknown> }>;
}

export async function loadRowsCached<T extends Record<string, unknown>>(
  table: PgTable,
  tableName: string,
  idColumn: AnyPgColumn,
  idKey: string,
  dateKeys: string[],
): Promise<T[]> {
  const file = path.join(CACHE_DIR, `${tableName}.json`);
  const result = await db.execute(
    sql`select ${sql.identifier(idColumn.name)} as id, md5(t::text) as hash from ${sql.identifier(tableName)} t`,
  );
  const current = result.rows as { id: string; hash: string }[];

  let cached: CacheFile = { rows: {} };
  try {
    cached = JSON.parse(await fs.readFile(file, "utf8")) as CacheFile;
  } catch {
    // No copy yet (first start) or an unreadable one: everything is downloaded.
  }

  const stale = current.filter(({ id, hash }) => cached.rows[id]?.hash !== hash).map(({ id }) => id);
  const fresh = new Map<string, Record<string, unknown>>();
  // In chunks, so a first start with hundreds of rows does not build one huge query.
  for (let i = 0; i < stale.length; i += 50) {
    const rows = await db.select().from(table).where(inArray(idColumn, stale.slice(i, i + 50)));
    for (const row of rows as Record<string, unknown>[]) {
      fresh.set(String(row[idKey]), row);
    }
  }

  const next: CacheFile = { rows: {} };
  const out: T[] = [];
  for (const { id, hash } of current) {
    const row = fresh.get(id) ?? (cached.rows[id] ? revive(cached.rows[id].row, dateKeys) : null);
    // A row deleted between the two queries is simply skipped.
    if (!row) continue;
    next.rows[id] = { hash, row };
    out.push(row as T);
  }

  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(file, JSON.stringify(next));
  } catch (err) {
    // Only the saving is lost: the next start downloads these rows again.
    logger.warn({ err, tableName }, "Could not save the local copy of the database rows");
  }
  logger.info(
    { tableName, rows: out.length, downloaded: stale.length, fromLocalCopy: out.length - fresh.size },
    "Rows loaded",
  );
  return out;
}

/** JSON turns Dates into strings; the stores expect Dates for the timestamp columns. */
function revive(row: Record<string, unknown>, dateKeys: string[]): Record<string, unknown> {
  const copy = { ...row };
  for (const key of dateKeys) {
    if (typeof copy[key] === "string") copy[key] = new Date(copy[key] as string);
  }
  return copy;
}
