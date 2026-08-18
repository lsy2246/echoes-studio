import { SqlDatabase, type SqlExecutor, type SqlRunResult } from "./sql";

export interface PostgresQueryResult<Row extends Record<string, unknown> = Record<string, unknown>> {
  rows: Row[];
  rowCount?: number | null;
}

export interface PostgresClientLike {
  query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters?: unknown[],
  ): Promise<PostgresQueryResult<Row>>;
  connect?(): Promise<PostgresClientLike & { release?: () => void }>;
  release?: () => void;
}

function postgresPlaceholders(sql: string): string {
  let position = 0;
  return sql.replace(/\?/g, () => `$${++position}`);
}

class PostgresExecutor implements SqlExecutor {
  constructor(
    private readonly client: PostgresClientLike,
    private readonly transactional = false,
  ) {}

  async all<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return (await this.client.query<T>(postgresPlaceholders(sql), parameters)).rows;
  }

  async run(sql: string, parameters: unknown[] = []): Promise<SqlRunResult> {
    const result = await this.client.query(postgresPlaceholders(sql), parameters);
    return { changes: Number(result.rowCount ?? 0) };
  }

  async withTransaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    if (this.transactional) return operation(this);
    const connection = this.client.connect ? await this.client.connect() : this.client;
    const executor = new PostgresExecutor(connection, true);
    await connection.query("BEGIN");
    try {
      const result = await operation(executor);
      await connection.query("COMMIT");
      return result;
    } catch (error) {
      await connection.query("ROLLBACK");
      throw error;
    } finally {
      connection.release?.();
    }
  }
}

/** Accepts pg/Neon-compatible clients or pools connected to Supabase Postgres. */
export function createPostgresDatabase(client: PostgresClientLike): SqlDatabase {
  return new SqlDatabase(new PostgresExecutor(client), "postgres");
}

/** Explicit alias used by Supabase deployments with a pooled Postgres client. */
export function createSupabaseDatabase(client: PostgresClientLike): SqlDatabase {
  return new SqlDatabase(new PostgresExecutor(client), "supabase-postgres");
}
