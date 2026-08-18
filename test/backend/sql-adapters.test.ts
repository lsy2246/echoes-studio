import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";

import { createD1Database, type D1DatabaseLike } from "../../src/database/d1";
import {
  createPostgresDatabase,
  createSupabaseDatabase,
  type PostgresClientLike,
  type PostgresQueryResult,
} from "../../src/database/postgres";
import { SQLITE_D1_SCHEMA_V1 } from "../../src/database/schema";

function makeD1Binding(connection: DatabaseSync): D1DatabaseLike {
  return {
    prepare(sql) {
      let parameters: unknown[] = [];
      return {
        bind(...values: unknown[]) {
          parameters = values;
          return this;
        },
        async all<T>() {
          return { results: connection.prepare(sql).all(...(parameters as never[])) as T[] };
        },
        async run() {
          const result = connection.prepare(sql).run(...(parameters as never[]));
          return { success: true, meta: { changes: Number(result.changes) } };
        },
      };
    },
  };
}

class FakePostgresClient implements PostgresClientLike {
  constructor(private readonly connection: DatabaseSync) {}

  async query<Row extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    parameters: unknown[] = [],
  ): Promise<PostgresQueryResult<Row>> {
    if (/^(?:BEGIN|COMMIT|ROLLBACK)$/i.test(sql.trim())) {
      this.connection.exec(sql);
      return { rows: [], rowCount: 0 };
    }
    const portableSql = sql.replace(/\$\d+/g, "?");
    if (/^\s*(?:SELECT|WITH)\b/i.test(portableSql)) {
      return {
        rows: this.connection.prepare(portableSql).all(...(parameters as never[])) as Row[],
        rowCount: 0,
      };
    }
    const result = this.connection.prepare(portableSql).run(...(parameters as never[]));
    return { rows: [], rowCount: Number(result.changes) };
  }

  async connect(): Promise<PostgresClientLike & { release(): void }> {
    return Object.assign(this, { release() {} });
  }
}

describe("portable SQL adapters", () => {
  const d1Connection = new DatabaseSync(":memory:");
  d1Connection.exec(SQLITE_D1_SCHEMA_V1);
  const postgresConnection = new DatabaseSync(":memory:");
  postgresConnection.exec(SQLITE_D1_SCHEMA_V1);
  after(() => {
    d1Connection.close();
    postgresConnection.close();
  });

  it("operates through a Cloudflare D1-compatible binding", async () => {
    const database = createD1Database(makeD1Binding(d1Connection));
    assert.equal((await database.health()).adapter, "cloudflare-d1");
    const article = await database.createArticle({
      id: "d1-article",
      path: "content/d1.md",
      format: "md",
      title: "D1",
      frontmatter: { title: "D1" },
      source: "D1",
      contentHash: "d1-hash",
      now: "2026-08-13T00:00:00.000Z",
    });
    assert.equal((await database.getArticle(article.id))?.title, "D1");
  });

  it("operates through Postgres and Supabase-compatible clients", async () => {
    const client = new FakePostgresClient(postgresConnection);
    const database = createPostgresDatabase(client);
    assert.equal((await database.health()).adapter, "postgres");
    await database.createArticle({
      id: "postgres-article",
      path: "content/postgres.md",
      format: "md",
      title: "Postgres",
      frontmatter: { title: "Postgres" },
      source: "Postgres",
      contentHash: "postgres-hash",
      now: "2026-08-13T00:00:00.000Z",
    });
    assert.equal((await database.listArticles({ limit: 10 })).items.length, 1);
    assert.equal(createSupabaseDatabase(client).adapterName, "supabase-postgres");
  });
});
