import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  createCloudflareDatabase,
  type CloudflareEnv,
} from "../../src/runtime/cloudflare-worker";

function d1Binding(): NonNullable<CloudflareEnv["CMS_DB"]> {
  return {
    prepare() {
      return {
        bind() {
          return this;
        },
        async all() {
          return { results: [] };
        },
        async run() {
          return { success: true, meta: { changes: 0 } };
        },
      };
    },
  };
}

describe("Cloudflare database selection", () => {
  it("uses a native D1 binding only when the D1 driver is selected", () => {
    const database = createCloudflareDatabase({
      CMS_DATABASE_DRIVER: "d1",
      CMS_DB: d1Binding(),
    });
    assert.equal(database.adapterName, "cloudflare-d1");
    assert.throws(
      () => createCloudflareDatabase({ CMS_DATABASE_DRIVER: "d1" }),
      /CMS_DB binding/,
    );
  });

  for (const driver of ["supabase", "postgres"] as const) {
    it(`uses Hyperdrive for the ${driver} driver`, () => {
      const database = createCloudflareDatabase({
        CMS_DATABASE_DRIVER: driver,
        HYPERDRIVE: {
          connectionString:
            "postgres://user:password@hyperdrive.local/database",
        },
      });
      assert.equal(
        database.adapterName,
        driver === "supabase" ? "supabase-postgres" : "postgres",
      );
      assert.throws(
        () => createCloudflareDatabase({ CMS_DATABASE_DRIVER: driver }),
        /HYPERDRIVE binding/,
      );
    });
  }

  it("rejects unsupported drivers instead of silently falling back", () => {
    assert.throws(
      () => createCloudflareDatabase({ CMS_DATABASE_DRIVER: "sqlite" }),
      /不支持数据库驱动/,
    );
  });
});
