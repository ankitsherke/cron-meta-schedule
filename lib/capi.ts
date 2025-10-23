import crypto from "crypto";

export function sha256LowerHex(input: string): string {
  return crypto.createHash("sha256").update(input.trim().toLowerCase(), "utf8").digest("hex");
}

export function normalizePhoneToE164(raw?: string | null): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t.startsWith("+")) return null;
  const digits = t.replace(/[^\d+]/g, "");
  return /^\+\d{8,16}$/.test(digits) ? digits : null;
}

export function eventIdFor(sessionId: string, experimentLabel?: string): string {
  const label = experimentLabel?.trim() || "default";
  return `chat-threshold:${label}:${sessionId}`;
}

export function isTestNumber(e164: string, testListCsv: string | undefined): boolean {
  if (!testListCsv) return false;
  const set = new Set(testListCsv.split(",").map(s => s.trim()).filter(Boolean));
  return set.has(e164.trim());
}

export type MetabaseRow = {
  session_id: string;
  phone_e164: string | null;
  messages_sent: number;
  source_url: string | null;
  experiment_label?: string | null;
};

export async function withRetries<T>(
  fn: () => Promise<T>,
  attempts = 3,
  baseDelayMs = 400
): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      const backoff = baseDelayMs * Math.pow(2, i);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  throw lastErr;
}
