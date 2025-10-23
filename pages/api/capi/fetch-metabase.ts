import type { NextApiRequest, NextApiResponse } from "next";
import { MetabaseRow, withRetries } from "../../../lib/capi";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
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

    const data = await withRetries(async () => {
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

    res.status(200).json({ rows: data });
  } catch (e: any) {
    res.status(500).json({ error: e?.message || "Metabase fetch error" });
  }
}
