export type RuntimeEnv = Record<string, string | undefined>;

export function readBoolean(
  env: RuntimeEnv,
  name: string,
  fallback = false,
): boolean {
  const value = env[name]?.trim().toLocaleLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  throw new Error(`${name} must be true or false`);
}

export function readInteger(
  env: RuntimeEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

export function requireEnv(env: RuntimeEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

