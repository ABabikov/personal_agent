/**
 * Подписанная сессия для простого пароля сайта (Edge + Node: Web Crypto).
 * Включение: SITE_PASSWORD + SITE_AUTH_SECRET в .env
 */

const COOKIE_NAME = "site_auth";

export const SITE_AUTH_COOKIE = COOKIE_NAME;

function bufferToBase64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlToBuffer(s: string): ArrayBuffer | null {
  try {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out.buffer;
  } catch {
    return null;
  }
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey(
    "raw",
    raw,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"]
  );
}

async function signPayload(payload: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret);
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(payload)
  );
  return bufferToBase64Url(sig);
}

function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let x = 0;
  for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}

/** TTL сессии (секунды в payload = unix expiry). */
const SESSION_SEC = 30 * 24 * 60 * 60;

export async function issueSessionToken(secret: string): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + SESSION_SEC;
  const payload = String(exp);
  const sig = await signPayload(payload, secret);
  return `${payload}.${sig}`;
}

export async function verifySessionToken(
  secret: string,
  token: string | undefined
): Promise<boolean> {
  if (!token?.includes(".")) return false;
  const dot = token.lastIndexOf(".");
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = Number(payload);
  if (!Number.isFinite(exp) || Math.floor(Date.now() / 1000) > exp) return false;
  const expected = await signPayload(payload, secret);
  return timingSafeEqualStr(sig, expected);
}

export function isSiteAuthConfigured(): boolean {
  const p = process.env.SITE_PASSWORD?.trim();
  const s = process.env.SITE_AUTH_SECRET?.trim();
  return Boolean(p && s);
}
