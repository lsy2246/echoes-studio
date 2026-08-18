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

Action 会构建应用、迁移数据库、关联或创建 Makers 项目，并把数据库驱动与连接地址只注入服务端 Cloud Function 构建产物。无需再到 EdgeOne 环境变量页面复制数据库地址；登录密码和博客仓库在首次打开 Studio 时设置。

数据库地址作为 GitHub Secret 保存，不会写入 Git 仓库、前端静态资源或浏览器，也不受 EdgeOne 单个环境变量长度限制。

## 正式访问地址

部署成功后，EdgeOne 会提供项目域名和带 `eo_token` 的临时预览地址。临时地址只有 3 小时有效；项目域名在中国大陆网络访问时可能返回 `401 UNAUTHORIZED`。这是 EdgeOne 系统域名的访问规则，不是 Studio 登录或后端故障。

正式使用时，在 Makers 项目的「域名管理」中绑定自己的域名，并把它关联到 Production 环境。按控制台提示添加 DNS 验证和 CNAME 后，这个域名会始终指向最新一次成功部署，不需要 `eo_token`。EdgeOne 可以自动申请和续期免费 HTTPS 证书。

如果暂时没有域名，可以在项目概览点击「预览」获取新的 3 小时测试地址，先完成 Studio 初始化和功能验证。

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

[EdgeOne CLI](https://pages.edgeone.ai/zh/document/edgeone-cli) · [EdgeOne 域名说明](https://pages.edgeone.ai/document/domain-overview) · [绑定自定义域名](https://pages.edgeone.ai/document/custom-domain) · [Supabase 数据库连接](https://supabase.com/docs/guides/database/connecting-to-postgres)
