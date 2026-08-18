# Echoes Studio 运行说明

Echoes Studio 只有一个模块化后端和一个逻辑数据库。不同运行平台与数据库只是部署适配器，不是不同版本的产品。

## 内容同步与产品 CI/CD

文章同步由正在运行的 Studio 主动完成，不需要在每个内容仓库中安装 workflow。

| 流程        | 触发方式                                        | 结果                                                                                |
| ----------- | ----------------------------------------------- | ----------------------------------------------------------------------------------- |
| 拉取与对账  | Studio 定时任务，或登录后点击「拉取仓库」       | 比较 Git commit 与数据库游标，导入 Markdown / MDX 变化，并确认已完成的发布          |
| 发布文章    | 用户推送已经保存到 CMS 的改动                   | 对照共同基线检查目标文章，在最新默认分支 HEAD 上创建 commit，再以非强推方式更新 Ref |
| 部署 Studio | Echoes Studio 代码提交，或受保护的手动 workflow | 测试、构建、按需迁移数据库，并部署 Studio 本身                                      |

内容仓库中不保存 Studio Action、回调 workflow、Studio Token 或部署凭证。初始化页录入的 GitHub Token 只存在于 Studio 服务端。

## 对账流程

1. 定时任务或手动拉取要求 Studio 检查当前配置的仓库、分支和文章目录。
2. Studio 读取分支 HEAD 和文章内容；使用 GitHub App 时，会先获取短期 installation token。
3. 导入成功后才推进数据库游标；同一个 Git commit 重复拉取不会重复写入。
4. Git 和 CMS 都从共同基线修改了同一篇文章时，Studio 保存 Base / Git / CMS 三份内容并阻止推送。
5. 如果 Git 只修改了其他文件，Studio 会在最新 HEAD 上创建文章 commit，再以 compare-and-swap 方式推进默认分支。
6. 冲突处理可以采用仓库版本、采用 CMS 版本或手动合并；采用 CMS 或合并结果时，提交前会再次检查远端文章。

内部维护接口为 `POST /api/internal/reconcile`：

- 添加 `?scheduled=true` 时，按照数据库中保存的自动拉取周期判断是否到期。
- 不添加时立即执行。
- 网络调用需要 `Authorization: Bearer <内部令牌>`。令牌在首次初始化时自动生成，可从「系统设置 → 自动化」显示或重新生成；也可由高级环境变量 `CMS_INTERNAL_TOKEN` 覆盖。
- 调度器应避免同一时间并发执行多个请求。

Cloudflare Worker 直接调用内部 `scheduled()`，所以这条定时路径不需要把 `CMS_INTERNAL_TOKEN` 发送到网络。Vercel 和 EdgeOne 可以用平台定时函数或其他受信任调度器发送 heartbeat。

## 安全边界

- 登录密码由用户在首次初始化页面创建；安装密钥和内部令牌由服务端随机生成。
- GitHub App 或 fine-grained token 只授权明确需要管理的内容仓库。
- 默认直推需要 Contents 读写权限；Metadata 只读由 GitHub 自动授予。只有启用 PR 发布时才需要 Pull requests 读写权限。
- 设置页录入的 GitHub Token 使用安装密钥通过 AES-GCM 加密后保存在数据库中。
- 需要让数据库密文与加密密钥分开存放时，可在部署平台设置 `CMS_SESSION_SECRET` 覆盖自动生成的安装密钥。
- Studio 不执行 force push。分支 Ref 在发布期间被其他提交推进时，本次发布失败，拉取后重新判断。
- 线上部署由 GitHub Action 按 `DATABASE_DRIVER` 执行迁移，后端运行时使用 `CMS_DATABASE_MIGRATE=false`，避免每次冷启动重复迁移。升级前仍应备份数据库。

## 运行平台与数据库

- [`cloudflare`](../deploy/cloudflare)：Workers Assets + Worker API + 原生 Cron Trigger；可使用 D1，或通过 Hyperdrive 使用 Supabase / PostgreSQL。
- [`vercel`](../deploy/vercel)：Vercel Build Output + Node Function，可连接 Supabase / PostgreSQL。
- [`edgeone`](../deploy/edgeone)：EdgeOne 静态资源 + Node Cloud Function，可连接 Supabase / PostgreSQL。

运行平台由 `DEPLOY_PLATFORM` 选择，数据库由 `DATABASE_DRIVER` 独立选择。D1 只允许搭配 Cloudflare；Cloudflare 连接外部 PostgreSQL 时由 Action 自动配置 Hyperdrive。Action 可以创建平台项目、D1 和 Hyperdrive 配置，但不会替用户创建付费账号、平台 Token、Supabase 项目或域名。
