# ChatMessagesThresholdCrossed Cron

Serverless Next.js job that ingests chat sessions from Metabase, fires Meta Conversion API events, and deduplicates via Redis.

## Requirements

- Node.js 18+
- Redis instance (Redis Cloud or Vercel KV-compatible Redis)
- Vercel account (Hobby ok, but cron scheduling handled via Zapier)
- Access to Metabase question with session data
- Meta Pixel + long-lived access token

## Project Structure

```
lib/capi.ts               // Shared helpers (hashing, retries, phone formatting)
lib/redis.ts              // Singleton Redis client
pages/api/capi/fetch-metabase.ts // Raw Metabase fetch endpoint (GET)
pages/api/capi/chat-threshold-cron.ts // Main cron handler
pages/api/capi/debug-fire.ts  // Manual CAPI trigger for test events
app/api/redis/route.ts    // Simple Redis read test (App Router)
vercel.json               // Empty (cron handled externally)
```

## Environment Variables

Populate `.env.local` for local dev and mirror to Vercel:

```
METABASE_SITE_URL=
METABASE_SESSION_TOKEN=        # value of metabase.SESSION cookie (refresh when expired)
METABASE_QUESTION_ID=
METABASE_BOT_ID=               # optional
METABASE_DATE_START=           # optional (Metabase defaults recommended)
METABASE_DATE_END=
METABASE_DATE_START_TAG=date_start
METABASE_DATE_END_TAG=date_end
METABASE_BOT_ID_TAG=bot_id

META_PIXEL_ID=
META_ACCESS_TOKEN=
META_ACTION_SOURCE=website
META_TEST_EVENT_CODE=          # only for verifying in Meta Test Events

TEST_NUMBERS_E164=+911234567890,+911112223334

REDIS_URL=redis://default:password@host:port
VERCEL_PROTECTION_BYPASS_TOKEN= # generated in Vercel → Settings → Deployment Protection
```

## Local Development

```bash
npm install
npm run dev
```

- `GET http://localhost:3000/api/capi/fetch-metabase` → raw rows
- `GET http://localhost:3000/api/capi/chat-threshold-cron` → fires Meta events and writes dedupe keys in Redis
- `GET http://localhost:3000/api/capi/debug-fire?e164=%2B91...&session_id=test` → manual Meta test event
- `GET http://localhost:3000/api/redis` → confirms Redis connectivity (`myKey`)

## Redis Dedupe

- Keys: `capi:chat-threshold:<experiment>:<session_id>`
- TTL: 180 days
- Re-run cron ⇒ `processed: 0` if sessions already fired

Inspect keys:

```bash
REDIS_URL=... node -e '
  const { createClient } = require("redis");
  (async () => {
    const client = createClient({ url: process.env.REDIS_URL });
    await client.connect();
    const keys = await client.keys("capi:chat-threshold:*");
    console.log({ totalKeys: keys.length, sample: keys.slice(0,5) });
    await client.quit();
  })();
'
```

## Deployment

1. `vercel` (or `vercel --prod`) after syncing env vars.
2. Production endpoint: `https://cron-meta-schedule.vercel.app/api/capi/chat-threshold-cron`
3. Preview deployments require `x-vercel-protection-bypass` token in the query string.

## Automating Cron (Zapier)

- Trigger: **Schedule by Zapier** → every 5 minutes.
- Action: **Webhooks by Zapier** → GET URL  
  `https://cron-meta-schedule.vercel.app/api/capi/chat-threshold-cron?x-vercel-set-bypass-cookie=true&x-vercel-protection-bypass=<TOKEN>`
- Zapier logs show response payload; Vercel logs should mirror successful runs.

## Troubleshooting

- **Metabase 401**: refresh `metabase.SESSION` cookie and redeploy.
- **No events fired**: ensure `messages_sent > 5`, phones normalize to E.164, and not in `TEST_NUMBERS_E164`.
- **Duplicates**: check Redis keys; clear specific keys (`DEL capi:chat-threshold:...`) if you need to re-fire.
- **Meta errors**: inspect `meta` field in cron response and Events Manager.
