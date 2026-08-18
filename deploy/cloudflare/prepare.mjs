import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";

const projectName = process.env.CMS_PROJECT_NAME || "echoes-studio";
const databaseDriver = (process.env.DATABASE_DRIVER || "d1").toLowerCase();

if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectName)) {
  throw new Error(
    "PROJECT_NAME 只能包含小写字母、数字和连字符，且不能以连字符开头或结尾",
  );
}
if (!["d1", "supabase", "postgres"].includes(databaseDriver)) {
  throw new Error(`Cloudflare 不支持数据库驱动：${databaseDriver}`);
}

function wrangler(args, options = {}) {
  return execFileSync("npx", ["--yes", "wrangler@4.114.0", ...args], {
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "inherit"] : "inherit",
  });
}

function listDatabases() {
  const output = wrangler(["d1", "list", "--json"], { capture: true });
  const databases = JSON.parse(output);
  if (!Array.isArray(databases)) {
    throw new Error("Wrangler 返回了无法识别的 D1 列表");
  }
  return databases;
}

function provisionD1() {
  let database = listDatabases().find(
    (candidate) => candidate.name === projectName,
  );
  if (!database) {
    console.log(`正在创建 D1 数据库：${projectName}`);
    try {
      wrangler(["d1", "create", projectName]);
    } catch {
      // 另一个并发任务可能已经创建成功；重新读取列表后再决定是否失败。
    }
    database = listDatabases().find(
      (candidate) => candidate.name === projectName,
    );
  }

  const databaseId = database?.uuid ?? database?.id;
  if (typeof databaseId !== "string" || databaseId.length === 0) {
    throw new Error(`无法创建或找到 D1 数据库：${projectName}`);
  }
  console.log(`D1 已就绪：${projectName} (${databaseId})`);
  return `[[d1_databases]]
binding = "CMS_DB"
database_name = ${JSON.stringify(projectName)}
database_id = ${JSON.stringify(databaseId)}
migrations_dir = "../migrations/d1"`;
}

function parsePostgresOrigin(connectionString) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("DATABASE_URL 不是有效的 PostgreSQL 连接地址");
  }
  const protocol = url.protocol.replace(/:$/, "");
  if (protocol !== "postgres" && protocol !== "postgresql") {
    throw new Error(
      "Cloudflare Hyperdrive 的 DATABASE_URL 必须以 postgres:// 或 postgresql:// 开头",
    );
  }
  const database = decodeURIComponent(url.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(url.username);
  const password = decodeURIComponent(url.password);
  if (!url.hostname || !database || !user || !password) {
    throw new Error("DATABASE_URL 必须包含主机、数据库名、用户名和密码");
  }
  const requestedSslMode = url.searchParams.get("sslmode");
  const sslmode = ["require", "verify-ca", "verify-full"].includes(
    requestedSslMode ?? "",
  )
    ? requestedSslMode
    : "require";
  return {
    origin: {
      scheme: protocol,
      host: url.hostname,
      port: Number(url.port || 5432),
      database,
      user,
      password,
    },
    mtls: { sslmode },
  };
}

async function cloudflareApi(path, init = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId) throw new Error("缺少 CLOUDFLARE_ACCOUNT_ID");
  if (!apiToken) throw new Error("缺少 CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${path}`,
    {
      ...init,
      headers: {
        authorization: `Bearer ${apiToken}`,
        "content-type": "application/json",
        ...init.headers,
      },
    },
  );
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.success) {
    const message =
      payload?.errors?.map((error) => error.message).join("；") ||
      `HTTP ${response.status}`;
    throw new Error(`Cloudflare API 请求失败：${message}`);
  }
  return payload;
}

async function findHyperdrive(name) {
  for (let page = 1; page <= 100; page += 1) {
    const payload = await cloudflareApi(
      `/hyperdrive/configs?page=${page}&per_page=100`,
    );
    const match = payload.result?.find((candidate) => candidate.name === name);
    if (match) return match;
    const info = payload.result_info;
    if (!info || page * info.per_page >= info.total_count) return null;
  }
  throw new Error("Hyperdrive 配置过多，无法在分页范围内完成查找");
}

async function provisionHyperdrive() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString)
    throw new Error("Cloudflare 使用 PostgreSQL/Supabase 时需要 DATABASE_URL");
  const name = `${projectName.slice(0, 48)}-postgres`;
  const connection = parsePostgresOrigin(connectionString);
  const existing = await findHyperdrive(name);
  const body = JSON.stringify({
    name,
    ...connection,
    caching: { disabled: true },
  });
  const payload = existing
    ? await cloudflareApi(`/hyperdrive/configs/${existing.id}`, {
        method: "PUT",
        body,
      })
    : await cloudflareApi("/hyperdrive/configs", { method: "POST", body });
  const hyperdrive = payload.result;
  if (!hyperdrive?.id) throw new Error(`无法创建或更新 Hyperdrive：${name}`);
  console.log(`Hyperdrive 已就绪：${name} (${hyperdrive.id})`);
  return `[[hyperdrive]]
binding = "HYPERDRIVE"
id = ${JSON.stringify(hyperdrive.id)}`;
}

const resourceConfig =
  databaseDriver === "d1" ? provisionD1() : await provisionHyperdrive();

const config = `name = ${JSON.stringify(projectName)}
main = "./server/cloudflare-worker.mjs"
compatibility_date = "2026-08-18"
compatibility_flags = ["nodejs_compat"]

[vars]
CMS_DATABASE_DRIVER = ${JSON.stringify(databaseDriver)}
CMS_DATABASE_MIGRATE = "false"

[triggers]
crons = ["* * * * *"]

[assets]
directory = "./public"
binding = "ASSETS"
not_found_handling = "single-page-application"
run_worker_first = ["/api/*"]

${resourceConfig}
`;

await mkdir(".output", { recursive: true });
await writeFile(".output/wrangler.toml", config);
console.log(`Cloudflare 部署配置已生成：${databaseDriver}`);
