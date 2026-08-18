const encoder = new TextEncoder();
const decoder = new TextDecoder();

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function key(secret: string): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(secret));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(value: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(secret), encoder.encode(value));
  return `aesgcm$${encode(iv)}$${encode(new Uint8Array(encrypted))}`;
}

export async function decryptSecret(value: string, secret: string): Promise<string> {
  const [algorithm, iv, encrypted] = value.split("$");
  if (algorithm !== "aesgcm" || !iv || !encrypted) throw new Error("Stored secret is invalid");
  const clear = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: decode(iv).slice().buffer as ArrayBuffer },
    await key(secret),
    decode(encrypted).slice().buffer as ArrayBuffer,
  );
  return decoder.decode(clear);
}
