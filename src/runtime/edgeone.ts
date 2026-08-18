import { createRuntimeApp } from "./create-runtime-app.ts";
import { createHostedDatabase } from "./hosted-database.ts";
import type { RuntimeEnv } from "./env.ts";

type RuntimeHandler = (request: Request) => Promise<Response>;

declare const __EDGEONE_DEPLOYMENT_ENV__: RuntimeEnv | undefined;

let handler: RuntimeHandler | undefined;

function deploymentEnv(): RuntimeEnv {
  return typeof __EDGEONE_DEPLOYMENT_ENV__ === "undefined"
    ? {}
    : __EDGEONE_DEPLOYMENT_ENV__;
}

export interface EdgeOneContext {
  request: Request;
  /** EdgeOne Makers injects project variables and secrets per request. */
  env?: RuntimeEnv;
}

export async function onRequest(context: EdgeOneContext): Promise<Response> {
  if (!handler) {
    // Direct-upload deployments receive the database settings from the
    // server-only bundle generated in GitHub Actions. Context and process env
    // remain supported for local/manual builds without embedded settings.
    const env: RuntimeEnv = {
      ...process.env,
      ...(context.env ?? {}),
      ...deploymentEnv(),
    };
    const { database } = createHostedDatabase(env);
    handler = createRuntimeApp(database, env);
  }
  return handler(context.request);
}

export default onRequest;
