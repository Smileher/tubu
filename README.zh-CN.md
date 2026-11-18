<div align="center">
  <img src="assets/tubu-hero.svg" alt="TuBu VisionMeasure" width="100%" />

  <p><strong>让涂布检测更清晰、更可靠。</strong></p>

  <p>
    <a href="README.md">English</a> ·
    <a href="https://vchenhev.github.io/tubu/">在线手册</a> ·
    <a href="https://github.com/vchenhev/tubu/releases/latest">最新版本</a> ·
    <a href="CHANGELOG.md">更新记录</a>
  </p>

  <p>
    <a href="https://github.com/vchenhev/tubu/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/vchenhev/tubu/release.yml?label=release" alt="Release workflow status" /></a>
    <a href="https://vchenhev.github.io/tubu/"><img src="https://img.shields.io/badge/manual-GitHub%20Pages-2563eb" alt="Online manual" /></a>
    <a href="CHANGELOG.md"><img src="https://img.shields.io/badge/history-monthly-0f766e" alt="Monthly release history" /></a>
  </p>
</div>

## TuBu 是什么？

TuBu VisionMeasure 面向连续涂布生产，提供工业视觉检测、尺寸测量、缺陷复核、工艺反馈和生产记录能力，让现场人员在一个清晰的工作区内完成检测任务。

本发布仓库只保留用户最需要的入口：最新安装包、在线操作手册和按月整理的版本记录。

## 为产线而设计

| 能力 | 作用 |
| --- | --- |
| **在线检测** | 通过相机采集、尺寸测量和缺陷分类持续观察涂布质量。 |
| **料号与参数** | 集中管理产品、检测区域、标定数据和检测参数。 |
| **清晰排查** | 从页面、参数或报警关键词快速定位手册中的操作步骤。 |
| **稳定发布** | 使用版本化安装包、配套手册和按月更新记录。 |

## 从这里开始

| 需求 | 入口 |
| --- | --- |
| 了解操作流程 | [打开在线手册](https://vchenhev.github.io/tubu/) |
| 安装或更新软件 | [下载最新版本](https://github.com/vchenhev/tubu/releases/latest) |
| 查看功能变化 | [浏览按月更新记录](CHANGELOG.md) |
| 提出问题 | 尽量使用手册中的页面名、页签名、参数名、按钮名或报警原文。 |

## 简洁的发布体验

发布流程会将当前生产软件构建为带版本的安装包，并把对应手册发布到 GitHub Pages。知识库同步与安装包发布彼此独立，方便现场使用，也方便维护人员追踪问题。

<details>
<summary><strong>维护人员入口</strong></summary>

仓库包含三个职责清晰的 GitHub Actions 工作流：

- `release.yml`：源码分支有新提交时构建并发布安装包。
- `daily-knowledge-sync.yml`：将已提交的手册和 QA 内容同步到钉钉知识库。
- `weekly-dingtalk-upload.yml`：将最新安装包上传到配置好的钉盘目录。

`docs/` 是 GitHub Pages 的部署目录；`changelog/YYYY-MM.md` 保存按月记录，根目录 `CHANGELOG.md` 作为索引。凭证只放在 GitHub Actions Secrets 中，不进入仓库内容。

</details>

## 仓库结构

```text
README.md              产品介绍页（英文默认）
README.zh-CN.md        产品介绍页（简体中文）
CHANGELOG.md           按月更新记录索引
changelog/YYYY-MM.md   每月更新记录
docs/                  GitHub Pages 部署目录
Tools/                 知识库同步与安装包上传任务
.github/workflows/     自动发布流程
```

TuBu 希望让每一次检测、每一次排查和每一次版本更新都更容易被理解。
