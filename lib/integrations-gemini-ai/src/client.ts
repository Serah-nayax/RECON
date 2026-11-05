import { GoogleGenAI } from "@google/genai";

// The server must start without Gemini configured (DB, maps search and the UI do not need it).
// Calls fail with a clear message until AI_INTEGRATIONS_GEMINI_API_KEY is set.
// For the free Google AI Studio key, set AI_INTEGRATIONS_GEMINI_BASE_URL to
// https://generativelanguage.googleapis.com/v1beta (apiVersion is "" so the version must be in the URL).
function createClient(): GoogleGenAI {
  if (!process.env.AI_INTEGRATIONS_GEMINI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_API_KEY must be set in .env to use Gemini.",
    );
  }
  if (!process.env.AI_INTEGRATIONS_GEMINI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_GEMINI_BASE_URL must be set in .env to use Gemini.",
    );
  }
  return new GoogleGenAI({
    apiKey: process.env.AI_INTEGRATIONS_GEMINI_API_KEY,
    httpOptions: {
      apiVersion: "",
      baseUrl: process.env.AI_INTEGRATIONS_GEMINI_BASE_URL,
    },
  });
}

/**
 * True only when Gemini is explicitly enabled (RECON_ENABLE_GEMINI=1) and its key is set.
 * RECON runs free by default: callers fall back to the rules-based logic otherwise, even
 * if a Gemini key is still present in the environment.
 */
export function isGeminiConfigured(): boolean {
  return (
    process.env.RECON_ENABLE_GEMINI === "1" &&
    Boolean(process.env.AI_INTEGRATIONS_GEMINI_API_KEY && process.env.AI_INTEGRATIONS_GEMINI_BASE_URL)
  );
}

let client: GoogleGenAI | null = null;

export const ai: GoogleGenAI = new Proxy({} as GoogleGenAI, {
  get(_target, prop) {
    client ??= createClient();
    return Reflect.get(client, prop, client);
  },
});
