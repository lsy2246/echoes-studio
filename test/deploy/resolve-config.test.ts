import assert from "node:assert/strict";
import test from "node:test";
import { resolveDeployConfig } from "../../deploy/resolve-config.mjs";

test("resolves Cloudflare with D1", () => {
  assert.deepEqual(
    resolveDeployConfig(
      `# 只修改当前部署使用的字段
platform: cloudflare
database: d1
projectName: echoes-studio

cloudflare:
  accountId: "1234567890abcdef1234567890abcdef"

# 未使用的平台可以留空
vercel:
  team:
edgeone:
  area: overseas
`,
    ),
    {
      platform: "cloudflare",
      database: "d1",
      projectName: "echoes-studio",
      cloudflareAccountId: "1234567890abcdef1234567890abcdef",
      vercelScope: "",
      edgeoneArea: "overseas",
    },
  );
});

test("resolves optional Vercel and EdgeOne settings", () => {
  assert.deepEqual(
    resolveDeployConfig(
      `platform: vercel
database: supabase
vercel:
  team: echoes-team
`,
    ),
    {
      platform: "vercel",
      database: "supabase",
      projectName: "echoes-studio",
      cloudflareAccountId: "",
      vercelScope: "echoes-team",
      edgeoneArea: "overseas",
    },
  );
  assert.equal(
    resolveDeployConfig(
      `platform: edgeone
database: postgres
edgeone:
  area: global
`,
    ).edgeoneArea,
    "global",
  );
});

test("rejects malformed, unknown and incompatible configuration", () => {
  assert.throws(() => resolveDeployConfig("platform: ["), /不是有效的 YAML/);
  assert.throws(() => resolveDeployConfig("platform: cloudflare"), /database/);
  assert.throws(
    () => resolveDeployConfig("platform: vercel\ndatabase: d1"),
    /D1 只能搭配/,
  );
  assert.throws(
    () =>
      resolveDeployConfig(
        `platform: cloudflare
database: d1
deployToken: 不应放在 Variable 中
`,
      ),
    /未知字段：deployToken/,
  );
});
