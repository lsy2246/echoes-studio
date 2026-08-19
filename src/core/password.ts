const encoder = new TextEncoder();
export const DEFAULT_PASSWORD_HASH_ITERATIONS = 100_000;
export const PASSWORD_HASH_ITERATION_OPTIONS = [100_000, 150_000, 210_000] as const;

export function isPasswordHashIterations(value: unknown): value is number {
  return PASSWORD_HASH_ITERATION_OPTIONS.some((option) => option === value);
}

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

export async function hashPassword(
  password: string,
  iterations = DEFAULT_PASSWORD_HASH_ITERATIONS,
): Promise<string> {
  if (!isPasswordHashIterations(iterations)) {
    throw new Error("Unsupported password hash iterations");
  }
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const digest = await derive(password, salt, iterations);
  return `pbkdf2-sha256$${iterations}$${encode(salt)}$${encode(digest)}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
  expectedIterations = DEFAULT_PASSWORD_HASH_ITERATIONS,
): Promise<boolean> {
  const [algorithm, iterationsValue, saltValue, digestValue] = encoded.split("$");
  const iterations = Number(iterationsValue);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !isPasswordHashIterations(expectedIterations) ||
    iterations !== expectedIterations
  ) return false;
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
