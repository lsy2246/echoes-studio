import { appendFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { parse } from "yaml";

const PLATFORMS = new Set(["cloudflare", "vercel", "edgeone"]);
const DATABASES = new Set(["d1", "supabase", "postgres"]);
const ROOT_KEYS = new Set([
  "platform",
  "database",
  "projectName",
  "cloudflare",
  "vercel",
  "edgeone",
]);

function object(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null)) return {};
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} 必须是 YAML 对象`);
  }
  return value;
}

function string(value, label, { optional = false } = {}) {
  if (optional && (value === undefined || value === null || value === "")) {
    return "";
  }
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${label} 必须是非空字符串`);
  }
  const normalized = value.trim();
  if (/[\r\n]/.test(normalized)) {
    throw new Error(`${label} 不能包含换行`);
  }
  return normalized;
}

function exactKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new Error(`${label} 包含未知字段：${key}`);
  }
}

export function resolveDeployConfig(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    throw new Error("缺少 GitHub Variable：DEPLOY_CONFIG");
  }

  let parsed;
  try {
    parsed = parse(raw);
  } catch (error) {
    throw new Error(`DEPLOY_CONFIG 不是有效的 YAML：${error.message}`);
  }
  const config = object(parsed, "DEPLOY_CONFIG");
  exactKeys(config, ROOT_KEYS, "DEPLOY_CONFIG");

  const platform = string(config.platform, "DEPLOY_CONFIG.platform");
  const database = string(config.database, "DEPLOY_CONFIG.database");
  const projectName = string(
    config.projectName ?? "echoes-studio",
    "DEPLOY_CONFIG.projectName",
  );
  if (!PLATFORMS.has(platform)) {
    throw new Error(
      "DEPLOY_CONFIG.platform 只能填写 cloudflare、vercel 或 edgeone",
    );
  }
  if (!DATABASES.has(database)) {
    throw new Error("DEPLOY_CONFIG.database 只能填写 d1、supabase 或 postgres");
  }
  if (database === "d1" && platform !== "cloudflare") {
    throw new Error("D1 只能搭配 Cloudflare Worker");
  }
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(projectName)) {
    throw new Error(
      "DEPLOY_CONFIG.projectName 只能包含小写字母、数字和连字符，且不能以连字符开头或结尾",
    );
  }

  const cloudflare = object(config.cloudflare, "DEPLOY_CONFIG.cloudflare", {
    optional: true,
  });
  const vercel = object(config.vercel, "DEPLOY_CONFIG.vercel", {
    optional: true,
  });
  const edgeone = object(config.edgeone, "DEPLOY_CONFIG.edgeone", {
    optional: true,
  });
  exactKeys(cloudflare, new Set(["accountId"]), "DEPLOY_CONFIG.cloudflare");
  exactKeys(vercel, new Set(["team"]), "DEPLOY_CONFIG.vercel");
  exactKeys(edgeone, new Set(["area"]), "DEPLOY_CONFIG.edgeone");

  const cloudflareAccountId =
    platform === "cloudflare"
      ? string(cloudflare.accountId, "DEPLOY_CONFIG.cloudflare.accountId")
      : "";
  if (cloudflareAccountId && !/^[a-f0-9]{32}$/i.test(cloudflareAccountId)) {
    throw new Error(
      "DEPLOY_CONFIG.cloudflare.accountId 应为 Cloudflare 控制台显示的 32 位 Account ID",
    );
  }
  const vercelScope =
    platform === "vercel"
      ? string(vercel.team, "DEPLOY_CONFIG.vercel.team", { optional: true })
      : "";
  const edgeoneArea =
    platform === "edgeone"
      ? string(edgeone.area ?? "overseas", "DEPLOY_CONFIG.edgeone.area")
      : "overseas";
  if (!new Set(["overseas", "global"]).has(edgeoneArea)) {
    throw new Error("DEPLOY_CONFIG.edgeone.area 只能填写 overseas 或 global");
  }

  return {
    platform,
    database,
    projectName,
    cloudflareAccountId,
    vercelScope,
    edgeoneArea,
  };
}

async function main() {
  const config = resolveDeployConfig(process.env.DEPLOY_CONFIG);
  const lines = [
    `DEPLOY_PLATFORM=${config.platform}`,
    `DATABASE_DRIVER=${config.database}`,
    `CMS_PROJECT_NAME=${config.projectName}`,
    `CLOUDFLARE_ACCOUNT_ID=${config.cloudflareAccountId}`,
    `VERCEL_SCOPE=${config.vercelScope}`,
    `CMS_EDGEONE_AREA=${config.edgeoneArea}`,
  ];
  if (process.env.GITHUB_ENV) {
    await appendFile(process.env.GITHUB_ENV, `${lines.join("\n")}\n`);
  }
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `platform=${config.platform}\ndatabase=${config.database}\n`,
    );
  }
  if (process.env.GITHUB_ENV || process.env.GITHUB_OUTPUT) {
    return;
  }
  process.stdout.write(`${lines.join("\n")}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
