import type { DatabasePort } from "../core/database-port.ts";
import type { RuntimeEnv } from "./env.ts";
import { requireEnv } from "./env.ts";
import {
  createPostgresJsDatabase,
  type HostedPostgresDriver,
} from "./postgres-database.ts";

export interface HostedDatabaseHandle {
  database: DatabasePort;
  close(): Promise<void>;
}

/**
 * Database factory for hosted Node runtimes. EdgeOne and Vercel only support
 * PostgreSQL-compatible databases, so this entry intentionally has no SQLite
 * dependency for their secondary function bundlers to discover.
 */
export function createHostedDatabase(
  env: RuntimeEnv,
): HostedDatabaseHandle {
  const driver = (env.CMS_DATABASE_DRIVER ?? "supabase")
    .trim()
    .toLocaleLowerCase();
  if (driver !== "postgres" && driver !== "supabase") {
    throw new Error(
      `Hosted runtimes require CMS_DATABASE_DRIVER=postgres or supabase; received: ${driver}`,
    );
  }

  const handle = createPostgresJsDatabase(
    driver as HostedPostgresDriver,
    requireEnv(env, "CMS_DATABASE_URL"),
    {
      max: Number(env.CMS_DATABASE_POOL_SIZE ?? 5),
      idleTimeout: Number(env.CMS_DATABASE_IDLE_SECONDS ?? 20),
      connectTimeout: Number(env.CMS_DATABASE_CONNECT_SECONDS ?? 15),
    },
  );
  return { database: handle.database, close: handle.close };
}
