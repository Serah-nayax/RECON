import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const qualifyBatches = pgTable("qualify_batches", {
  batchId: text("batch_id").primaryKey(),
  status: text("status").notNull(),
  icpSnapshot: text("icp_snapshot").notNull(),
  leads: jsonb("leads").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  completedCount: integer("completed_count").notNull().default(0),
  totalCount: integer("total_count").notNull(),
});

export type QualifyBatchRow = typeof qualifyBatches.$inferSelect;
