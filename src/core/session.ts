const encoder = new TextEncoder();
const decoder = new TextDecoder();

const JWT_HEADER = { alg: "HS256", typ: "JWT" } as const;
const JWT_ISSUER = "echoes-studio";
const JWT_AUDIENCE = "echoes-studio-admin";

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function encodeJson(value: unknown): string {
  return base64UrlEncode(encoder.encode(JSON.stringify(value)));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

export async function createAdminSession(secret: string, issuedAt = new Date()): Promise<string> {
  const header = encodeJson(JWT_HEADER);
  const payload = encodeJson({
    sub: "admin",
    iss: JWT_ISSUER,
    aud: JWT_AUDIENCE,
    iat: Math.floor(issuedAt.getTime() / 1000),
  });
  const input = `${header}.${payload}`;
  const signature = await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(input));
  return `${input}.${base64UrlEncode(new Uint8Array(signature))}`;
}

export async function verifyAdminSession(token: string, secret: string): Promise<boolean> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return false;
    const [header, payload, signature] = parts;
    const parsedHeader = JSON.parse(decoder.decode(base64UrlDecode(header))) as Record<string, unknown>;
    const parsedPayload = JSON.parse(decoder.decode(base64UrlDecode(payload))) as Record<string, unknown>;
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return false;
    if (
      parsedPayload.sub !== "admin"
      || parsedPayload.iss !== JWT_ISSUER
      || parsedPayload.aud !== JWT_AUDIENCE
      || typeof parsedPayload.iat !== "number"
    ) return false;
    return crypto.subtle.verify(
      "HMAC",
      await hmacKey(secret),
      base64UrlDecode(signature).slice().buffer as ArrayBuffer,
      encoder.encode(`${header}.${payload}`),
    );
  } catch {
    return false;
  }
}
