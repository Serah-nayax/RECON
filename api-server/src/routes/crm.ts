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

// ── Helpers ───────────────────────────────────────────────────────────────────

/** "https://www.Foo.com/contact" → "foo.com"; undefined when the URL has no usable host. */
export function domainOf(url: string | undefined): string | undefined {
  const raw = url?.trim();
  if (!raw) return undefined;
  try {
    const host = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`).hostname;
    const domain = host.toLowerCase().replace(/^www\./, "");
    return domain.includes(".") ? domain : undefined;
  } catch {
    return undefined;
  }
}

/** Drops empty values: an update must not blank a field the sales team already filled in the CRM. */
function withoutEmpty<T>(fields: Record<string, T | null | undefined>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(fields).filter(([, v]) => v !== undefined && v !== null && v !== ""),
  ) as Record<string, T>;
}

// ── HubSpot ───────────────────────────────────────────────────────────────────

export function hubspotProperties(lead: LeadPayload): Record<string, string> {
  return withoutEmpty({
    // "name" is the company name property ("company" belongs to contacts: companies were created nameless).
    name: lead.name,
    domain: domainOf(lead.url),
    website: lead.url?.trim(),
    city: lead.city,
    country: lead.country,
    recon_score: lead.score != null ? String(lead.score) : undefined,
    recon_verdict: lead.verdict ?? undefined,
    recon_key_signals: (lead.keySignals ?? []).join("; "),
    recon_missing_signals: (lead.missingSignals ?? []).join("; "),
    recon_icp_explanation: lead.icpExplanation ?? undefined,
    recon_recommended_action: lead.recommendedAction ?? undefined,
    recon_category: lead.category,
  });
}

async function pushToHubspot(leads: LeadPayload[]): Promise<{ pushed: number; errors: string[] }> {
  const token = getConfig("HUBSPOT_ACCESS_TOKEN");
  if (!token) {
    throw new Error("HUBSPOT_ACCESS_TOKEN is not configured. Add it in Settings to enable HubSpot push.");
  }
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const errors: string[] = [];
  let pushed = 0;

  for (const lead of leads) {
    try {
      const properties = hubspotProperties(lead);
      const domain = domainOf(lead.url);

      // Search for the existing company first to avoid duplicates. By domain, which HubSpot fills
      // itself ("foo.com"): an exact website match missed "https://www.foo.com/" vs "foo.com".
      // A place without a website is matched by name: an empty filter would match an unrelated company.
      const searchRes = await fetch("https://api.hubapi.com/crm/v3/objects/companies/search", {
        method: "POST",
        headers,
        body: JSON.stringify({
          filterGroups: [{
            filters: [domain
              ? { propertyName: "domain", operator: "EQ", value: domain }
              : { propertyName: "name", operator: "EQ", value: lead.name }],
          }],
          properties: ["name", "domain"],
          limit: 1,
        }),
      });

      if (!searchRes.ok) {
        const err = await searchRes.json().catch(() => ({})) as { message?: string };
        throw new Error(`HubSpot search failed: ${err.message ?? searchRes.statusText}`);
      }

      const searchData = await searchRes.json() as { results?: { id: string }[] };
      const existingId = searchData.results?.[0]?.id;

      const writeRes = existingId
        ? await fetch(`https://api.hubapi.com/crm/v3/objects/companies/${existingId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify({ properties }),
          })
        : await fetch("https://api.hubapi.com/crm/v3/objects/companies", {
            method: "POST",
            headers,
            body: JSON.stringify({ properties }),
          });
      if (!writeRes.ok) {
        const err = await writeRes.json().catch(() => ({})) as { message?: string };
        throw new Error(`HubSpot ${existingId ? "update" : "create"} failed: ${err.message ?? writeRes.statusText}`);
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

const SF_API = "/services/data/v59.0";

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

/** Quotes a value for a SOQL string literal; `like` also escapes the % and _ wildcards. */
export function soqlString(value: string, like = false): string {
  let v = value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  if (like) v = v.replace(/%/g, "\\%").replace(/_/g, "\\_");
  return v;
}

/** The query that finds the existing Account: by website domain, or by exact name without a website. */
export function salesforceLookupQuery(lead: LeadPayload): string {
  const domain = domainOf(lead.url);
  const where = domain
    ? `Website LIKE '%${soqlString(domain, true)}%'`
    : `Name = '${soqlString(lead.name)}'`;
  return `SELECT Id FROM Account WHERE ${where} ORDER BY LastModifiedDate DESC LIMIT 1`;
}

async function salesforceError(res: globalThis.Response, action: string): Promise<Error> {
  const err = await res.json().catch(() => [{}]) as Array<{ message?: string }> | { message?: string };
  const message = Array.isArray(err) ? err[0]?.message : err.message;
  return new Error(`Salesforce ${action} failed: ${message ?? res.statusText}`);
}

async function pushToSalesforce(leads: LeadPayload[]): Promise<{ pushed: number; errors: string[] }> {
  const { token, instanceUrl } = await getSalesforceToken();
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const errors: string[] = [];
  let pushed = 0;

  for (const lead of leads) {
    try {
      const fields = withoutEmpty<unknown>({
        Name: lead.name,
        Website: lead.url?.trim(),
        BillingCity: lead.city,
        BillingCountry: lead.country,
        RECON_Score__c: lead.score,
        RECON_Verdict__c: lead.verdict,
        RECON_Key_Signals__c: (lead.keySignals ?? []).join("; "),
        RECON_Missing_Signals__c: (lead.missingSignals ?? []).join("; "),
        RECON_ICP_Explanation__c: lead.icpExplanation,
        RECON_Recommended_Action__c: lead.recommendedAction,
        RECON_Category__c: lead.category,
      });

      // Look the Account up, then update or create it. The former upsert used Website as an
      // external ID, which Salesforce refuses (Website cannot be an External ID field): every push failed.
      const queryRes = await fetch(
        `${instanceUrl}${SF_API}/query?q=${encodeURIComponent(salesforceLookupQuery(lead))}`,
        { headers },
      );
      if (!queryRes.ok) throw await salesforceError(queryRes, "lookup");
      const queryData = await queryRes.json() as { records?: { Id: string }[] };
      const existingId = queryData.records?.[0]?.Id;

      const writeRes = existingId
        ? await fetch(`${instanceUrl}${SF_API}/sobjects/Account/${existingId}`, {
            method: "PATCH",
            headers,
            body: JSON.stringify(fields),
          })
        : await fetch(`${instanceUrl}${SF_API}/sobjects/Account`, {
            method: "POST",
            headers,
            body: JSON.stringify(fields),
          });
      // 204 = updated, 201 = created
      if (!writeRes.ok) throw await salesforceError(writeRes, existingId ? "update" : "create");

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
  if (body.leads.some((l) => !l || typeof l.name !== "string" || !l.name.trim())) {
    res.status(400).json({ error: "every lead needs a name" });
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
