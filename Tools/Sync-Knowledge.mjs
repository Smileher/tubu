#!/usr/bin/env node
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const API = 'https://api.dingtalk.com';
const MAX_MARKDOWN_BYTES = 8 * 1024 * 1024;
const hash = (bytes, algorithm = 'sha256') => crypto.createHash(algorithm).update(bytes).digest('hex');
const required = (env, name) => {
  if (!env[name]) throw new Error(`缺少环境变量 ${name}`);
  return env[name];
};

// 不输出响应正文、签名 URL 或底层网络异常，以免公开日志泄露凭证或文档。
export function createTransport({ fetchImpl = fetch, timeoutMs = 30000, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async function request(url, options = {}, { safe = false, binary = false, label = '请求' } = {}) {
    const attempts = safe ? 3 : 1;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      let retry = false;
      try {
        const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(timeoutMs), redirect: 'error' });
        if (!response.ok) {
          retry = response.status === 429 || response.status >= 500;
          let code = '';
          if (new URL(url).origin === API) {
            const body = await response.json().catch(() => ({}));
            if (/^[\w.-]{1,120}$/.test(body.code || '')) code = ` (${body.code})`;
          }
          const error = new Error(`${label}: HTTP ${response.status}${code}`);
          error.retryable = retry;
          throw error;
        }
        if (!binary) return await response.json();
        const length = Number(response.headers.get('content-length'));
        if (length > MAX_MARKDOWN_BYTES) throw new Error('Markdown 超过读取上限');
        const chunks = [];
        let size = 0;
        for await (const chunk of response.body) {
          size += chunk.length;
          if (size > MAX_MARKDOWN_BYTES) throw new Error('Markdown 超过读取上限');
          chunks.push(chunk);
        }
        return Buffer.concat(chunks);
      } catch (error) {
        retry = error.retryable || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
        if (attempt === attempts || !retry) {
          if (error.retryable !== undefined || error.message === 'Markdown 超过读取上限') throw error;
          throw new Error(`${label}: ${['TimeoutError', 'AbortError'].includes(error.name) ? '请求超时' : '网络或响应异常'}`);
        }
      }
      await pause(attempt * 1500);
    }
  };
}

export function fullName(node) {
  const extension = String(node.extension || '').replace(/^\./, '');
  return extension && !node.name?.endsWith(`.${extension}`) ? `${node.name}.${extension}` : node.name;
}

export function selectNode(nodes, name, type) {
  const candidates = nodes.filter((node) => fullName(node) === name || node.name === name ||
    (type === 'FILE' && node.name === name.replace(/\.md$/, '')));
  if (candidates.length > 1) throw new Error('远端存在多个同名节点，停止该项写入');
  const node = candidates[0];
  if (node && (node.type !== type || (type === 'FILE' &&
      (String(node.extension).toLowerCase() !== 'md' || node.storageDriver !== 'DINGTALK')))) {
    throw new Error('远端节点类型不符，停止该项写入');
  }
  return node;
}

export class DingTalkKnowledge {
  constructor({ token, operatorId, workspaceId, parentUuid, request }) {
    Object.assign(this, { token, operatorId, workspaceId, parentUuid, request });
  }

