import { db, icpConfig } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { logger } from "./logger.js";

export interface IcpConfig {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  qualifySignals: string[];
  disqualifySignals: string[];
  scoreBands: {
    band: string;
    range: string;
    description: string;
  }[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_ICP_CORE = {
  name: "Example — FEC & Arcade Venues",
  description: "Qualify leads for your company — cashless payments, loyalty programs, and kiosk management for staffed venues with an arcade machine fleet. The primary qualifier is fleet size: 15+ arcade/redemption/ticket machines AND a staffed venue (not unattended route operators). Applies to any venue type: arcades, FECs, barcades, super arcades, bowling+arcade combos, bars with large game rooms, trampoline parks with arcade areas, laser tag, go-karts, escape rooms, entertainment restaurants, and any other venue with a meaningful arcade fleet.",
  systemPrompt: `You qualify leads for your company — cashless payments, loyalty, kiosk management for any staffed venue with an arcade machine fleet.

PRIMARY QUALIFIER — Fleet size is the deciding factor:
- QUALIFY if the venue has 15+ arcade/redemption/ticket machines AND is staffed (not unattended route ops)
- This applies regardless of venue type: arcades, FECs, barcades, super arcades, bowling+arcade combos, bars with large game rooms, trampoline parks with arcade areas, laser tag, go-karts, escape rooms, entertainment restaurants, family entertainment, ANY venue with a meaningful arcade fleet
- BARCADES / BEERCADES / SUPER ARCADES: Any venue whose primary identity is gaming (barcade, beercade, *cade suffix) qualifies strongly even if the category says "bar". 70+ machines + bar = score 70-80. 250 machines = score 90+. Token machines or cashless vending = strong signal. Loyalty rewards program already in place = upgrade opportunity. Do NOT penalise the bar/beer component.
- TOKEN VENDING MACHINES: venues using tokens/coins are a prime cashless upgrade opportunity — score boost

SCORE BANDS (all require staffed venue + 15+ machines):
- 90-100: 50+ machines, full redemption counter, loyalty program, multi-attraction OR national/regional chain (Dave & Buster's, Round 1, Main Event, etc. — always score 90+ regardless of category in CSV)
- 80-89: 30-50 machines, staffed redemption, strong FEC identity
- 70-79: 20-30 machines, staffed arcade section, clear ticket/redemption evidence
- 60-69: 15-20 machines confirmed OR "15+" inferred from website/signals — verify size before outreach
- 40-59: Signals suggest arcade fleet but machine count unconfirmed — lean qualify, score reflects uncertainty

DISQUALIFY (score 0-20):
- Segment 1: Unattended route operators, 1-5 standalone machines with no staff
- Segment 2: Bar/restaurant with only 2-3 machines and no redemption system
- Retail stores selling hardware (not operating venues)
- Pure VR lounges with no physical arcade

IMPORTANT — Do NOT disqualify based on category alone:
- A "bar" with a dedicated game room and redemption counter → QUALIFY
- A "bowling alley" with 20+ arcade machines → QUALIFY
- A "restaurant" with a large arcade section → QUALIFY
- Only disqualify if evidence shows fewer than 15 machines OR purely unattended

MACHINE COUNT SIGNALS (use all available evidence):
- Explicit mention: "50 games", "20+ machines", "arcade with X cabinets"
- Redemption/prize counter → implies 15+ (single machines don't have redemption counters)
- Large token/card system → implies fleet operation
- Dedicated arcade floor/room → implies fleet
- "Largest arcade in [city/state/region]" → score 85+
- No machine count signal → score conservatively (60-65) if category fits

Based on the crawled website content provided, score this lead from 0-100 and explain your reasoning.

Return ONLY valid JSON with this exact structure:
{
  "score": <number 0-100>,
  "verdict": "QUALIFY" | "BORDERLINE" | "DISQUALIFY",
  "icpExplanation": "<2-3 sentence explanation of score and fit>",
  "keySignals": ["<signal found on website>", ...],
  "missingSignals": ["<signal looked for but not found>", ...],
  "recommendedAction": "<specific next action for sales team>"
}`,
  qualifySignals: [
    "15+ arcade/redemption/ticket machines (staffed venue)",
    "Full redemption or prize counter present",
    "Ticket games or prize wall present",
    "Token or coin-op payment system (cashless upgrade opportunity)",
    "Existing cashless/card system — upgrade opportunity",
    "Loyalty or rewards program in place",
    "National/regional chain (Dave & Buster's, Round 1, Main Event, etc.)",
    "Multi-attraction venue (bowling, laser tag, go-karts + arcade)",
    "Barcade, beercade, or super arcade identity",
    "\"Largest arcade in [city/state/region]\" claim",
    "Birthday party rooms or private event hosting",
    "Dedicated arcade floor or game room",
  ],
  disqualifySignals: [
    "Unattended route operator (no on-site staff)",
    "Fewer than 15 machines with no redemption system",
    "Bar or restaurant with only 2-3 standalone machines and no redemption",
    "Retail store selling arcade hardware (not operating a venue)",
    "Pure VR lounge with no physical arcade machines",
  ],
  scoreBands: [
    {
      band: "Top Tier — Prioritise",
      range: "90-100",
      description: "50+ machines, full redemption, loyalty program, multi-attraction OR national chain. Call immediately.",
    },
    {
      band: "Strong Fit — Outreach Now",
      range: "80-89",
      description: "30-50 machines, staffed redemption, strong FEC identity. High-value prospect.",
    },
    {
      band: "Good Fit — Targeted Outreach",
      range: "70-79",
      description: "20-30 machines, staffed arcade section, clear ticket/redemption evidence.",
    },
    {
      band: "Probable Fit — Verify First",
      range: "60-69",
      description: "15-20 machines confirmed or inferred. Confirm fleet size before outreach.",
    },
    {
      band: "Uncertain — Needs Research",
      range: "40-59",
      description: "Arcade signals present but machine count unconfirmed. Research further before engaging.",
    },
    {
      band: "Disqualified",
      range: "0-39",
      description: "Does not meet minimum fleet size, unattended operator, or no relevant arcade presence.",
    },
  ],
};

const store = new Map<string, IcpConfig>();
let activeIcpId: string | null = null;

function rowToConfig(row: typeof icpConfig.$inferSelect): IcpConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    systemPrompt: row.systemPrompt,
    qualifySignals: row.qualifySignals as string[],
    disqualifySignals: row.disqualifySignals as string[],
    scoreBands: row.scoreBands as IcpConfig["scoreBands"],
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function persistIcp(config: IcpConfig): Promise<void> {
  try {
    await db
      .insert(icpConfig)
      .values({
        id: config.id,
        name: config.name,
        description: config.description,
        systemPrompt: config.systemPrompt,
        qualifySignals: config.qualifySignals,
        disqualifySignals: config.disqualifySignals,
        scoreBands: config.scoreBands,
        isActive: config.isActive,
        createdAt: new Date(config.createdAt),
        updatedAt: new Date(config.updatedAt),
      })
      .onConflictDoUpdate({
        target: icpConfig.id,
        set: {
          name: config.name,
          description: config.description,
          systemPrompt: config.systemPrompt,
          qualifySignals: config.qualifySignals,
          disqualifySignals: config.disqualifySignals,
          scoreBands: config.scoreBands,
          isActive: config.isActive,
          updatedAt: new Date(config.updatedAt),
        },
      });
  } catch (err) {
    logger.error({ err }, "Failed to persist ICP config to DB");
  }
}

export async function initIcpStore(): Promise<void> {
  try {
    const rows = await db.select().from(icpConfig).orderBy(desc(icpConfig.createdAt));

    if (rows.length === 0) {
      // Seed default ICP
      const now = new Date();
      const defaultId = randomUUID();
      const defaultConfig: IcpConfig = {
        ...DEFAULT_ICP_CORE,
        id: defaultId,
        isActive: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      store.set(defaultId, defaultConfig);
      activeIcpId = defaultId;
      await persistIcp(defaultConfig);
      logger.info("ICP config seeded to database with defaults");
    } else {
      for (const row of rows) {
        const config = rowToConfig(row);
        store.set(config.id, config);
        if (config.isActive) activeIcpId = config.id;
      }
      // If nothing is marked active, activate the most recent
      if (!activeIcpId && rows.length > 0) {
        const first = rowToConfig(rows[0]);
        first.isActive = true;
        store.set(first.id, first);
        activeIcpId = first.id;
        await db.update(icpConfig).set({ isActive: true }).where(eq(icpConfig.id, first.id));
      }
      logger.info({ count: rows.length, activeId: activeIcpId }, "ICP configs loaded from database");
    }
  } catch (err) {
    logger.error({ err }, "Failed to load ICP config from DB, using defaults");
    // Fallback in-memory
    const fallbackId = randomUUID();
    const now = new Date().toISOString();
    const fallback: IcpConfig = { ...DEFAULT_ICP_CORE, id: fallbackId, isActive: true, createdAt: now, updatedAt: now };
    store.set(fallbackId, fallback);
    activeIcpId = fallbackId;
  }
}

export function getIcp(): IcpConfig {
  if (activeIcpId && store.has(activeIcpId)) return { ...store.get(activeIcpId)! };
  const first = store.values().next().value;
  if (first) return { ...first };
  // Should never happen after init, but return a default just in case
  const now = new Date().toISOString();
  return { ...DEFAULT_ICP_CORE, id: "fallback", isActive: true, createdAt: now, updatedAt: now };
}

export function listIcps(): IcpConfig[] {
  return Array.from(store.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getIcpById(id: string): IcpConfig | undefined {
  const config = store.get(id);
  return config ? { ...config } : undefined;
}

export async function createIcp(data: Omit<IcpConfig, "id" | "isActive" | "createdAt" | "updatedAt">): Promise<IcpConfig> {
  const now = new Date().toISOString();
  const config: IcpConfig = {
    ...data,
    id: randomUUID(),
    isActive: false,
    createdAt: now,
    updatedAt: now,
  };
  store.set(config.id, config);
  await persistIcp(config);
  return { ...config };
}

export async function updateIcpById(id: string, updates: Partial<Omit<IcpConfig, "id" | "isActive" | "createdAt">>): Promise<IcpConfig | null> {
  const existing = store.get(id);
  if (!existing) return null;
  const updated: IcpConfig = { ...existing, ...updates, updatedAt: new Date().toISOString() };
  store.set(id, updated);
  await persistIcp(updated);
  return { ...updated };
}

export async function activateIcp(id: string): Promise<IcpConfig | null> {
  const target = store.get(id);
  if (!target) return null;

  // Deactivate current active
  if (activeIcpId && activeIcpId !== id) {
    const prev = store.get(activeIcpId);
    if (prev) {
      prev.isActive = false;
      store.set(activeIcpId, prev);
      await persistIcp(prev);
    }
  }

  target.isActive = true;
  target.updatedAt = new Date().toISOString();
  store.set(id, target);
  activeIcpId = id;
  await persistIcp(target);
  return { ...target };
}

export async function deleteIcp(id: string): Promise<boolean> {
  if (!store.has(id)) return false;
  const config = store.get(id)!;
  store.delete(id);

  try {
    await db.delete(icpConfig).where(eq(icpConfig.id, id));
  } catch (err) {
    logger.error({ err, id }, "Failed to delete ICP from DB");
  }

  // If deleting the active one, activate the most recent remaining
  if (activeIcpId === id) {
    const remaining = Array.from(store.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
    if (remaining.length > 0) {
      await activateIcp(remaining[0].id);
    } else {
      activeIcpId = null;
    }
  }

  return true;
}

export async function resetIcp(): Promise<IcpConfig> {
  const active = store.get(activeIcpId ?? "");
  const id = active?.id ?? randomUUID();
  const now = new Date().toISOString();
  const reset: IcpConfig = {
    ...DEFAULT_ICP_CORE,
    id,
    isActive: true,
    createdAt: active?.createdAt ?? now,
    updatedAt: now,
  };
  store.set(id, reset);
  activeIcpId = id;
  await persistIcp(reset);
  return { ...reset };
}

// Legacy compat
export function updateIcp(updates: Partial<Omit<IcpConfig, "id" | "isActive" | "createdAt" | "updatedAt">>): IcpConfig {
  const current = getIcp();
  const updated: IcpConfig = { ...current, ...updates, updatedAt: new Date().toISOString() };
  store.set(current.id, updated);
  void persistIcp(updated);
  return { ...updated };
}
