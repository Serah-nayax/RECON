import { db, platformConfig } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "./logger.js";

export interface ConfigEntry {
  key: string;
  label: string;
  category: string;
  updatedAt: string;
}

const cache = new Map<string, string>();

export async function initConfigStore(): Promise<void> {
  try {
    const rows = await db.select().from(platformConfig);
    for (const row of rows) {
      cache.set(row.key, row.value);
    }
    logger.info({ count: rows.length }, "Platform config loaded from DB");
  } catch (err) {
    logger.error({ err }, "Failed to load platform config from DB");
  }
}

export async function listConfigs(): Promise<ConfigEntry[]> {
  try {
    const rows = await db.select().from(platformConfig);
    return rows.map((r) => ({
      key: r.key,
      label: r.label,
      category: r.category,
      updatedAt: r.updatedAt.toISOString(),
    }));
  } catch (err) {
    logger.error({ err }, "Failed to list platform configs");
    return [];
  }
}

export async function setConfig(key: string, value: string, label: string, category: string): Promise<void> {
  cache.set(key, value);
  await db
    .insert(platformConfig)
    .values({ key, value, label, category, createdAt: new Date(), updatedAt: new Date() })
    .onConflictDoUpdate({
      target: platformConfig.key,
      set: { value, label, category, updatedAt: new Date() },
    });
}

export async function deleteConfig(key: string): Promise<void> {
  cache.delete(key);
  await db.delete(platformConfig).where(eq(platformConfig.key, key));
}

export function getConfig(key: string): string | undefined {
  return cache.get(key) ?? process.env[key];
}