  async api(route, query = {}, body, safe = body === undefined) {
    const url = new URL(route, API);
    for (const [key, value] of Object.entries(query)) if (value !== '') url.searchParams.set(key, value);
    return this.request(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'x-acs-dingtalk-access-token': this.token, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }, { safe, label: route.replace(/\/[^/]+(?=\/queryDentryId)/, '/<node>') });
  }

  async map(uuid) {
    const result = await this.api(`/v2.0/doc/dentries/${encodeURIComponent(uuid)}/queryDentryId`, { operatorId: this.operatorId });
    if (result.dentryUuid !== uuid || !result.spaceId || !result.dentryId) throw new Error('节点存储映射无效');
    return result;
  }

  async inspect(id) {
    const result = await this.api(`/v1.0/storage/spaces/${this.spaceId}/dentries/${id}/query`,
      { unionId: this.operatorId }, { option: { withThumbnail: false } }, true);
    if (!result.dentry?.id || String(result.dentry.spaceId) !== String(this.spaceId)) throw new Error('文件信息缺失或空间不符');
    return result.dentry;
  }

  async resolve() {
    // 直接使用已核实的目标父节点 UUID；workspace 元信息接口属于另一套权限，不能因校验便利而扩大权限要求。
    const parent = await this.map(this.parentUuid);
    this.spaceId = parent.spaceId;
    const node = await this.inspect(parent.dentryId);
    if (node.type !== 'FOLDER' || node.uuid !== this.parentUuid) throw new Error('目标父节点不是指定文件夹');
    const storedChildren = await this.list(node);
    const directChildren = new Set(storedChildren.map((child) => child.uuid).filter(Boolean));
    const folders = [''];
    let pages = 0;
    // 旧知识库 ID 与 UUID 不混用：从 workspace 目录树的真实 dentryId 逐层查询。
    // 根节点不出现在目录树中时，通过已回读父目录的直接子节点 UUID 确认归属。
    for (const folderId of folders) {
      let cursor = '';
      const seen = new Set();
      do {
        if (++pages > 100) throw new Error('知识库归属查询超过分页上限');
        const result = await this.api(`/v2.0/doc/spaces/${encodeURIComponent(this.workspaceId)}/directories`, {
          operatorId: this.operatorId, dentryId: folderId, maxResults: 50, nextToken: cursor,
        });
        if (!Array.isArray(result.children)) throw new Error('知识库目录树返回缺失');
        for (const child of result.children) {
          if (child.spaceId !== this.workspaceId) throw new Error('知识库目录树空间不符');
          if (child.dentryUuid === this.parentUuid || directChildren.has(child.dentryUuid)) {
            this.knowledgeParentId = child.dentryUuid === this.parentUuid ? child.dentryId : folderId;
            return node;
          }
          if (child.dentryType === 'folder' && child.dentryId && !folders.includes(child.dentryId)) folders.push(child.dentryId);
        }
        if (!result.hasMore) break;
        cursor = result.nextToken;
        if (!cursor || seen.has(cursor)) throw new Error('知识库目录树分页不完整');
        seen.add(cursor);
      } while (cursor);
    }
    throw new Error('目标父目录未在指定知识库目录树中确认，停止写入');
  }

  async list(parent) {
    const nodes = [];
    const cursors = new Set();
    let cursor = '';
    for (let page = 0; page < 100; page++) {
      const result = await this.api(`/v1.0/storage/spaces/${this.spaceId}/dentries`, {
        parentId: parent.id, unionId: this.operatorId, maxResults: 50, orderBy: 'NAME', order: 'ASC', nextToken: cursor,
      });
      if (!Array.isArray(result.dentries)) throw new Error('目录返回缺少文件列表');
      for (const node of result.dentries) {
        if (String(node.spaceId) !== String(this.spaceId) || String(node.parentId) !== String(parent.id)) throw new Error('目录返回了其他位置的节点');
        nodes.push(node);
      }
      cursor = result.nextToken || '';
      if (!cursor) return nodes;
      if (cursors.has(cursor)) throw new Error('目录分页游标重复');
      cursors.add(cursor);
    }
    throw new Error('目录分页超过上限');
  }

  async createFolder(parent, name) {
    const result = await this.api(`/v1.0/doc/workspaces/${encodeURIComponent(this.workspaceId)}/docs`, {}, {
      name, docType: 'FOLDER', operatorId: this.operatorId,
      ...(this.knowledgeParentId ? { parentNodeId: this.knowledgeParentId } : {}),
    });
    if (result.workspaceId !== this.workspaceId || !result.dentryUuid) throw new Error('创建知识库目录未返回节点');
    const mapped = await this.map(result.dentryUuid);
    if (String(mapped.spaceId) !== String(this.spaceId)) throw new Error('创建目录空间不符');
    const node = await this.inspect(mapped.dentryId);
    if (node.name !== name || node.type !== 'FOLDER' || String(node.parentId) !== String(parent.id) || !node.uuid) throw new Error('创建目录回读不符');
    return node;
  }

  async verifyFolder(folder) {
    let cursor = '';
    const seen = new Set();
    for (let page = 0; page < 100; page++) {
      const result = await this.api(`/v2.0/doc/spaces/${encodeURIComponent(this.workspaceId)}/directories`, {
        operatorId: this.operatorId, dentryId: this.knowledgeParentId || '', maxResults: 50, nextToken: cursor,
      });
      if (!Array.isArray(result.children)) throw new Error('知识库目录树返回缺失');
      if (result.children.some((child) => child.dentryUuid === folder.uuid && child.dentryType === 'folder')) return;
      if (!result.hasMore) break;
      cursor = result.nextToken;
      if (!cursor || seen.has(cursor)) throw new Error('知识库目录树分页不完整');
      seen.add(cursor);
    }
    throw new Error('KnowledgeQA 仅存在于存储层，未注册为指定知识库目录，停止写入');
  }

  async same(node, content) {
    // 当前 Storage 元信息没有内容 hash；只下载有界 Markdown 比较，不持久保存正文。
    if (Number(node.size) > MAX_MARKDOWN_BYTES) throw new Error('远端 Markdown 超过读取上限');
    const info = await this.api(`/v1.0/storage/spaces/${this.spaceId}/dentries/${node.id}/downloadInfos/query`,
      { unionId: this.operatorId }, { option: { preferIntranet: false, ...(node.version ? { version: node.version } : {}) } }, true);
    const signed = info.headerSignatureInfo;
    if (!signed?.resourceUrls?.[0] || !signed.headers) throw new Error('下载信息不完整');
    const bytes = await this.request(signed.resourceUrls[0], { headers: signed.headers }, { safe: true, binary: true, label: '读取远端 Markdown' });
    return hash(bytes) === hash(content);
  }

  async upload(parent, name, content, existing) {
    // 提交前重新检查同名节点，避免查询与提交之间出现歧义；效果未知的写请求不重试。
    const current = selectNode(await this.list(parent), name, 'FILE');
    if ((current?.id || null) !== (existing?.id || null) || (existing && current.version !== existing.version)) throw new Error('远端文件在同步期间变化，请重跑');
    const query = { unionId: this.operatorId };
    const route = `/v2.0/storage/spaces/files/${encodeURIComponent(parent.uuid)}`;
    const info = await this.api(`${route}/uploadInfos/query`, query, {
      protocol: 'HEADER_SIGNATURE', option: { storageDriver: 'DINGTALK', preCheckParam: { size: content.length, name } },
    }, true);
    const signed = info.headerSignatureInfo;
    if (!info.uploadKey || !signed?.resourceUrls?.[0] || !signed.headers) throw new Error('上传信息不完整');
    // signed PUT 可能返回空正文，按字节模式消费响应；它不是重复下载验收。
    await this.request(signed.resourceUrls[0], {
      method: 'PUT', headers: { ...signed.headers, 'content-type': '' }, body: content,
    }, { binary: true, label: '上传 Markdown' });
    const result = await this.api(`${route}/commit`, query, {
      uploadKey: info.uploadKey, name,
      option: { size: content.length, conflictStrategy: existing ? 'OVERWRITE' : 'RETURN_ERROR_IF_EXISTS', convertToOnlineDoc: false },
    });
    const committed = result.dentry;
    if (!committed?.id || (existing && String(committed.id) !== String(existing.id))) throw new Error('提交未返回原文件节点，停止该项');
    const verified = { ...committed, ...await this.inspect(committed.id) };
    const differences = [];
    if (!verified.uuid) differences.push('缺少 UUID');
    if (fullName(verified) !== name) differences.push('名称不符');
    if (verified.type !== 'FILE') differences.push('类型不符');
    if (String(verified.parentId) !== String(parent.id)) differences.push('父目录不符');
    if (Number(verified.size) !== content.length) differences.push(`大小不符：expected=${content.length}, actual=${verified.size}`);
    if (verified.storageDriver !== 'DINGTALK') differences.push('存储驱动不符');
    if (differences.length) {
      throw new Error(`写后文件元信息不符（${differences.join('；')}）`);
    }
    return verified;
  }
}

