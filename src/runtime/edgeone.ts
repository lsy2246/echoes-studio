import { createRuntimeApp } from "./create-runtime-app.ts";
import { createHostedDatabase } from "./hosted-database.ts";
import type { RuntimeEnv } from "./env.ts";

type RuntimeHandler = (request: Request) => Promise<Response>;

let handler: RuntimeHandler | undefined;

export interface EdgeOneContext {
  request: Request;
  /** EdgeOne Makers injects project variables and secrets per request. */
  env?: RuntimeEnv;
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  if (!handler) {
    // Keep process.env as a local/CLI fallback, while preferring the official
    // EdgeOne request context for variables configured with `makers env set`.
    const env: RuntimeEnv = { ...process.env, ...(context.env ?? {}) };
    const { database } = createHostedDatabase(env);
    handler = createRuntimeApp(database, env);
  }
  return handler(context.request);
}

export default onRequest;
