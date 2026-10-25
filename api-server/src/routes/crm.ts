import { Router, type IRouter, type Request, type Response } from "express";
import { apiKeyMiddleware } from "../lib/apiKeyMiddleware.js";
import { getConfig } from "../lib/configStore.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();
router.use(apiKeyMiddleware);

// ── Types ─────────────────────────────────────────────────────────────────────

interface LeadPayload {
  name: string;
  url?: string;
  category?: string;
  city?: string;
  country?: string;
  score?: number | null;
  verdict?: string | null;
  keySignals?: string[];
  missingSignals?: string[];
  icpExplanation?: string | null;
  recommendedAction?: string | null;
}

type CrmTarget = "hubspot" | "salesforce";

interface PushRequest {
  crm: CrmTarget;
  leads: LeadPayload[];
}

// ── HubSpot ───────────────────────────────────────────────────────────────────

async function pushToHubspot(leads: LeadPayload[]): Promise<{ pushed: number; errors: string[] }> {
  const token = getConfig("HUBSPOT_ACCESS_TOKEN");
  if (!token) {
    throw new Error("HUBSPOT_ACCESS_TOKEN is not configured. Add it in Settings to enable HubSpot push.");
  }

  const errors: string[] = [];
  let pushed = 0;

  for (const lead of leads) {
    try {
      const properties: Record<string, string> = {
        company: lead.name,
        website: lead.url ?? "",
        city: lead.city ?? "",
        country: lead.country ?? "",
        recon_score: lead.score != null ? String(lead.score) : "",
        recon_verdict: lead.verdict ?? "",
        recon_key_signals: (lead.keySignals ?? []).join("; "),
        recon_missing_signals: (lead.missingSignals ?? []).join("; "),
        recon_icp_explanation: lead.icpExplanation ?? "",
        recon_recommended_action: lead.recommendedAction ?? "",
        recon_category: lead.category ?? "",
      };

      // Search for existing company first to avoid duplicates
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          filterGroups: [{
            filters: [{ propertyName: "website", operator: "EQ", value: lead.url ?? "" }],
          }],
          properties: ["company", "website"],
          limit: 1,
        }),
      });

      if (!searchRes.ok) {
        const err = await searchRes.json().catch(() => ({})) as Record<string, unknown>;
        throw new Error(`HubSpot search failed: ${(err as { message?: string }).message ?? searchRes.statusText}`);
      }

      const searchData = await searchRes.json() as { results: { id: string }[] };
      const existingId = searchData.results?.[0]?.id;

      if (existingId) {
        // Update existing company
        const updateRes = await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existingId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        });
        if (!updateRes.ok) {
          const err = await updateRes.json().catch(() => ({})) as { message?: string };
          throw new Error(`HubSpot update failed: ${err.message ?? updateRes.statusText}`);
        }
      } else {
        // Create new company
        const createRes = await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ properties }),
        });
        if (!createRes.ok) {
          const err = await createRes.json().catch(() => ({})) as { message?: string };
          throw new Error(`HubSpot create failed: ${err.message ?? createRes.statusText}`);
        }
      }

      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ lead: lead.name, err: msg }, "HubSpot push error");
      errors.push(`${lead.name}: ${msg}`);
    }
  }

  return { pushed, errors };
}

// ── Salesforce ────────────────────────────────────────────────────────────────