export async function syncFiles({ client, files, dryRun = true, log = console.log }) {
  const summary = { created: 0, updated: 0, skipped: 0, plannedCreated: 0, plannedUpdated: 0, failed: 0, failures: [], items: [] };
  const fail = (file, error) => {
    summary.failed++;
    summary.failures.push({ file, error: error.message });
    log(`失败 ${file}: ${error.message}`);
  };
  const root = await client.resolve();
  const rootNodes = await client.list(root);
  let qaFolder;
  let qaNodes;
  let qaError;
  try {
    qaFolder = selectNode(rootNodes, 'KnowledgeQA', 'FOLDER');
    if (!qaFolder && !dryRun) qaFolder = await client.createFolder(root, 'KnowledgeQA');
    qaNodes = qaFolder ? await client.list(qaFolder) : [];
  } catch (error) { qaError = error; }
  for (const file of files) {
    const key = file.qa ? `KnowledgeQA/${file.name}` : `Help/${file.name}`;
    try {
      if (file.qa && qaError) throw qaError;
      const parent = file.qa ? qaFolder : root;
      const nodes = file.qa ? qaNodes : rootNodes;
      const existing = !file.qa && client.helpNodeUuid
        ? [...rootNodes, ...nodes].find((node) => node.uuid === client.helpNodeUuid) || null
        : selectNode(nodes, file.name, 'FILE');
      if (file.qa && rootNodes.some((node) => fullName(node) === file.name || node.name === file.name || node.name === file.name.replace(/\.md$/, ''))) {
        throw new Error('同名 QA 已存在父目录，与 KnowledgeQA 子目录映射冲突，停止写入以避免重复知识源');
      }
      let action;
      if (existing && await client.same(existing, file.content)) {
        summary.skipped++;
        action = 'skipped';
      } else {
        action = existing ? 'updated' : 'created';
        if (dryRun) summary[existing ? 'plannedUpdated' : 'plannedCreated']++;
        else {
          const targetName = existing ? fullName(existing) : file.name;
          const saved = await client.upload(parent, targetName, file.content, existing);
          summary[action]++;
          summary.items.push({ file: key, action, nodeId: saved.uuid, parentId: parent.uuid });
        }
      }
      if (dryRun || action === 'skipped') summary.items.push({ file: key, action: dryRun && action !== 'skipped' ? `planned-${action}` : action,
        nodeId: existing?.uuid || '', parentId: parent?.uuid || '待建 KnowledgeQA 子目录' });
      log(`${dryRun ? '预览 ' : ''}${action} ${key}`);
    } catch (error) { fail(key, error); }
  }
  return summary;
}

