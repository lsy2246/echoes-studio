import { SqlDatabase, type SqlExecutor, type SqlRunResult } from "./sql";

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): D1PreparedStatementLike;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[]; success?: boolean }>;
  run(): Promise<{ success?: boolean; meta?: { changes?: number } }>;
}

export interface D1DatabaseLike {
  prepare(sql: string): D1PreparedStatementLike;
}

class D1Executor implements SqlExecutor {
  constructor(private readonly binding: D1DatabaseLike) {}

  async all<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    const result = await this.binding.prepare(sql).bind(...parameters).all<T>();
    return result.results ?? [];
  }

  async run(sql: string, parameters: unknown[] = []): Promise<SqlRunResult> {
    const result = await this.binding.prepare(sql).bind(...parameters).run();
    return { changes: Number(result.meta?.changes ?? 0) };
  }

  async withTransaction<T>(operation: (executor: SqlExecutor) => Promise<T>): Promise<T> {
    // D1 does not expose interactive transactions to Workers. Every mutation
    // still uses atomic compare-and-swap statements and idempotency keys. D1
    // batch migrations are supplied separately under migrations/d1.
    return operation(this);
  }
}

export function createD1Database(binding: D1DatabaseLike): SqlDatabase {
  return new SqlDatabase(new D1Executor(binding), "cloudflare-d1");
}