async function getSalesforceToken(): Promise<{ token: string; instanceUrl: string }> {
  const clientId = getConfig("SALESFORCE_CLIENT_ID");
  const clientSecret = getConfig("SALESFORCE_CLIENT_SECRET");
  const username = getConfig("SALESFORCE_USERNAME");
  const password = getConfig("SALESFORCE_PASSWORD");
  const securityToken = getConfig("SALESFORCE_SECURITY_TOKEN") ?? "";
  const loginUrl = getConfig("SALESFORCE_LOGIN_URL") ?? "https://login.salesforce.com";

  if (!clientId || !clientSecret || !username || !password) {
    throw new Error(
      "Salesforce credentials not configured. Add them in Settings to enable Salesforce push."
    );
  }

  const params = new URLSearchParams({
    grant_type: "password",
    client_id: clientId,
    client_secret: clientSecret,
    username,
    password: password + securityToken,
  });

  const res = await fetch(`${loginUrl}/services/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({})) as { error_description?: string };
    throw new Error(`Salesforce auth failed: ${err.error_description ?? res.statusText}`);
  }

  const data = await res.json() as { access_token: string; instance_url: string };
  return { token: data.access_token, instanceUrl: data.instance_url };
}

async function pushToSalesforce(leads: LeadPayload[]): Promise<{ pushed: number; errors: string[] }> {
  const { token, instanceUrl } = await getSalesforceToken();

  const errors: string[] = [];
  let pushed = 0;

  for (const lead of leads) {
    try {
      const fields: Record<string, unknown> = {
        Name: lead.name,
        Website: lead.url ?? "",
        BillingCity: lead.city ?? "",
        BillingCountry: lead.country ?? "",
        RECON_Score__c: lead.score ?? null,
        RECON_Verdict__c: lead.verdict ?? "",
        RECON_Key_Signals__c: (lead.keySignals ?? []).join("; "),
        RECON_Missing_Signals__c: (lead.missingSignals ?? []).join("; "),
        RECON_ICP_Explanation__c: lead.icpExplanation ?? "",
        RECON_Recommended_Action__c: lead.recommendedAction ?? "",
        RECON_Category__c: lead.category ?? "",
      };

      // Upsert by Website URL using the composite API
      const upsertRes = await fetch(
        `${instanceUrl}/services/data/v59.0/sobjects/Account/Website/${encodeURIComponent(lead.url ?? lead.name)}`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(fields),
        }
      );

      // 201 = created, 204 = updated, both are success
      if (upsertRes.status !== 201 && upsertRes.status !== 204 && !upsertRes.ok) {
        const err = await upsertRes.json().catch(() => [{}]) as Array<{ message?: string }>;
        throw new Error(`Salesforce upsert failed: ${err[0]?.message ?? upsertRes.statusText}`);
      }

      pushed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ lead: lead.name, err: msg }, "Salesforce push error");
      errors.push(`${lead.name}: ${msg}`);
    }
  }

  return { pushed, errors };
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /api/crm/push  — push one or many leads to the chosen CRM
router.post("/crm/push", async (req: Request, res: Response) => {
  const body = req.body as Partial<PushRequest>;

  if (!body.crm || (body.crm !== "hubspot" && body.crm !== "salesforce")) {
    res.status(400).json({ error: 'crm must be "hubspot" or "salesforce"' });
    return;
  }
  if (!Array.isArray(body.leads) || body.leads.length === 0) {
    res.status(400).json({ error: "leads must be a non-empty array" });
    return;
  }

  const crm = body.crm as CrmTarget;
  const leads = body.leads as LeadPayload[];

  logger.info({ crm, count: leads.length }, "CRM push requested");

  try {
    const result = crm === "hubspot"
      ? await pushToHubspot(leads)
      : await pushToSalesforce(leads);

    res.json({
      crm,
      pushed: result.pushed,
      failed: result.errors.length,
      errors: result.errors,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ crm, err: msg }, "CRM push fatal error");
    res.status(502).json({ error: msg });
  }
});

// GET /api/crm/status — returns which CRMs are configured
router.get("/crm/status", (_req: Request, res: Response) => {
  res.json({
    hubspot: !!getConfig("HUBSPOT_ACCESS_TOKEN"),
    salesforce: !!(
      getConfig("SALESFORCE_CLIENT_ID") &&
      getConfig("SALESFORCE_CLIENT_SECRET") &&
      getConfig("SALESFORCE_USERNAME") &&
      getConfig("SALESFORCE_PASSWORD")
    ),
  });
});

export default router;
