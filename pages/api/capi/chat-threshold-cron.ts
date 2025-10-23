import type { NextApiRequest, NextApiResponse } from "next";
import { eventIdFor, isTestNumber, MetabaseRow, normalizePhoneToE164, sha256LowerHex, withRetries } from "../../../lib/capi";
import { getRedisClient } from "../../../lib/redis";

type MetaEvent = {
  event_name: string;
  event_time: number;
  event_source_url?: string | null;
  action_source: string;
  event_id: string;
  user_data: { ph: string[] };
  custom_data: Record<string, any>;
};

async function fetchMetabaseRows(): Promise<MetabaseRow[]> {
  const site = process.env.METABASE_SITE_URL!;
  const token = process.env.METABASE_SESSION_TOKEN || process.env.METABASE_API_TOKEN;
  if (!token) throw new Error("Missing METABASE_SESSION_TOKEN");
  const questionId = process.env.METABASE_QUESTION_ID!;
  const dateStart = process.env.METABASE_DATE_START;
  const dateEnd = process.env.METABASE_DATE_END;
  const botId = process.env.METABASE_BOT_ID;
  const dateStartTag = process.env.METABASE_DATE_START_TAG || "date_start";
  const dateEndTag = process.env.METABASE_DATE_END_TAG || "date_end";
  const botIdTag = process.env.METABASE_BOT_ID_TAG || "bot_id";

  const url = `${site}/api/card/${questionId}/query/json`;
  const parameters: Array<Record<string, unknown>> = [];

  if (dateStart) {
    parameters.push({
      type: "category",
      target: ["variable", ["template-tag", dateStartTag]],
      value: dateStart
    });
  }
  if (dateEnd) {
    parameters.push({
      type: "category",
      target: ["variable", ["template-tag", dateEndTag]],
      value: dateEnd
    });
  }
  if (botId) {
    parameters.push({
      type: "category",
      target: ["variable", ["template-tag", botIdTag]],
      value: botId
    });
  }

  const body = parameters.length > 0 ? { parameters } : {};

  return await withRetries(async () => {
    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Metabase-Session": token },
      body: JSON.stringify(body)
    });
    if (!r.ok) {
      const errText = await r.text().catch(() => "");
      throw new Error(`Metabase ${r.status}: ${errText || "unknown error"}`);
    }
    return (await r.json()) as MetabaseRow[];
  });
}

async function sendMetaEvents(payload: { data: MetaEvent[] }) {
  const pixelId = process.env.META_PIXEL_ID!;
  const token = process.env.META_ACCESS_TOKEN!;
  const testCode = process.env.META_TEST_EVENT_CODE;
  const url = new URL(`https://graph.facebook.com/v18.0/${pixelId}/events`);
  url.searchParams.set("access_token", token);
  if (testCode) url.searchParams.set("test_event_code", testCode);

  return await withRetries(async () => {
    const r = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const txt = await r.text();
    if (!r.ok) throw new Error(`Meta CAPI ${r.status}: ${txt}`);
    return JSON.parse(txt);
  });
}

async function alreadyFired(sessionId: string, experiment: string): Promise<boolean> {
  const client = await getRedisClient();
  const key = `capi:chat-threshold:${experiment}:${sessionId}`;
  const exists = await client.exists(key);
  return exists === 1;
}

async function markFired(sessionId: string, experiment: string) {
  const client = await getRedisClient();
  const key = `capi:chat-threshold:${experiment}:${sessionId}`;
  await client.set(key, new Date().toISOString(), { EX: 60 * 60 * 24 * 180 });
  if (process.env.NODE_ENV !== "production") {
    console.log("marked fired", key);
  }
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const testListCsv = process.env.TEST_NUMBERS_E164;
    const actionSource = process.env.META_ACTION_SOURCE || "website";

    const rows = await fetchMetabaseRows();

    const eligible: MetabaseRow[] = rows.filter(r => {
      const e164 = normalizePhoneToE164(r.phone_e164);
      if (!e164) return false;
      if (isTestNumber(e164, testListCsv)) return false;
      return r.messages_sent > 5;
    });

    const events: MetaEvent[] = [];
    const sessionToExperiment = new Map<string, string>();

    for (const r of eligible) {
      const e164 = normalizePhoneToE164(r.phone_e164);
      if (!e164) continue;

      const experiment = (r.experiment_label || "default").trim() || "default";
      const eid = eventIdFor(r.session_id, experiment);

      if (await alreadyFired(r.session_id, experiment)) continue;

      const phHash = sha256LowerHex(e164.replace(/^\+/, ""));

      const evt: MetaEvent = {
        event_name: "ChatMessagesThresholdCrossed",
        event_time: Math.floor(Date.now() / 1000),
        event_source_url: r.source_url || undefined,
        action_source: actionSource,
        event_id: eid,
        user_data: { ph: [phHash] },
        custom_data: {
          messages_sent: r.messages_sent,
          experiment_label: experiment,
          source_url: r.source_url || null
        }
      };

      events.push(evt);
      sessionToExperiment.set(r.session_id, experiment);
    }

    if (events.length === 0) {
      return res.status(200).json({ status: "ok", processed: 0 });
    }

    const metaResp = await sendMetaEvents({ data: events });

    for (const [sessionId, experiment] of sessionToExperiment.entries()) {
      await markFired(sessionId, experiment);
    }

    res.status(200).json({ status: "ok", processed: events.length, meta: metaResp });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "cron failure" });
  }
}
