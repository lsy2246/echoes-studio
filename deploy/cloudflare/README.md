# Cloudflare Workers 部署

Cloudflare Worker 可以使用原生 D1，也可以通过 Hyperdrive 连接 Supabase / PostgreSQL。用户只在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 配置下面的值，Worker 运行时变量和 Binding 都由 Action 生成。

## 使用 D1

| 类型     | 名称               | 填写内容                             |
| -------- | ------------------ | ------------------------------------ |
| Secret   | `DEPLOY_TOKEN`     | Cloudflare API Token                 |
| Variable | `DEPLOY_PLATFORM`  | `cloudflare`                         |
| Variable | `DATABASE_DRIVER`  | `d1`                                 |
| Variable | `PLATFORM_ACCOUNT` | Cloudflare Dashboard 中的 Account ID |
| Variable | `PROJECT_NAME`     | 可选；默认 `echoes-studio`           |

不需要 `DATABASE_URL`。Token 需要 Workers Scripts 编辑、D1 编辑以及读取账号资源的权限。

Action 会自动查找或创建 D1、生成 `CMS_DB` Binding、执行 migration，然后部署 Worker 和管理界面。

## 使用 Supabase / PostgreSQL

| 类型     | 名称               | 填写内容                                             |
| -------- | ------------------ | ---------------------------------------------------- |
| Secret   | `DEPLOY_TOKEN`     | Cloudflare API Token                                 |
| Secret   | `DATABASE_URL`     | PostgreSQL 连接地址；Supabase 使用 Direct connection |
| Variable | `DEPLOY_PLATFORM`  | `cloudflare`                                         |
| Variable | `DATABASE_DRIVER`  | `supabase` 或 `postgres`                             |
| Variable | `PLATFORM_ACCOUNT` | Cloudflare Dashboard 中的 Account ID                 |
| Variable | `PROJECT_NAME`     | 可选；默认 `echoes-studio`                           |

Token 需要 Workers Scripts 编辑、Hyperdrive 编辑以及读取账号资源的权限。Action 会先迁移 PostgreSQL，再按项目名自动创建或更新 Hyperdrive，并把生成的 `HYPERDRIVE` Binding 交给 Worker。用户不需要复制 Hyperdrive ID，也不需要在 Cloudflare 控制台重复填写数据库密码。

> Supabase 在 Vercel/EdgeOne 上通常使用 pooled connection string；在 Cloudflare Hyperdrive 上应使用 Supabase `Connect` 面板里的 Direct connection string，因为 Hyperdrive 自己负责连接池。

部署完成后打开站点，在一次性初始化页面设置登录密码、博客仓库和 GitHub Token。

[Hyperdrive 连接 Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) · [D1 Wrangler 命令](https://developers.cloudflare.com/d1/wrangler-commands/) · [Workers 静态资源](https://developers.cloudflare.com/workers/static-assets/)
