import { pgTable, text, timestamp, jsonb, integer } from "drizzle-orm/pg-core";

export const mapsJobs = pgTable("maps_jobs", {
  jobId: text("job_id").primaryKey(),
  searchTerm: text("search_term").notNull(),
  scope: text("scope").notNull(),
  location: text("location"),
  selectedFields: jsonb("selected_fields").notNull(),
  cells: jsonb("cells").notNull(),
  results: jsonb("results").notNull(),
  status: text("status").notNull(),
  totalCells: integer("total_cells").notNull().default(0),
  completedCells: integer("completed_cells").notNull().default(0),
  totalLeads: integer("total_leads").notNull().default(0),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
});

export type MapsJobRow = typeof mapsJobs.$inferSelect;
