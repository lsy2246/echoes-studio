# Vercel + Supabase

Vercel 支持 Supabase / PostgreSQL；D1 只支持 Cloudflare Worker，不提供跨平台的 D1 HTTP 网关。

## 最少配置

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中添加：

| 类型     | 名称               | 从哪里获取                                       |
| -------- | ------------------ | ------------------------------------------------ |
| Secret   | `DEPLOY_TOKEN`     | Vercel Account Settings 中创建的 Token           |
| Secret   | `DATABASE_URL`     | Supabase `Connect` 中的 pooled connection string |
| Variable | `DEPLOY_PLATFORM`  | `vercel`                                         |
| Variable | `DATABASE_DRIVER`  | `supabase`；普通 PostgreSQL 可填 `postgres`      |
| Variable | `PROJECT_NAME`     | 可选；不填就是 `echoes-studio`                   |
| Variable | `PLATFORM_ACCOUNT` | 仅团队账号需要，填写 Vercel team slug            |

然后运行 `部署 Echoes Studio` Action，平台选择 Vercel，数据库选择 Supabase。

Action 会自动迁移 Supabase、关联或创建 Vercel 项目，并把数据库地址作为运行时变量注入部署。无需复制 `VERCEL_ORG_ID`、`VERCEL_PROJECT_ID`，也无需在 Vercel 控制台重复填写环境变量。

## 手动部署（可选）

```bash
pnpm check
CMS_DATABASE_DRIVER=supabase CMS_DATABASE_URL="$DATABASE_URL" pnpm db:migrate
node deploy/vercel/prepare.mjs
npx --yes vercel@56.5.0 link --yes --project echoes-studio --token "$DEPLOY_TOKEN"
npx --yes vercel@56.5.0 deploy --prebuilt --prod --yes \
  --env "CMS_DATABASE_DRIVER=supabase" \
  --env "CMS_DATABASE_URL=$DATABASE_URL" \
  --env "CMS_DATABASE_MIGRATE=false" \
  --token "$DEPLOY_TOKEN"
```

[Vercel CLI 项目关联](https://vercel.com/docs/cli/link) · [Supabase 数据库连接](https://supabase.com/docs/guides/database/connecting-to-postgres)
