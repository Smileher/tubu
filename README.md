# TuBu Release 发布仓库

涂布 CCD 软件的自动发布仓库。源码托管在云效 Codeup（私有），本仓库公开，承担两件事：

1. **每日自动构建发版**：GitHub Actions 在 `windows-latest` 托管 runner 上浅克隆 Codeup 源码、执行 `Build.ps1` + `Package.ps1`，把安装包发布到 Releases。
2. **Pages 手册站点**：每次发版把源码仓库的 `Help/` 静态手册原样部署到本仓库 Pages。

源码不进入本仓库；凭证只放在 Secrets 中。

## 首次配置（做一次即可）

1. **配置 Secrets**（Settings → Secrets and variables → Actions → New repository secret）：
   - `CODEUP_USER`：Codeup HTTPS 克隆用户名
   - `CODEUP_TOKEN`：Codeup HTTPS 克隆密码 / 个人访问令牌（需要仓库读取权限）
2. **开启 Pages**（Settings → Pages）：
   - Source: `Deploy from a branch`
   - Branch: `main`，目录 `/docs`
3. 首次运行：Actions → daily-release → **Run workflow** 手动触发一次，验证全流程；失败恢复可勾选 `force`。
4. 手册站点地址：`https://smileher.github.io/tubu/`

## 运行逻辑

- 每日 UTC 21:00（北京时间次日凌晨 05:00）定时触发，也可手动触发。
- 先用 `git ls-remote` 检测 Codeup `Develop` 分支最新 commit，与最近一次 Release 的 commit 一致则跳过（秒级结束）。
- 有新提交才：浅克隆（`--depth 1`）→ NuGet 缓存还原 → 构建 Debug x64 → `Package.ps1` 打包 → 发布 Release（tag 形如 `build-2026.10.29-a1b2c3d`，附 SHA256）→ 更新 `docs/` 并推送 Pages。
- 产物命名：`App-TuBu-<时间戳>_<commit短哈希>.7z`。

## V2 自动化规划

- 钉钉上传：`.github/workflows/weekly-dingtalk-upload.yml` 每周五北京时间 05:00 在 GitHub 托管 runner 下载最新 Release 资产，幂等上传到指定钉盘目录并按文件名和大小复核；凭证放 GitHub Actions Secrets。
- 知识运营：定时读取钉钉中 AI 助理无法答复的问题 → LLM 分析 → 回填 md → 更新钉钉知识库；每次发版同步 `ai-knowledge.md` 到钉钉。
- 注意：本仓库 Actions 日志公开，涉及 LLM 分析时严禁把源码内容和任何密钥打印到日志。
