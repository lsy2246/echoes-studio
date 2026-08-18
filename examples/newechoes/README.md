# 连接 New Echoes 仓库

New Echoes 或个人博客仓库不需要安装 Echoes Studio Action，也不保存 Studio 密钥。同步由 Studio 主动发起。

## 首次连接

部署完成后第一次打开 Studio：

1. 创建 fine-grained personal access token，并且只选择需要管理的博客仓库。
2. Repository permissions 开启 **Contents: Read and write**。
3. 在初始化页创建登录密码。
4. 粘贴完整 GitHub 仓库地址和 Token。

Studio 会自动识别仓库所有者、仓库名和默认分支，并默认使用 `src/content`。安装密钥和内部令牌也会自动生成。Token 只发送到 Studio 服务端，加密写入数据库后不再回显。

## 高级方式：部署时配置 GitHub App

需要集中管理多个仓库时，可使用 GitHub App。只把 App 安装到 Studio 应管理的仓库，并授予最小权限：

- **Contents: Read and write**：读取 Markdown / MDX，并创建文章 commit。
- **Metadata: Read-only**：GitHub 自动授予。
- **Pull requests: Read and write**：可选，仅在启用 PR 发布时需要。

轮询模式不需要 Actions、Administration、Secrets、Webhooks 或组织级权限。创建 App 时可以关闭 **Webhook → Active**；Echoes Studio 不需要 GitHub 回调本机或公网地址，因此也不需要 Cloudflare Tunnel 或 ngrok。

只有集中管理多个仓库时才需要在部署平台配置：

```dotenv
CMS_GITHUB_OWNER=your-account
CMS_GITHUB_REPO=your-newechoes-site
# 留空时自动读取仓库默认分支
CMS_GITHUB_BRANCH=
CMS_CONTENT_ROOT=src/content
CMS_GITHUB_APP_ID=...
CMS_GITHUB_INSTALLATION_ID=...
CMS_GITHUB_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."
```

## 拉取和推送

定时任务或「拉取仓库」会读取配置分支。推送时，Studio 比较目标文章与共同基线，在最新分支 HEAD 上创建 commit，并以 `force: false` 更新分支 Ref。

直推成功后数据库会立即记录 commit；下一次拉取只是幂等确认。需要马上刷新仓库内容时，点击「拉取仓库」。
