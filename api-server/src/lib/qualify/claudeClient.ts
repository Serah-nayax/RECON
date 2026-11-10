import Anthropic, { type ClientOptions } from "@anthropic-ai/sdk";
import { Agent as UndiciAgent } from "undici";

// Claude is opt-in, like Gemini: RECON_ENABLE_CLAUDE=1 plus ANTHROPIC_API_KEY.
// Without both, qualification falls back to Gemini or to the free scorers.
export function isClaudeConfigured(): boolean {
  return process.env.RECON_ENABLE_CLAUDE === "1" && Boolean(process.env.ANTHROPIC_API_KEY);
}

export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

export function claudeModel(): string {
  return process.env.CLAUDE_MODEL || DEFAULT_CLAUDE_MODEL;
}

export interface ClaudeReply {
  text: string;
  /** Uncached input tokens (full price). */
  inputTokens: number;
  outputTokens: number;
  /** Input tokens written to the prompt cache (1.25x the input price). */
  cacheWriteTokens: number;
  /** Input tokens read from the prompt cache (0.1x the input price). */
  cacheReadTokens: number;
}

let client: Anthropic | null = null;

// HTTP/1.1 only. On the office network, the HTTPS-inspecting proxy cuts the first request of a
// new HTTP/2 connection when its body is over 16 KB (ERR_HTTP2_ERROR), and a qualification
// prompt is ~20 KB. HTTP/1.1 has no such limit.
const http1Agent = new UndiciAgent({ allowH2: false });

function getClient(): Anthropic {
  client ??= new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
    // The SDK retries 429 and 5xx itself; qualifyLead adds its own retry on top.
    maxRetries: 2,
    // `dispatcher` is a Node fetch option that the SDK's RequestInit type does not list.
    fetchOptions: { dispatcher: http1Agent } as unknown as ClientOptions["fetchOptions"],
  });
  return client;
}

type JsonSchema = Record<string, unknown>;

// Pre-warming. A batch starts up to QUALIFY_CONCURRENCY leads at once, and the cache only exists
// once a first request has started, so without this they would all write it. When the instructions
// were not used in the last WARM_FOR_MS, one 1-token request writes the cache and the leads that
// arrive meanwhile wait for it. (`max_tokens: 0`, the documented pre-warm, is rejected together
// with a JSON schema, and the schema must be sent: it is part of the cached prefix.)
const WARM_FOR_MS = 4 * 60 * 1000; // under the 5-minute cache lifetime
let warmKey = "";
let warmUntil = 0;
let warming: Promise<void> | null = null;

function systemBlock(instructions: string) {
  return [{ type: "text" as const, text: instructions, cache_control: { type: "ephemeral" as const } }];
}

/** Writes the instructions to the cache if they are cold. Returns the tokens it wrote (0 if already warm). */
async function ensureWarm(instructions: string, schema: JsonSchema, signal?: AbortSignal): Promise<number> {
  const key = instructions + JSON.stringify(schema);
  if (key === warmKey && Date.now() < warmUntil) return 0;
  if (warming && key === warmKey) {
    await warming;
    return 0;
  }
  warmKey = key;
  let written = 0;
  warming = getClient()
    .messages.create(
      {
        model: claudeModel(),
        max_tokens: 1,
        system: systemBlock(instructions),
        messages: [{ role: "user", content: "." }],
        output_config: { format: { type: "json_schema", schema } },
      },
      { signal },
    )
    .then((response) => {
      written = response.usage.cache_creation_input_tokens ?? 0;
      warmUntil = Date.now() + WARM_FOR_MS;
    })
    // A failed pre-warm only costs the cache: the real call still works and writes it itself.
    .catch(() => {})
    .finally(() => {
      warming = null;
    });
  await warming;
  return written;
}

/**
 * One qualification call. Haiku by default; CLAUDE_MODEL overrides it.
 * `instructions` (the same for every lead of an ICP) carry a prompt-cache breakpoint: the first
 * call writes them to the cache, and the following calls within 5 minutes read them at 0.1x the
 * input price. Each read refreshes the 5 minutes, so a running batch keeps the cache warm.
 * cacheWriteTokens includes what the pre-warm request wrote, if this call triggered one.
 * The reply is constrained to `schema` (structured outputs), so it is always valid JSON.
 */
export async function askClaude(
  instructions: string,
  lead: string,
  schema: JsonSchema,
  signal?: AbortSignal,
): Promise<ClaudeReply> {
  const warmWriteTokens = await ensureWarm(instructions, schema, signal);
  const response = await getClient().messages.create(
    {
      model: claudeModel(),
      // Replies reach ~3,600 tokens; a cut-off reply is incomplete JSON, so leave room.
      max_tokens: 8192,
      system: systemBlock(instructions),
      messages: [{ role: "user", content: lead }],
      output_config: { format: { type: "json_schema", schema } },
    },
    { signal },
  );
  // A cache read or write restarts the cache lifetime.
  if (instructions + JSON.stringify(schema) === warmKey) warmUntil = Date.now() + WARM_FOR_MS;
  // A reply cut by max_tokens or a refusal may not match the schema: qualifyLead's JSON parsing
  // rejects it and retries, and its tokens are still counted (they are billed).
  const text = response.content
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
  // An empty reply stays empty: qualifyLead's JSON parsing rejects it and retries. Turning it
  // into "{}" scored the lead as "unknown business" (DISQUALIFY) with no error shown.
  return {
    text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    cacheWriteTokens: warmWriteTokens + (response.usage.cache_creation_input_tokens ?? 0),
    cacheReadTokens: response.usage.cache_read_input_tokens ?? 0,
  };
}
