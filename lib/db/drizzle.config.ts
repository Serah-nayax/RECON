import { defineConfig } from "drizzle-kit";
import fs from "fs";
import path from "path";

// Load Neon env vars written by `neon deploy` / `neon env pull` at the repo root.
for (const file of [".env.local", ".env"]) {
  const envPath = path.join(__dirname, "../..", file);
  if (fs.existsSync(envPath)) process.loadEnvFile(envPath);
}

// Migrations must use the direct (unpooled) connection: PgBouncer in transaction
// mode does not support the session-level operations drizzle-kit relies on.
const databaseUrl = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL_UNPOOLED or DATABASE_URL must be set, ensure the database is provisioned");
}

export default defineConfig({
  // Relative path: drizzle-kit's glob does not match absolute Windows (backslash) paths.
  schema: "./src/schema/index.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: databaseUrl,
  },
});
