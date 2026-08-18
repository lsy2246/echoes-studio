import { SqlDatabase, type SqlExecutor, type SqlRunResult } from "./sql";
import { SQLITE_D1_SCHEMA_V1 } from "./schema";

interface SqliteStatement {
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  };
}

interface SqliteConnection {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  close(): void;
}

class NodeSqliteExecutor implements SqlExecutor {
  constructor(private readonly connection: SqliteConnection) {}

  async all<T extends Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<T[]> {
    return this.connection.prepare(sql).all(...parameters) as T[];
  }

  async run(sql: string, parameters: unknown[] = []): Promise<SqlRunResult> {
    const result = this.connection.prepare(sql).run(...parameters);
    return {
      changes: Number(result.changes),
      lastInsertId:
        typeof result.lastInsertRowid === "bigint"
          ? result.lastInsertRowid.toString()
          : result.lastInsertRowid,
    };
  }

  async withTransaction<T>(
    operation: (executor: SqlExecutor) => Promise<T>,
  ): Promise<T> {
    this.connection.exec("BEGIN IMMEDIATE");
    try {
      const result = await operation(this);
      this.connection.exec("COMMIT");
      return result;
    } catch (error) {
      this.connection.exec("ROLLBACK");
      throw error;
    }
  }
}

export interface NodeSqliteDatabase extends SqlDatabase {
  close(): void;
}

/** Uses Node 22.5+ built-in node:sqlite; no native npm dependency is required. */
export async function createNodeSqliteDatabase(
  filename = "cms.sqlite",
  options: { migrate?: boolean } = {},
): Promise<NodeSqliteDatabase> {
  const sqlite = (await import("node:sqlite")) as unknown as {
    DatabaseSync: new (filename: string) => SqliteConnection;
  };
  const connection = new sqlite.DatabaseSync(filename);
  if (options.migrate !== false) {
    connection.exec(SQLITE_D1_SCHEMA_V1);
    const draftColumns = connection
      .prepare("PRAGMA table_info(cms_drafts)")
      .all() as Array<{ name?: unknown }>;
    if (!draftColumns.some((column) => column.name === "base_path")) {
      connection.exec("ALTER TABLE cms_drafts ADD COLUMN base_path TEXT");
    }
    if (!draftColumns.some((column) => column.name === "base_source")) {
      connection.exec("ALTER TABLE cms_drafts ADD COLUMN base_source TEXT");
    }
    if (!draftColumns.some((column) => column.name === "operation")) {
      connection.exec(
        "ALTER TABLE cms_drafts ADD COLUMN operation TEXT NOT NULL DEFAULT 'upsert' CHECK (operation IN ('upsert', 'delete'))",
      );
    }
    const systemColumns = connection
      .prepare("PRAGMA table_info(cms_system_settings)")
      .all() as Array<{ name?: unknown }>;
    if (
      !systemColumns.some((column) => column.name === "installation_secret")
    ) {
      connection.exec(
        "ALTER TABLE cms_system_settings ADD COLUMN installation_secret TEXT",
      );
    }
    if (!systemColumns.some((column) => column.name === "internal_token")) {
      connection.exec(
        "ALTER TABLE cms_system_settings ADD COLUMN internal_token TEXT",
      );
    }
    connection.exec(
      "INSERT INTO cms_schema_version(version, applied_at) VALUES (9, CURRENT_TIMESTAMP) ON CONFLICT(version) DO NOTHING",
    );
  }
  const database = new SqlDatabase(
    new NodeSqliteExecutor(connection),
    "node-sqlite",
  ) as NodeSqliteDatabase;
  database.close = () => connection.close();
  return database;
}
