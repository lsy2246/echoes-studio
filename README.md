<div align="center">

# Echoes Studio

### 给 New Echoes 和其他 Markdown / MDX 博客使用的独立内容后台。

[线上部署](#线上部署) · [首次配置](#首次配置) · [日常使用](#日常使用)

</div>

Echoes Studio 连接你的博客仓库，在网页中编辑文章，并把选中的改动作为 Git commit 推送回仓库。它单独部署，不需要放进 New Echoes 或个人博客仓库，也不要求博客仓库安装 Action 或 webhook。

> [!IMPORTANT]
> Studio 会读写你在初始化页指定的仓库。GitHub Token 只发送到服务端并加密保存在数据库中，不保存在浏览器里。撤销 Token 即可停止仓库访问；删除数据库前请先备份尚未推送的文章。

## 线上部署

最省事的方式是使用仓库自带的 GitHub Action。后端平台和数据库在 GitHub 中分别选择，不再使用绑定套餐。

| 类型     | 名称               | 说明                                                 |
| -------- | ------------------ | ---------------------------------------------------- |
| Secret   | `DEPLOY_TOKEN`     | 当前运行平台的部署 Token                             |
| Secret   | `DATABASE_URL`     | PostgreSQL/Supabase 连接地址；选择 D1 时不需要       |
| Variable | `DEPLOY_PLATFORM`  | `edgeone`、`vercel` 或 `cloudflare`                  |
| Variable | `DATABASE_DRIVER`  | `supabase`、`postgres` 或 `d1`                       |
| Variable | `PLATFORM_ACCOUNT` | Cloudflare Account ID；Vercel 团队账号填写 team slug |
| Variable | `PROJECT_NAME`     | 可选，默认 `echoes-studio`                           |

支持组合如下。平台和数据库是两个独立选择，唯一的特殊规则是 D1 只能由 Cloudflare Worker 原生使用。

| 后端平台          | D1  | Supabase | PostgreSQL |
| ----------------- | :-: | :------: | :--------: |
| Cloudflare Worker | ✅  |    ✅    |     ✅     |
| Vercel            | ❌  |    ✅    |     ✅     |
| EdgeOne           | ❌  |    ✅    |     ✅     |

### 用 Action 部署

1. Fork 或复制本仓库。
2. 进入仓库 `Settings → Secrets and variables → Actions`。
3. 在 Variables 分别填写 `DEPLOY_PLATFORM` 和 `DATABASE_DRIVER`，在 Secrets 添加对应 Token 和数据库地址。
4. 进入 `Actions → 部署 Echoes Studio → Run workflow`，分别选择平台与数据库并运行第一次部署。

之后每次更新 `main` 分支都会按这两个 Variable 自动部署。只想手动部署时可以不填写它们，每次在 Action 中选择即可。

Action 会自动完成：

- 安装依赖、检查代码并构建；
- 按 `DATABASE_DRIVER` 初始化或升级数据库；
- 把数据库驱动和连接地址安全注入后端；
- Cloudflare + D1 自动查找或创建数据库，不再复制 `database_id`；
- Cloudflare + Supabase/PostgreSQL 自动创建或更新 Hyperdrive，不再复制 Hyperdrive ID；
- 项目不存在时由平台 CLI 创建，存在时直接更新。

除了平台部署 Token 和数据库连接地址，不需要提前配置登录密码、GitHub Token、安装密钥或内部令牌。它们都在部署完成后的初始化页面设置或自动生成。

部署 Token 的来源：

- EdgeOne：Makers 控制台的 API Token。
- Vercel：Account Settings 中的 Token。
- Cloudflare：API Tokens 中创建部署 Token。选择 D1 时授予 Workers + D1 权限；选择 Supabase/PostgreSQL 时授予 Workers + Hyperdrive 权限。

详细说明： [EdgeOne](./deploy/edgeone/README.md) · [Vercel](./deploy/vercel/README.md) · [Cloudflare](./deploy/cloudflare/README.md)

### 数据库选择

EdgeOne 和 Vercel 使用 Supabase 的 pooled Postgres connection string。Cloudflare + Supabase 根据官方建议使用 Direct connection string，由 Action 自动配置 Hyperdrive；Cloudflare + D1 不需要数据库地址。数据库配置只存在于 GitHub Secret、平台运行时和数据库本身，不进入 Studio 的业务设置页面。

所有 PostgreSQL/Supabase 组合共用同一个数据库端口；Cloudflare 额外提供 D1 和 Hyperdrive 运行时适配。迁移平台时，前端和业务代码不需要更换。

## 首次配置

部署完成后第一次打开 Studio，会看到一次性初始化页面。

### 1. 完成一次性初始化

只需要填写：

| 设置         | 示例                               |
| ------------ | ---------------------------------- |
| 登录密码     | 你自己记得住的后台密码             |
| GitHub 仓库  | `https://github.com/you/your-blog` |
| GitHub Token | `github_pat_...`                   |

Studio 自动完成：

- 从仓库地址识别所有者和仓库名；
- 读取仓库默认分支；
- 默认使用 `src/content`，需要时可在高级选项中修改；
- 生成安装密钥和内部调度令牌；
- 对登录密码执行加盐哈希后存入数据库。

推荐使用 fine-grained personal access token：

1. Repository access 只选择博客仓库。
2. Repository permissions 开启 `Contents: Read and write`。
3. Metadata 保持 GitHub 自动授予的只读权限。

初始化后 Token 会由服务端加密写入 Supabase 或 D1，以后打开设置页不会回显。

### 2. 拉取文章

点击左下角「拉取仓库」。Studio 会读取文章目录中的 `.md` 和 `.mdx`，并保留原有目录层级。

### 3. 调整自动化

进入「系统设置 → 自动化」：

- 自动保存：停止输入后多久写入数据库。
- 自动拉取：仅手动，或每 5 / 15 / 30 / 60 分钟检查仓库。

Cloudflare preset 已包含 Cron Trigger。EdgeOne 和 Vercel 的普通部署默认使用手动拉取；需要无人值守自动拉取时，再按对应部署文档配置平台调度器。这是可选的高级功能，不影响编辑和推送。

高级调度接口为：

```http
POST /api/internal/reconcile?scheduled=true
Authorization: Bearer <系统设置中显示的外部调度令牌>
```

## 日常使用

```text
拉取仓库 → 编辑文章 → 自动保存到数据库
         → 选择待同步文章 → 填写 commit message → 推送
```

- 自动保存不会修改 GitHub 仓库。
- 「推送当前」只推送当前文章。
- 「批量推送」可选择多篇文章，并生成一个 Git commit。
- 移动和删除先记录为待同步，推送后才修改仓库。
- 如果仓库和 Studio 同时修改了同一篇文章，推送会停止并要求处理冲突。
- 其他文章或配置文件产生的新 commit 不会误判为当前文章冲突。

GitHub 推送成功后，博客仓库原有的 CI/CD 会自行构建网站。Studio 不参与博客的构建流程。

## 更多文档

- [EdgeOne + Supabase 部署](./deploy/edgeone/README.md)
- [Vercel + Supabase 部署](./deploy/vercel/README.md)
- [Cloudflare Workers + D1 / Supabase / PostgreSQL 部署](./deploy/cloudflare/README.md)
- [本地运行、同步机制与安全边界](./docs/README.md)
- [可选高级环境变量](./examples/env.production.example)

## 许可证

当前仓库尚未包含 `LICENSE` 文件。
