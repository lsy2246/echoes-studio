const encoder = new TextEncoder();
const DEFAULT_ITERATIONS = 100_000;
const MINIMUM_ITERATIONS = 100_000;

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

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: salt.slice().buffer as ArrayBuffer, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt, DEFAULT_ITERATIONS);
  return `pbkdf2-sha256$${DEFAULT_ITERATIONS}$${encode(salt)}$${encode(digest)}`;
}

export async function verifyPassword(password: string, encoded: string): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, digestValue] = encoded.split("$");
  const iterations = Number(iterationsValue);
  if (algorithm !== "pbkdf2-sha256" || !Number.isSafeInteger(iterations) || iterations < MINIMUM_ITERATIONS) return false;
  try {
    const actual = await derive(password, decode(saltValue), iterations);
    const expected = decode(digestValue);
    let difference = actual.length ^ expected.length;
    for (let index = 0; index < Math.max(actual.length, expected.length); index += 1) {
      difference |= (actual[index % actual.length] ?? 0) ^ (expected[index % expected.length] ?? 0);
    }
    return difference === 0;
  } catch {
    return false;
  }
}
