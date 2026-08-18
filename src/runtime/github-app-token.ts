import type { RuntimeEnv } from "./env.ts";

interface InstallationTokenResponse {
  token?: string;
  expires_at?: string;
  message?: string;
}

interface GitHubTokenProviderOptions {
  appId: string;
  installationId: string;
  privateKey: string;
  apiBaseUrl?: string;
  fetch?: typeof globalThis.fetch;
  now?: () => number;
}

function base64Url(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string"
    ? new TextEncoder().encode(value)
    : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const output = new Uint8Array(parts.reduce((length, part) => length + part.byteLength, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.byteLength;
  }
  return output;
}

function derLength(length: number): Uint8Array {
  if (length < 0x80) return Uint8Array.of(length);
  const bytes: number[] = [];
  for (let value = length; value > 0; value >>>= 8) bytes.unshift(value & 0xff);
  return Uint8Array.of(0x80 | bytes.length, ...bytes);
}

function derValue(tag: number, value: Uint8Array): Uint8Array {
  return concatBytes(Uint8Array.of(tag), derLength(value.byteLength), value);
}

/** WebCrypto imports PKCS#8; GitHub downloads App keys as PKCS#1. */
function pkcs1ToPkcs8(pkcs1: Uint8Array): Uint8Array {
  const version = Uint8Array.of(0x02, 0x01, 0x00);
  const rsaAlgorithmIdentifier = Uint8Array.of(
    0x30, 0x0d,
    0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01,
    0x05, 0x00,
  );
  return derValue(0x30, concatBytes(version, rsaAlgorithmIdentifier, derValue(0x04, pkcs1)));
}

function privateKeyBytes(pem: string): ArrayBuffer {
  const normalized = pem.replace(/\\n/g, "\n").trim();
  const pkcs1 = normalized.includes("-----BEGIN RSA PRIVATE KEY-----");
  const begin = pkcs1 ? "-----BEGIN RSA PRIVATE KEY-----" : "-----BEGIN PRIVATE KEY-----";
  const end = pkcs1 ? "-----END RSA PRIVATE KEY-----" : "-----END PRIVATE KEY-----";
  if (!normalized.startsWith(begin) || !normalized.endsWith(end)) {
    throw new Error("CMS_GITHUB_PRIVATE_KEY must be an unencrypted RSA PEM private key");
  }
  const body = normalized.slice(begin.length, -end.length).replace(/\s+/g, "");
  if (!body) throw new Error("CMS_GITHUB_PRIVATE_KEY is not a PEM private key");
  const binary = atob(body);
  const der = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  const bytes = pkcs1 ? pkcs1ToPkcs8(der) : der;
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

async function createAppJwt(
  options: GitHubTokenProviderOptions,
  nowSeconds: number,
): Promise<string> {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64Url(JSON.stringify({
    iat: nowSeconds - 60,
    exp: nowSeconds + 9 * 60,
    iss: options.appId,
  }));
  const unsigned = `${header}.${claims}`;
  const key = await crypto.subtle.importKey(
    "pkcs8",
    privateKeyBytes(options.privateKey),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key,
    new TextEncoder().encode(unsigned),
  );
  return `${unsigned}.${base64Url(signature)}`;
}

/** Creates short-lived installation tokens; the private key never enters the browser. */
export function createGitHubAppTokenProvider(
  options: GitHubTokenProviderOptions,
): () => Promise<string> {
  const request = options.fetch ?? globalThis.fetch;
  const apiBase = (options.apiBaseUrl ?? "https://api.github.com").replace(/\/$/, "");
  const now = options.now ?? Date.now;
  let cached: { token: string; expiresAt: number } | null = null;

  return async () => {
    const current = now();
    if (cached && cached.expiresAt - 60_000 > current) return cached.token;
    const jwt = await createAppJwt(options, Math.floor(current / 1000));
    const response = await request(
      `${apiBase}/app/installations/${encodeURIComponent(options.installationId)}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${jwt}`,
          "x-github-api-version": "2022-11-28",
        },
      },
    );
    const payload = await response.json() as InstallationTokenResponse;
    if (!response.ok || !payload.token || !payload.expires_at) {
      throw new Error(
        `GitHub App installation token failed (${response.status}): ${payload.message ?? "invalid response"}`,
      );
    }
    cached = {
      token: payload.token,
      expiresAt: Date.parse(payload.expires_at),
    };
    return cached.token;
  };
}

export function githubTokenProviderFromEnv(
  env: RuntimeEnv,
): (() => Promise<string>) | null {
  const staticToken = env.CMS_GITHUB_TOKEN?.trim();
  if (staticToken) return async () => staticToken;
  const appId = env.CMS_GITHUB_APP_ID?.trim();
  const installationId = env.CMS_GITHUB_INSTALLATION_ID?.trim();
  const privateKey = env.CMS_GITHUB_PRIVATE_KEY?.trim();
  if (!appId && !installationId && !privateKey) return null;
  if (!appId || !installationId || !privateKey) {
    throw new Error(
      "CMS_GITHUB_APP_ID, CMS_GITHUB_INSTALLATION_ID and CMS_GITHUB_PRIVATE_KEY must be configured together",
    );
  }
  return createGitHubAppTokenProvider({
    appId,
    installationId,
    privateKey,
    apiBaseUrl: env.CMS_GITHUB_API_URL,
  });
}
