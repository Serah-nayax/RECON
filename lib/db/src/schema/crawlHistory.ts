import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const crawlHistory = pgTable("crawl_history", {
  jobId: text("job_id").primaryKey(),
  url: text("url").notNull(),
  depth: integer("depth").notNull().default(1),
  status: text("status").notNull(),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type CrawlHistoryRow = typeof crawlHistory.$inferSelect;
