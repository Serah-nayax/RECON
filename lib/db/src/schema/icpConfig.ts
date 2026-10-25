import { pgTable, text, timestamp, jsonb, boolean } from "drizzle-orm/pg-core";

export const icpConfig = pgTable("icp_config", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  qualifySignals: jsonb("qualify_signals").notNull().$type<string[]>(),
  disqualifySignals: jsonb("disqualify_signals").notNull().$type<string[]>(),
  scoreBands: jsonb("score_bands").notNull().$type<{ band: string; range: string; description: string }[]>(),
  isActive: boolean("is_active").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type IcpConfigRow = typeof icpConfig.$inferSelect;
