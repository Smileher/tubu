import test from 'node:test';
import assert from 'node:assert/strict';
import { createTransport, DingTalkKnowledge, fullName, selectNode, syncFiles } from './Sync-Knowledge.mjs';

const file = (name, qa = false) => ({ name, qa, content: Buffer.from('已提交的文档') });
const node = (name, id = name) => ({ name, id, uuid: id, type: 'FILE', extension: 'md', storageDriver: 'DINGTALK' });
function fixture({ rootNodes = [], qaNodes = [], same = false, uploadError } = {}) {
  const writes = [];
  const root = { id: 'root', uuid: 'root', type: 'FOLDER' };
  const client = {
    resolve: async () => root,
    list: async (parent) => parent.id === 'root' ? rootNodes : qaNodes,
    same: async () => same,
    createFolder: async () => { writes.push('folder'); return { id: 'qa', uuid: 'qa', type: 'FOLDER' }; },
    upload: async (parent, name) => {
      writes.push(name);
      if (name === uploadError) throw new Error('模拟单文件失败');
      return node(name);
    },
  };
  return { client, writes };
}
const run = (fixture, files, dryRun = false) => syncFiles({ client: fixture.client, files, dryRun, log: () => {} });

test('同内容跳过，不调用上传', async () => {
  const f = fixture({ rootNodes: [node('ai-knowledge.md')], same: true });
  const result = await run(f, [file('ai-knowledge.md')]);
  assert.equal(result.skipped, 1);
  assert.ok(!f.writes.includes('ai-knowledge.md'));
});
test('变化文件更新，新文件创建', async () => {
  const f = fixture({ rootNodes: [node('ai-knowledge.md'), { name: 'KnowledgeQA', id: 'qa', type: 'FOLDER' }] });
  const result = await run(f, [file('ai-knowledge.md'), file('QA-20261026-20261101.md', true)]);
  assert.equal(result.updated, 1);
  assert.equal(result.created, 1);
  assert.equal(result.failed, 0);
});
test('预览缺少文件夹时也不创建目录、申请上传或写文件', async () => {
  const f = fixture({ rootNodes: [node('ai-knowledge.md')] });
  const result = await run(f, [file('ai-knowledge.md'), file('README.md', true)], true);
  assert.equal(result.plannedUpdated, 1);
  assert.equal(result.plannedCreated, 1);
  assert.deepEqual(f.writes, []);
});
test('同名冲突、类型不符均不覆盖，继续其他文件', async () => {
  const f = fixture({ rootNodes: [node('ai-knowledge.md', 'a'), node('ai-knowledge.md', 'b'),
    { name: 'KnowledgeQA', id: 'qa', type: 'FOLDER' }], qaNodes: [{ ...node('bad.md'), storageDriver: 'ALIDOC' }] });
  const result = await run(f, [file('ai-knowledge.md'), file('bad.md', true), file('good.md', true)]);
  assert.equal(result.failed, 2);
  assert.equal(result.created, 1);
  assert.deepEqual(f.writes, ['good.md']);
});
test('父目录已经有同名 QA 时，不能在子目录创建第二份知识源', async () => {
  const f = fixture({ rootNodes: [node('QA-week.md'), { name: 'KnowledgeQA', id: 'qa', type: 'FOLDER' }] });
  const result = await run(f, [file('QA-week.md', true)], true);
  assert.equal(result.failed, 1);
  assert.equal(result.plannedCreated, 0);
  assert.deepEqual(f.writes, []);
});
test('文件查询使用官方 POST query 契约，读取可重试', async () => {
  let call;
  const c = new DingTalkKnowledge({ operatorId: 'operator', token: 'test', request: async (url, options, policy) => {
    call = { url: String(url), options, policy };
    return { dentry: { id: 'file', spaceId: 'space' } };
  } });
  c.spaceId = 'space';
  await c.inspect('file');
  assert.equal(call.url, 'https://api.dingtalk.com/v1.0/storage/spaces/space/dentries/file/query?unionId=operator');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.policy.safe, true);
});
test('文件失败保留其他成功项，并标记整轮失败', async () => {
  const f = fixture({ uploadError: 'ai-knowledge.md' });
  const result = await run(f, [file('ai-knowledge.md'), file('README.md', true)]);
  assert.equal(result.failed, 1);
  assert.equal(result.created, 1);
  assert.equal(result.failures[0].file, 'Help/ai-knowledge.md');
});
test('name + extension 与完整文件名兼容，普通文档类型严格核对', () => {
  const split = { ...node('ai-knowledge'), extension: 'md' };
  assert.equal(fullName(split), 'ai-knowledge.md');
  assert.equal(selectNode([split], 'ai-knowledge.md', 'FILE'), split);
  assert.throws(() => selectNode([{ ...split, type: 'FOLDER' }], 'ai-knowledge.md', 'FILE'), /类型不符/);
});
test('只读超时最多三次，写入超时只执行一次，不泄露 URL 和响应正文', async () => {
  let calls = 0;
  const request = createTransport({ timeoutMs: 5, pause: async () => {}, fetchImpl: async (_url, { signal }) => {
    calls++;
    await new Promise((resolve) => setTimeout(resolve, 10));
    signal.throwIfAborted();
  } });
  await assert.rejects(request('https://example.com/?signature=secret', {}, { safe: true, label: '读取' }), /读取: 请求超时/);
  assert.equal(calls, 3);
  calls = 0;
  await assert.rejects(request('https://example.com', { method: 'POST' }, { label: '提交' }), /提交: 请求超时/);
  assert.equal(calls, 1);
});
test('HTTP 403 不重试，429 可安全读取最多重试两次', async () => {
  let calls = 0;
  let status = 403;
  const request = createTransport({ pause: async () => {}, fetchImpl: async () => {
    calls++; return new Response(JSON.stringify({ code: 'permissionDenied', message: 'PRIVATE TEXT' }), { status });
  } });
  await assert.rejects(request('https://api.dingtalk.com/test', {}, { safe: true }), /HTTP 403 \(permissionDenied\)/);
  assert.equal(calls, 1);
  status = 429; calls = 0;
  await assert.rejects(request('https://api.dingtalk.com/test', {}, { safe: true }), /HTTP 429/);
  assert.equal(calls, 3);
});
test('分页未完成或跨目录返回不能作为完整列表处理', async () => {
  const c = new DingTalkKnowledge({ token: 'test', operatorId: 'test' });
  c.spaceId = 'space';
  c.api = async () => ({ dentries: [], nextToken: 'same' });
  await assert.rejects(c.list({ id: 'parent' }), /游标重复/);
  c.api = async () => ({ dentries: [{ id: 'x', spaceId: 'other', parentId: 'parent' }] });
  await assert.rejects(c.list({ id: 'parent' }), /其他位置/);
});
test('原文件覆盖返回新 ID 时失败，禁止将其作为更新成功', async () => {
  const c = new DingTalkKnowledge({ operatorId: 'test', request: async () => Buffer.alloc(0) });
  const original = node('ai-knowledge.md', 'original');
  c.list = async () => [original];
  c.api = async (route) => route.endsWith('/commit') ? { dentry: { id: 'different' } } :
    { uploadKey: 'test', headerSignatureInfo: { resourceUrls: ['https://example.com'], headers: {} } };
  await assert.rejects(c.upload({ uuid: 'parent' }, original.name, Buffer.from('changed'), original), /原文件节点/);
});
test('重复运行读取已保存内容后跳过，未重复新建', async () => {
  const f = fixture({ rootNodes: [{ name: 'KnowledgeQA', id: 'qa', type: 'FOLDER' }] });
  const saved = [];
  f.client.list = async (p) => p.id === 'root' ? [{ name: 'KnowledgeQA', id: 'qa', type: 'FOLDER' }, ...saved] : [];
  f.client.upload = async (_p, name) => { f.writes.push(name); const item = node(name); saved.push(item); return item; };
  f.client.same = async () => true;
  const first = await run(f, [file('ai-knowledge.md')]);
  const second = await run(f, [file('ai-knowledge.md')]);
  assert.equal(first.created, 1);
  assert.equal(second.skipped, 1);
  assert.equal(f.writes.length, 1);
});
