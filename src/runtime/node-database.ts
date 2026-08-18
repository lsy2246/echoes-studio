import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { DatabasePort } from "../core/database-port.ts";
import {
  createNodeSqliteDatabase,
  POSTGRES_SCHEMA_V1,
  type NodeSqliteDatabase,
} from "../database/index.ts";
import type { RuntimeEnv } from "./env.ts";
import { readBoolean, requireEnv } from "./env.ts";
import { createPostgresJsDatabase } from "./postgres-database.ts";

export interface NodeDatabaseHandle {
  database: DatabasePort;
  close(): Promise<void>;
}

export async function createNodeDatabase(
  env: RuntimeEnv,
): Promise<NodeDatabaseHandle> {
  const driver = (
    env.CMS_DATABASE_DRIVER ??
    (env.CMS_DATABASE_URL?.trim() ? "supabase" : "sqlite")
  )
    .trim()
    .toLocaleLowerCase();
  if (driver === "sqlite") {
    const filename = resolve(
      env.CMS_SQLITE_PATH?.trim() || ".data/echoes-studio.sqlite",
    );
    await mkdir(dirname(filename), { recursive: true });
    const database: NodeSqliteDatabase = await createNodeSqliteDatabase(
      filename,
      {
        migrate: readBoolean(env, "CMS_DATABASE_MIGRATE", true),
      },
    );
    return { database, close: async () => database.close() };
  }
  if (driver === "postgres" || driver === "supabase") {
    const url = requireEnv(env, "CMS_DATABASE_URL");
    const handle = createPostgresJsDatabase(driver, url, {
      max: Number(env.CMS_DATABASE_POOL_SIZE ?? 5),
      idleTimeout: Number(env.CMS_DATABASE_IDLE_SECONDS ?? 20),
      connectTimeout: Number(env.CMS_DATABASE_CONNECT_SECONDS ?? 15),
    });
    // A fresh hosted deployment should only need its database URL. The schema
    // is idempotent, and advanced operators can explicitly disable this after
    // moving migrations into their release pipeline.
    if (readBoolean(env, "CMS_DATABASE_MIGRATE", true)) {
      try {
        await handle.executeUnsafe(POSTGRES_SCHEMA_V1);
      } catch (error) {
        await handle.close();
        throw error;
      }
    }
    return handle;
  }
  throw new Error(`Unsupported CMS_DATABASE_DRIVER: ${driver}`);
}
