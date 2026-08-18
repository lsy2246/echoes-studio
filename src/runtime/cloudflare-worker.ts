import type { DatabasePort } from "../core/database-port.ts";
import { createD1Database, type D1DatabaseLike } from "../database/index.ts";
import { createRuntimeApp } from "./create-runtime-app.ts";
import type { RuntimeEnv } from "./env.ts";
import { createPostgresJsDatabase } from "./postgres-database.ts";

export interface HyperdriveBindingLike {
  connectionString: string;
}

export interface CloudflareEnv {
  CMS_DATABASE_DRIVER?: string;
  CMS_DB?: D1DatabaseLike;
  HYPERDRIVE?: HyperdriveBindingLike;
  [name: string]: string | D1DatabaseLike | HyperdriveBindingLike | undefined;
}

interface CloudflareExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

function runtimeEnv(env: CloudflareEnv): RuntimeEnv {
  return Object.fromEntries(
    Object.entries(env).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string",
    ),
  );
}

export function createCloudflareDatabase(env: CloudflareEnv): DatabasePort {
  const driver = (env.CMS_DATABASE_DRIVER ?? (env.CMS_DB ? "d1" : ""))
    .trim()
    .toLocaleLowerCase();
  if (driver === "d1") {
    if (!env.CMS_DB) throw new Error("Cloudflare D1 缺少 CMS_DB binding");
    return createD1Database(env.CMS_DB);
  }
  if (driver === "supabase" || driver === "postgres") {
    const connectionString = env.HYPERDRIVE?.connectionString?.trim();
    if (!connectionString) {
      throw new Error("Cloudflare PostgreSQL 缺少 HYPERDRIVE binding");
    }
    return createPostgresJsDatabase(driver, connectionString, { max: 1 })
      .database;
  }
  throw new Error(`Cloudflare 不支持数据库驱动：${driver || "未配置"}`);
}

async function reconcile(env: CloudflareEnv): Promise<void> {
  const stringEnv = runtimeEnv(env);
  // This handler is invoked in-process by Cloudflare, not over the public
  // network. Its private app instance can therefore bypass HTTP bearer auth.
  const app = createRuntimeApp(createCloudflareDatabase(env), {
    ...stringEnv,
    CMS_ALLOW_UNAUTHENTICATED: "true",
  });
  const response = await app(
    new Request(
      "https://echoes-studio.internal/api/internal/reconcile?scheduled=true",
      {
        method: "POST",
      },
    ),
  );
  if (!response.ok) {
    throw new Error(
      `Scheduled repository reconciliation failed (${response.status}): ${await response.text()}`,
    );
  }
}

export default {
  fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    return createRuntimeApp(
      createCloudflareDatabase(env),
      runtimeEnv(env),
    )(request);
  },

  scheduled(
    _controller: unknown,
    env: CloudflareEnv,
    context: CloudflareExecutionContext,
  ): void {
    context.waitUntil(reconcile(env));
  },
};
