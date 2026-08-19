# Echoes Studio

在浏览器中管理 Markdown / MDX 博客，并把多篇文章的新增、修改、移动和删除合并成一次 Git commit 推回内容仓库。

[部署](#部署) · [第一次初始化](#第一次初始化) · [写作与同步](#写作与同步) · [更新](#更新-echoes-studio) · [常见问题](#常见问题)

Echoes Studio 是独立服务。它连接 GitHub 或 Gitee，数据库保存编辑内容和同步状态，Git 仓库仍然是博客的发布来源。博客仓库不需要安装 Action、webhook 或 SDK。

> [!IMPORTANT]
> 平台 Token 和数据库地址必须保存为 GitHub Secrets，不能写入配置或仓库文件。仓库 Token 只提交给 Studio 服务端，并使用安装时自动生成的密钥加密后写入数据库。

## 部署

仓库自带 GitHub Action，负责检查代码、准备数据库、执行 migration 并部署 Studio。你只需要在 Studio 仓库配置一个带注释的 YAML 和一到两个 Secret。

### 1. 选择组合

| 运行平台          | D1  | Supabase | PostgreSQL |
| ----------------- | :-: | :------: | :--------: |
| Cloudflare Worker | ✅  |    ✅    |     ✅     |
| Vercel            |  —  |    ✅    |     ✅     |
| EdgeOne           |  —  |    ✅    |     ✅     |

配置最少的是 Cloudflare Worker + D1。D1 是 Cloudflare Worker Binding，不能直接交给 Vercel 或 EdgeOne 使用；Cloudflare Worker 也可以改用 Supabase 或其他 PostgreSQL。

### 2. 添加 GitHub Variable

进入 Studio 仓库的 `Settings → Secrets and variables → Actions → Variables`，新建 `DEPLOY_CONFIG`，复制下面这一份配置。注释可以保留，只修改你选择的平台和数据库对应字段。

```yaml
# 运行平台：cloudflare / vercel / edgeone
platform: cloudflare

# 数据库：d1 / supabase / postgres
# d1 只能搭配 cloudflare
database: d1

# 运行平台上的项目名：小写字母、数字和连字符
projectName: echoes-studio

cloudflare:
  # 仅 platform: cloudflare 时填写
  # Cloudflare Dashboard 账号首页显示的 32 位 Account ID
  accountId: "替换为 Cloudflare Account ID"

vercel:
  # 仅 Vercel 团队账号填写；个人账号留空
  team:

edgeone:
  # 仅 platform: edgeone 时使用
  # overseas：全球不含中国大陆
  # global：包含中国大陆，通常需要实名和域名备案
  area: overseas
```

这份配置不允许出现 Token、数据库密码或连接地址。解析器会检查字段名、组合和 Account ID，拼写错误会在 Action 的“读取部署配置”步骤直接显示。

### 3. 添加 GitHub Secrets

进入 `Settings → Secrets and variables → Actions → Secrets`：

| Secret         | 填什么                        | 什么时候需要           |
| -------------- | ----------------------------- | ---------------------- |
| `DEPLOY_TOKEN` | 所选运行平台的部署 Token      | 所有线上部署           |
| `DATABASE_URL` | PostgreSQL 完整连接地址和密码 | Supabase 或 PostgreSQL |

不要把 GitHub/Gitee 内容仓库 Token 放在这里。部署后首次打开 Studio 时再填写，它与平台部署凭证不是同一个东西。

平台 Token 的创建位置和最低权限：

| 平台                    | 创建位置                             | 需要的权限                                                            |
| ----------------------- | ------------------------------------ | --------------------------------------------------------------------- |
| Cloudflare + D1         | `My Profile → API Tokens`            | `Workers Scripts: Edit`、`D1: Edit`、`Account Settings: Read`         |
| Cloudflare + 外部数据库 | `My Profile → API Tokens`            | `Workers Scripts: Edit`、`Hyperdrive: Edit`、`Account Settings: Read` |
| Vercel                  | `Account Settings → Tokens`          | 能创建并部署目标项目                                                  |
| EdgeOne                 | EdgeOne Pages / Makers 的 Token 页面 | 能创建并部署目标项目                                                  |

[Cloudflare 创建 API Token](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/) · [Vercel 创建 Token](https://vercel.com/docs/accounts/create-a-vercel-team#creating-an-access-token) · [EdgeOne CLI](https://pages.edgeone.ai/zh/document/edgeone-cli)

使用 Supabase 时，在项目顶部打开 `Connect` 并复制连接地址：

- Cloudflare Worker 使用 Direct connection string，由 Hyperdrive 负责连接池。
- Vercel 和 EdgeOne 使用 pooled connection string。
- 把完整地址保存为 `DATABASE_URL`，不要拆成多个变量。

[Supabase 数据库连接](https://supabase.com/docs/guides/database/connecting-to-postgres) · [Cloudflare Hyperdrive 连接 Supabase](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/)

### 4. 运行部署

打开 `Actions → 部署 Echoes Studio → Run workflow`，选择 `production` 并运行。Action 根据同一份 `DEPLOY_CONFIG` 自动执行：

| 组合                             | Action 自动处理                                                   |
| -------------------------------- | ----------------------------------------------------------------- |
| Cloudflare + D1                  | 创建或复用 D1、生成 Binding、迁移数据库、部署 Worker 和定时触发器 |
| Cloudflare + Supabase/PostgreSQL | 迁移数据库、创建或更新 Hyperdrive、生成 Binding、部署 Worker      |
| Vercel + Supabase/PostgreSQL     | 迁移数据库、创建或关联项目、构建并部署 Node Function              |
| EdgeOne + Supabase/PostgreSQL    | 迁移数据库、构建 Cloud Function、创建或更新项目                   |

部署成功后，日志末尾会显示访问地址。以后 Studio 仓库的 `main` 更新会自动重新部署；在 Studio 中推送博客文章只改变博客仓库，不会重新部署 Studio。

EdgeOne 的 `overseas` 和 `global` 在项目创建后不适合原地切换。需要换区域时，修改 `projectName` 创建新项目。系统预览链接可能带短期 `eo_token`；正式使用建议在项目中绑定 Production 域名。

## 第一次初始化

第一次打开部署地址时会进入初始化页面。数据库已经由部署 Action 配置完成，页面只要求创建登录密码并连接内容仓库。

### 1. 创建登录密码

密码至少 8 个字符。服务端保存加盐哈希，不保存明文；安装密钥和内部调度令牌自动生成。登录后可在 `系统设置 → 登录与安全` 修改密码，也可从左上角退出登录。

### 2. 连接内容仓库

选择 GitHub 或 Gitee，填写仓库地址和仓库 Token，例如：

```text
https://github.com/you/your-blog
https://gitee.com/you/your-blog
```

页面会检测地址、默认分支、文章目录和读写权限，成功后才能完成初始化。切换 GitHub 和 Gitee 时，两边尚未提交的地址和 Token 会分别保留。

GitHub 推荐使用 fine-grained personal access token：

1. `Repository access` 只选择博客仓库。
2. `Repository permissions` 设置 `Contents: Read and write`。
3. `Metadata: Read` 使用 GitHub 默认值。

[GitHub 管理 personal access token](https://docs.github.com/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens) · [Gitee 私人令牌](https://gitee.com/profile/personal_access_tokens)

初始化成功后，仓库 Token 使用 AES-GCM 加密保存在数据库。设置页只显示“已配置”，不会把旧 Token 明文返回浏览器。更换 Token 时输入新值并重新测试连接。

### 3. 确认文章目录

默认目录为 `src/content`，只读取其中的 `.md` 和 `.mdx`，并保留子目录层级。博客使用其他目录时，在初始化页面的高级选项中修改；分支留空时读取仓库默认分支。

完成初始化后点击“拉取仓库”，第一次导入文章。

## 写作与同步

保存到数据库和提交到 Git 是两个步骤：

```text
远端仓库 → 拉取仓库 → CMS 数据库 → 编辑并自动保存 → 待同步 → commit 并推送 → 远端仓库
```

### 保存状态

- 输入停止后，文章自动保存到数据库。
- 自动保存不会修改 GitHub、Gitee 或本地博客仓库。
- 保存内容与仓库基线不同，文章进入“待同步”。
- Ctrl+Z 等操作让内容回到仓库基线并保存后，会自动退出“待同步”。
- 新建、移动和删除都先保存在 CMS，推送前仓库不会改变。

### 拉取仓库

“拉取仓库”读取远端分支最新状态，并与数据库中的共同基线比较：

- 只有仓库变化时，导入仓库版本。
- 只有 CMS 变化时，继续保留为待同步。
- 两边内容相同时，更新共同基线。
- 两边从同一基线改成不同内容时，记录冲突，不覆盖任一版本。

Cloudflare 部署包含 Cron Trigger，按设置页选择的周期拉取；选择“仅手动”时不会自动导入。Vercel 和 EdgeOne 默认使用手动拉取。

### 提交并推送

单篇文章可以“推送当前”。多篇待同步文章可以进入“批量推送”，选择文章后一次提交：

1. 确认本次包含的新建、修改、移动和删除。
2. 填写 1 到 200 个字符的 commit message。
3. 点击“提交并推送”。

所选文章会进入同一个 Git commit。推送前 Studio 会重新读取最新分支和目标文件，不执行 force push。远端只修改了其他文件时，会基于最新 HEAD 创建文章 commit；目标文章也被修改时，推送停止并生成冲突。

### 撤销、历史和冲突

- 待同步文章可从右键菜单“撤销改动”，恢复到共同基线。
- 文章历史包含 CMS 保存快照和仓库 commit，可选择参考版本查看差异。
- 恢复历史版本会形成新的 CMS 改动，仍需推送才进入仓库。
- 两台设备同时编辑时使用版本检查，旧页面不能静默覆盖新版本。
- 冲突可以采用仓库内容、采用 CMS 内容或手动合并；处理后仍会重新检查远端。

## 更新 Echoes Studio

Studio 程序和博客内容是两个独立流程：

| 操作                         | 改变什么     | 是否部署 Studio |
| ---------------------------- | ------------ | :-------------: |
| 更新 Echoes Studio 的 `main` | 后台程序     |       ✅        |
| 在 Studio 中推送文章         | 博客仓库内容 |        —        |

直接维护本仓库时，把新版代码合并到 `main`；Action 会重新检查、构建并迁移数据库。使用 Fork 时，通过 GitHub `Sync fork` 或合并上游 `main` 更新，再检查并推送自己的 `main`。

数据库 migration 是幂等的，但正式升级前仍建议备份数据库。尚未推送的文章只存在数据库中，不会从博客仓库自动恢复。

## 安全与数据位置

| 数据                  | 保存位置                               |
| --------------------- | -------------------------------------- |
| `DEPLOY_CONFIG`       | GitHub Variable，只保存非敏感 YAML     |
| 平台部署 Token        | GitHub Secret `DEPLOY_TOKEN`           |
| PostgreSQL 地址和密码 | GitHub Secret `DATABASE_URL`           |
| Studio 登录密码       | 数据库中的密码哈希                     |
| GitHub / Gitee Token  | 数据库中的 AES-GCM 密文                |
| 未推送文章和历史快照  | D1、Supabase、PostgreSQL 或本地 SQLite |
| 已推送文章            | 博客 Git 仓库                          |

撤销 GitHub/Gitee Token 会停止后续仓库访问。更换仓库前，先推送或备份待同步内容。删除 Studio 数据库会同时删除登录设置、仓库密文、未推送文章、历史快照和同步基线。

## 常见问题

### GitHub Action 没有运行

自动部署只在仓库 Variable `DEPLOY_CONFIG` 存在时响应 `main` push。第一次可以进入 `Actions → 部署 Echoes Studio → Run workflow` 手动运行。配置缺失或 YAML 无效时，“读取部署配置”步骤会指出具体字段。

### Cloudflare 提示无权限或无法创建数据库

确认 `DEPLOY_TOKEN` 和 `cloudflare.accountId` 属于同一账号。使用 D1 时需要 `D1: Edit`，使用外部数据库时需要 `Hyperdrive: Edit`；两者都需要 `Workers Scripts: Edit` 和 `Account Settings: Read`。

### Supabase 连接或 migration 失败

确认 Secret 名称是 `DATABASE_URL`，地址包含用户名、密码、主机和数据库名。Cloudflare 使用 Direct connection string；Vercel 和 EdgeOne 使用 pooled connection string。密码包含特殊字符时，使用 Supabase `Connect` 面板给出的完整编码地址。

### 仓库检测一直失败

检查仓库 URL、默认分支和文章目录。GitHub fine-grained Token 必须选择目标仓库并授予 `Contents: Read and write`；只有读取权限时可以拉取，但不能推送。

### 推送提示远端已经改变

先点击“拉取仓库”。如果远端只修改了其他文件，可以继续推送；同一篇文章两边都改过时，进入冲突处理。Studio 不会按照最后写入时间直接覆盖内容。

### EdgeOne 系统地址返回 401

`overseas` 系统域名在部分网络中可能受访问规则影响，短期预览地址也可能需要新的 `eo_token`。可在项目控制台重新生成预览链接，或为 Production 绑定自定义域名。

### 忘记 Studio 登录密码

当前没有邮件找回功能，修改密码需要输入当前密码。忘记密码时，先备份数据库中尚未推送的内容，再使用空数据库重新初始化并拉取仓库。

## 本地运行

需要 Node.js 22.5+ 和 pnpm 10：

```bash
git clone https://github.com/lsy2246/echoes-studio.git
cd echoes-studio
pnpm install
cp .env.example .env
pnpm dev
```

打开 `http://127.0.0.1:4173`，API 默认运行在 `http://127.0.0.1:8788`。SQLite 文件位于 `.data/echoes-studio.sqlite`，第一次打开同样需要创建密码并连接 GitHub/Gitee。

要直接编辑电脑上的博客目录，在 `.env` 中设置：

```dotenv
CMS_ADMIN_PASSWORD=设置一个至少八位的本地密码
CMS_REPOSITORY_DRIVER=filesystem
CMS_REPOSITORY_PATH=/你的博客绝对路径
CMS_CONTENT_ROOT=src/content
```

重新启动后，Studio 会直接读写该目录。“提交并推送”只修改本地文件，不会替你执行 `git commit` 或 `git push`。

## 许可证

当前仓库尚未包含 `LICENSE` 文件。
