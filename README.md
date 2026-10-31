# TuBu Release 发布仓库

涂布 CCD 软件的自动发布仓库。源码托管在云效 Codeup（私有），本仓库公开，承担以下任务：

1. **每日自动构建发版**：GitHub Actions 在 `windows-latest` 托管 runner 上浅克隆 Codeup 源码、执行 `Build.ps1` + `Package.ps1`，把安装包发布到 Releases。
2. **Pages 手册站点**：每次发版把源码仓库的 `Help/` 静态手册原样部署到本仓库 Pages。
3. **周五钉盘上传**：独立任务每周五北京时间 09:00 上传最新 Release 安装包。
4. **每日知识库同步**：独立任务每天北京时间 03:00 同步已提交的正式手册和 QA，不依赖构建。

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

## 每日知识库同步

- 执行位置：本仓库 `.github/workflows/daily-knowledge-sync.yml`，GitHub 托管 Ubuntu runner / Node.js 22；整轮 20 分钟，同一任务串行，定时启动可能因 GitHub 排队延迟。
- 来源：Codeup `Develop` 本轮固定 SHA；`Help/ai-knowledge.md` → 目标父目录现有同名 Markdown；`KnowledgeQA/*.md`（包括 README）→ 现有 `KnowledgeQA` 子目录。
- 目标 workspace：`YRBGvgKbpvp0KzDA`；父目录 UUID：`ydxXB52LJqA1O6onF2e4kbwMJqjMp697`。先通过 workspace 根节点和存储祖先链验证归属，再读取完整分页列表，复用现有节点。
- 使用既有 `CODEUP_USER`、`CODEUP_TOKEN`、`DINGTALK_APP_KEY`、`DINGTALK_APP_SECRET`、`DINGTALK_OPERATOR_ID` Secrets。运行期间的源码、QA、Git 认证 helper 仅放临时目录，结束清理；不提交、不上传 Actions 附件。
- 文档目录、workspace、目标父目录和预览开关使用工作流中的 `KNOWLEDGE_*` 环境变量配置。执行脚本为 `Tools/Sync-Knowledge.mjs`，与安装包上传脚本分开。
- 当前 Storage 元信息无可比内容哈希，因此仅下载小体积 Markdown（单文件上限 8 MiB）比较 SHA256；内容相同跳过，变化覆盖原节点，缺少则新建，不删除远端额外文件。同名冲突或类型不符停止该项。写后只核对节点和元信息，不重复下载全文或安装包。
- 单请求超时 30 秒；读取和获取访问凭证、下载信息最多额外重试两次；创建、上传、提交不盲重试。单项失败继续处理其他文件，最终任务失败并列出失败项。
- 手动补跑：[Actions → daily-knowledge-sync](https://github.com/Smileher/tubu/actions/workflows/daily-knowledge-sync.yml) → **Run workflow**。默认勾选 `dry_run` 只读预览；取消勾选正式同步。摘要记录源码 SHA、新增/更新/跳过/失败数量、预计变化及耗时，不含正文和密钥。
- 本地编辑功能时仍维护 Help，正文改变后运行源仓库 `Tools/UpdateHelpIndex.ps1` 并一起提交生成文件。同步不调用 LLM，不重新编写手册；离线 Help、Pages 和云效 QA 生产保持原路径。

### 切换和五天观察

上线验收顺序：针对性测试 → 云端手动预览 → 正式同步 → 再执行确认跳过 → 超级小布各验证一个手册问题及现有 QA 问题（核对知识来源）。文件同步成功不等于助手已完成索引。

只有以上验收通过，才移除千问 03:00 任务的知识库同步部分，保留 `qwenwork.host` 网页同步及其必要配置；未通过时继续保留千问知识库同步。实际切换状态与运行证据在下方记录。

从切换后的第一个定时运行日观察五天，只查看 Actions 历史和摘要。偶发失败手动重跑；持续故障时先暂停新任务，再恢复千问原知识库同步，避免双重写入。暂停入口为 Actions 工作流页面的 Disable workflow。

云效 QA 日期游标可能漏题的风险单独保留，本轮不改游标或处理状态。五天后按实际失败与回答效果决定是否修漏题、迁移云效、调整提示词或拆分手册；不新建监控或群通知。

当前状态：实现待云端验收，尚未移除千问知识库同步。

## 后续规划

- 知识运营：现有云效 Flow 读取问题 → LLM 分析 → 回填 Codeup QA；每日独立同步任务将已提交文档送入知识库。
- 注意：本仓库 Actions 日志公开，涉及 LLM 分析时严禁把源码内容和任何密钥打印到日志。