async function collectFiles(env) {
  const help = path.resolve(required(env, 'KNOWLEDGE_HELP_DIR'), 'ai-knowledge.md');
  const qa = path.resolve(required(env, 'KNOWLEDGE_QA_DIR'));
  const entries = await fs.readdir(qa, { withFileTypes: true });
  const sources = [{ name: 'ai-knowledge.md', file: help, qa: false }, ...entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((entry) => ({ name: entry.name, file: path.join(qa, entry.name), qa: true }))];
  if (sources.length === 1) throw new Error('KnowledgeQA/*.md 为空，停止同步');
  const files = [];
  for (const source of sources) {
    const stat = await fs.lstat(source.file);
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_MARKDOWN_BYTES) throw new Error('源 Markdown 类型或大小不符');
    files.push({ name: source.name, qa: source.qa, content: await fs.readFile(source.file) });
  }
  return files;
}

async function main() {
  const started = Date.now();
  const env = process.env;
  const dryRun = (env.KNOWLEDGE_DRY_RUN || 'true') === 'true';
  if (!['true', 'false'].includes(env.KNOWLEDGE_DRY_RUN || 'true')) throw new Error('KNOWLEDGE_DRY_RUN 必须为 true 或 false');
  const sourceSha = required(env, 'KNOWLEDGE_SOURCE_SHA');
  if (!/^[a-f0-9]{40}$/.test(sourceSha)) throw new Error('源码 SHA 无效');
  let summary;
  try {
    const files = await collectFiles(env);
    const request = createTransport();
    const auth = await request(`${API}/v1.0/oauth2/accessToken`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey: required(env, 'DINGTALK_APP_KEY'), appSecret: required(env, 'DINGTALK_APP_SECRET') }),
    }, { safe: true, label: '获取访问凭证' });
    if (!auth.accessToken) throw new Error('访问凭证返回为空');
    const client = new DingTalkKnowledge({ token: auth.accessToken, operatorId: required(env, 'DINGTALK_OPERATOR_ID'),
      workspaceId: required(env, 'KNOWLEDGE_WORKSPACE_ID'), parentUuid: required(env, 'KNOWLEDGE_PARENT_UUID'), request });
    client.helpNodeUuid = env.KNOWLEDGE_HELP_NODE_UUID || '';
    summary = await syncFiles({ client, files, dryRun });
  } catch (error) {
    summary = { created: 0, updated: 0, skipped: 0, plannedCreated: 0, plannedUpdated: 0, failed: 1,
      failures: [{ file: '整轮前置检查', error: error.message }], items: [] };
  }
  Object.assign(summary, { sourceSha, dryRun, durationSeconds: Math.round((Date.now() - started) / 1000) });
  console.log(`KNOWLEDGE_SYNC_RESULT=${JSON.stringify(summary)}`);
  if (env.GITHUB_STEP_SUMMARY) {
    await fs.appendFile(env.GITHUB_STEP_SUMMARY, `## 每日知识库同步${dryRun ? '（只读预览）' : ''}\n\n` +
      `源码：\`${sourceSha}\`\n\n新增 ${summary.created} · 更新 ${summary.updated} · 跳过 ${summary.skipped} · 失败 ${summary.failed}\n\n` +
      `预计新增 ${summary.plannedCreated} · 预计更新 ${summary.plannedUpdated} · 耗时 ${summary.durationSeconds} 秒\n\n` +
      '| 文件 | 结果 | 节点 |\n| --- | --- | --- |\n' + summary.items.map((item) => `| ${item.file} | ${item.action} | ${item.nodeId || '待创建'} |`).join('\n') + '\n\n' +
      summary.failures.map((item) => `- ${item.file}: ${item.error.replace(/[\r\n<>]/g, ' ')}`).join('\n') + '\n', 'utf8');
  }
  if (summary.failed) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(() => { console.error('知识库同步启动失败，请检查环境配置'); process.exitCode = 1; });
}
