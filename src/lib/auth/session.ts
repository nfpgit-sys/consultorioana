/**
 * Sesión basada en la "clave del consultorio" (sin usuarios).
 * La cookie contiene un token firmado con HMAC-SHA256 (Web Crypto, funciona en el proxy y en el servidor):
 *   base64url(payload) . base64url(firma)
 * El payload incluye una huella de la clave vigente: si se cambia la clave, todas las sesiones caducan.
 */

export const SESSION_COOKIE = "cia_sesion";
export const ACTOR_COOKIE = "cia_nombre";
export const SESSION_MAX_AGE_SECONDS = 90 * 24 * 60 * 60;

export interface SessionConfig {
  clave: string;
  sessionSecret: string | null;
}

interface SessionPayload {
  v: 1;
  iat: number;
  exp: number;
  kid: string;
}

const encoder = new TextEncoder();

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((value.length + 3) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

async function keyFor(cfg: SessionConfig): Promise<CryptoKey> {
  const material = cfg.sessionSecret ?? `consultoria-sesion:${cfg.clave}`;
  return crypto.subtle.importKey("raw", encoder.encode(material), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

export async function claveFingerprint(clave: string): Promise<string> {
  return (await sha256Hex(`kid:${clave}`)).slice(0, 16);
}

export async function createSessionToken(cfg: SessionConfig, now = Date.now()): Promise<string> {
  const iat = Math.floor(now / 1000);
  const payload: SessionPayload = { v: 1, iat, exp: iat + SESSION_MAX_AGE_SECONDS, kid: await claveFingerprint(cfg.clave) };
  const body = toBase64Url(encoder.encode(JSON.stringify(payload)));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await keyFor(cfg), encoder.encode(body)));
  return `${body}.${toBase64Url(signature)}`;
}

export async function verifySessionToken(token: string | undefined | null, cfg: SessionConfig, now = Date.now()): Promise<boolean> {
  if (!token || token.length > 512) return false;
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) return false;
  try {
    const valid = await crypto.subtle.verify(
      "HMAC",
      await keyFor(cfg),
      fromBase64Url(signature) as Uint8Array<ArrayBuffer>,
      encoder.encode(body),
    );
    if (!valid) return false;
    const payload = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionPayload;
    if (payload.v !== 1 || typeof payload.exp !== "number") return false;
    if (payload.exp * 1000 < now) return false;
    return payload.kid === (await claveFingerprint(cfg.clave));
  } catch {
    return false;
  }
}

/** Comparación en tiempo constante de la clave ingresada contra la configurada. */
export async function claveMatches(input: string, expected: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256Hex(`cmp:${input}`), sha256Hex(`cmp:${expected}`)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function sanitizeActorName(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value.replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 40);
  return cleaned || null;
}
