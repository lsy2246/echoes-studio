import postgres from "postgres";
import type { DatabasePort } from "../core/database-port.ts";
import {
  createPostgresDatabase,
  createSupabaseDatabase,
  type PostgresClientLike,
  type PostgresQueryResult,
} from "../database/index.ts";

interface PostgresJsResult extends Array<Record<string, unknown>> {
  count?: number;
}

interface PostgresJsLike {
  unsafe(query: string, parameters?: unknown[]): Promise<PostgresJsResult>;
  reserve(): Promise<PostgresJsLike & { release(): void }>;
  end?(options?: { timeout?: number }): Promise<void>;
}

class PostgresJsClient implements PostgresClientLike {
  constructor(
    private readonly sql: PostgresJsLike,
    private readonly onRelease?: () => void,
  ) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    query: string,
    parameters: unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    const result = await this.sql.unsafe(query, parameters);
    return {
      rows: [...result] as Row[],
      rowCount: result.count ?? result.length,
    };
  }

  async connect(): Promise<PostgresClientLike & { release(): void }> {
    const reserved = await this.sql.reserve();
    return new PostgresJsClient(reserved, () =>
      reserved.release(),
    ) as PostgresClientLike & { release(): void };
  }

  release(): void {
    this.onRelease?.();
  }
}

export type HostedPostgresDriver = "postgres" | "supabase";

export interface PostgresDatabaseHandle {
  database: DatabasePort;
  executeUnsafe(sql: string): Promise<void>;
  close(): Promise<void>;
}

/**
 * Creates the common PostgreSQL adapter used by Node runtimes and Cloudflare
 * Hyperdrive. The URL can be a normal PostgreSQL URL or the connection string
 * exposed by a Hyperdrive binding.
 */
export function createPostgresJsDatabase(
  driver: HostedPostgresDriver,
  connectionString: string,
  options: {
    max?: number;
    idleTimeout?: number;
    connectTimeout?: number;
  } = {},
): PostgresDatabaseHandle {
  const sql = postgres(connectionString, {
    max: options.max ?? 5,
    idle_timeout: options.idleTimeout ?? 20,
    connect_timeout: options.connectTimeout ?? 15,
    prepare: false,
  }) as unknown as PostgresJsLike;
  const client = new PostgresJsClient(sql);
  return {
    database:
      driver === "supabase"
        ? createSupabaseDatabase(client)
        : createPostgresDatabase(client),
    executeUnsafe: async (query) => {
      await sql.unsafe(query);
    },
    close: async () => sql.end?.({ timeout: 5 }),
  };
}
