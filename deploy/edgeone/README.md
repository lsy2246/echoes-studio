# EdgeOne Makers + Supabase

EdgeOne 支持 Supabase / PostgreSQL；D1 只支持 Cloudflare Worker，不提供跨平台的 D1 HTTP 网关。

## 最少配置

在 GitHub 仓库的 `Settings → Secrets and variables → Actions` 中添加：

| 类型     | 名称              | 配置                                             |
| -------- | ----------------- | ------------------------------------------------ |
| Secret   | `DEPLOY_TOKEN`    | EdgeOne Makers 控制台创建的 API Token            |
| Secret   | `DATABASE_URL`    | Supabase `Connect` 中的 pooled connection string |
| Variable | `DEPLOY_PLATFORM` | `edgeone`                                        |
| Variable | `DATABASE_DRIVER` | `supabase`；普通 PostgreSQL 可填 `postgres`      |
| Variable | `PROJECT_NAME`    | 可选；不填就是 `echoes-studio`                   |

然后运行 `部署 Echoes Studio` Action，平台选择 EdgeOne，数据库选择 Supabase。

Action 会构建应用、迁移数据库、关联或创建 Makers 项目，并通过 EdgeOne CLI 写入数据库驱动和连接地址。无需再到 EdgeOne 环境变量页面复制数据库地址；登录密码和博客仓库在首次打开 Studio 时设置。

数据库地址作为 GitHub Secret 保存，不会写入仓库或浏览器。EdgeOne 的单变量 500 字节限制仍然存在，但标准 Supabase pooled connection string 远小于此限制。

## 手动部署（可选）

如果不用 Action，执行：

```bash
pnpm check
DEPLOY_PLATFORM=edgeone DATABASE_DRIVER=supabase DATABASE_URL="$DATABASE_URL" pnpm build
CMS_DATABASE_DRIVER=supabase CMS_DATABASE_URL="$DATABASE_URL" pnpm db:migrate
node deploy/edgeone/prepare.mjs
cd .output/edgeone-bundle
npx --yes edgeone@1.6.18 makers deploy . -n echoes-studio -t "$DEPLOY_TOKEN" -e production
```

`DATABASE_URL` 只会注入服务端 Cloud Function 构建产物，不会进入前端静态资源或 Git 仓库。这样不依赖 EdgeOne 控制台的单变量长度限制；线上连接仍由 GitHub Secret 管理。

[EdgeOne CLI](https://pages.edgeone.ai/zh/document/edgeone-cli) · [Supabase 数据库连接](https://supabase.com/docs/guides/database/connecting-to-postgres)
