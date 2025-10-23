import type { NextApiRequest, NextApiResponse } from "next";
import { sha256LowerHex, eventIdFor, withRetries } from "../../../lib/capi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { e164, session_id, experiment_label = "default", source_url } = req.query as Record<string, string>;
    if (!e164 || !session_id) return res.status(400).json({ error: "e164 and session_id are required" });

    const pixelId = process.env.META_PIXEL_ID!;
    const token = process.env.META_ACCESS_TOKEN!;
    const testCode = process.env.META_TEST_EVENT_CODE;

    const phHash = sha256LowerHex(e164.replace(/^\+/, ""));
    const event_id = eventIdFor(session_id, experiment_label);

    const payload = {
      data: [
        {
          event_name: "ChatMessagesThresholdCrossed",
          event_time: Math.floor(Date.now() / 1000),
          event_source_url: source_url || undefined,
          action_source: process.env.META_ACTION_SOURCE || "website",
          event_id,
          user_data: { ph: [phHash] },
          custom_data: { messages_sent: 6, experiment_label, source_url: source_url || null }
        }
      ]
    };

    const url = new URL(`https://graph.facebook.com/v18.0/${pixelId}/events`);
    url.searchParams.set("access_token", token);
    if (testCode) url.searchParams.set("test_event_code", testCode);

    const out = await withRetries(async () => {
      const r = await fetch(url.toString(), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const t = await r.text();
      if (!r.ok) throw new Error(t);
      return JSON.parse(t);
    });

    res.status(200).json({ ok: true, out, sent: payload });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "debug-fire failed" });
  }
}
