#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const API = 'https://api.dingtalk.com';

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`缺少环境变量 ${name}`);
  return value;
}

function jsonBody(text, label) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`${label} 返回了非 JSON 内容`);
  }
}

async function requestJson(url, options, label, attempts = 3) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const response = await fetch(url, options);
      const text = await response.text();
      if (!response.ok) {
        const detail = text.slice(0, 300).replace(/\s+/g, ' ');
        if (attempt < attempts && (response.status === 429 || response.status >= 500)) {
          await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
          continue;
        }
        throw new Error(`${label} 失败 HTTP ${response.status}: ${detail}`);
      }
      return jsonBody(text, label);
    } catch (error) {
      lastError = error;
      if (attempt < attempts && error instanceof TypeError) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        continue;
      }
      if (attempt >= attempts) break;
    }
  }
  throw lastError || new Error(`${label} 失败`);
}

async function getAccessToken(appKey, appSecret) {
  const result = await requestJson(
    `${API}/v1.0/oauth2/accessToken`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ appKey, appSecret }),
    },
    '获取钉钉 accessToken',
  );
  if (!result.accessToken) throw new Error('获取钉钉 accessToken 返回为空');
  return result.accessToken;
}

function authHeaders(token) {
  return { 'x-acs-dingtalk-access-token': token };
}

async function resolveParentUuid(token, spaceId, parentId, operatorId) {
  const url = new URL(`${API}/v2.0/doc/dentries/${encodeURIComponent(parentId)}/queryDentryUuid`);
  url.searchParams.set('spaceId', spaceId);
  url.searchParams.set('operatorId', operatorId);
  const result = await requestJson(url, { headers: authHeaders(token) }, '解析钉盘目标目录');
  if (!result.dentryUuid) throw new Error('目标目录没有返回 dentryUuid');
  return result.dentryUuid;
}

async function listChildren(token, spaceId, parentId, operatorId) {
  const children = [];
  let nextToken = '';
  do {
    const url = new URL(`${API}/v1.0/storage/spaces/${encodeURIComponent(spaceId)}/dentries`);
    url.searchParams.set('parentId', parentId);
    url.searchParams.set('maxResults', '50');
    url.searchParams.set('orderBy', 'NAME');
    url.searchParams.set('order', 'ASC');
    url.searchParams.set('unionId', operatorId);
    if (nextToken) url.searchParams.set('nextToken', nextToken);
    const result = await requestJson(url, { headers: authHeaders(token) }, '读取钉盘目标目录');
    children.push(...(Array.isArray(result.dentries) ? result.dentries : []));
    nextToken = result.nextToken || '';
  } while (nextToken);
  return children;
}

async function uploadFile(token, parentUuid, operatorId, fileName, fileSize, filePath) {
  const infoUrl = new URL(`${API}/v2.0/storage/spaces/files/${encodeURIComponent(parentUuid)}/uploadInfos/query`);
  infoUrl.searchParams.set('unionId', operatorId);
  const info = await requestJson(
    infoUrl,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({
        protocol: 'HEADER_SIGNATURE',
        option: {
          storageDriver: 'DINGTALK',
          preCheckParam: { size: fileSize, name: fileName },
        },
      }),
    },
    '获取钉盘上传信息',
  );

  const uploadInfo = info.headerSignatureInfo;
  const resourceUrl = uploadInfo?.resourceUrls?.[0];
  if (!info.uploadKey || !resourceUrl || !uploadInfo.headers) {
    throw new Error('钉钉上传信息缺少 uploadKey、resourceUrl 或签名 headers');
  }

  const headers = { ...uploadInfo.headers, 'content-type': '' };
  const content = await fs.readFile(filePath);
  const put = await fetch(resourceUrl, { method: 'PUT', headers, body: content });
  if (!put.ok) {
    const detail = (await put.text()).slice(0, 300).replace(/\s+/g, ' ');
    throw new Error(`上传文件内容失败 HTTP ${put.status}: ${detail}`);
  }

  const commitUrl = new URL(`${API}/v2.0/storage/spaces/files/${encodeURIComponent(parentUuid)}/commit`);
  commitUrl.searchParams.set('unionId', operatorId);
  const committed = await requestJson(
    commitUrl,
    {
      method: 'POST',
      headers: { ...authHeaders(token), 'content-type': 'application/json' },
      body: JSON.stringify({ uploadKey: info.uploadKey, name: fileName }),
    },
    '提交钉盘文件',
  );
  return committed.dentry || committed;
}

async function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  const data = await fs.readFile(filePath);
  hash.update(data);
  return hash.digest('hex');
}

async function main() {
  const appKey = required('DINGTALK_APP_KEY');
  const appSecret = required('DINGTALK_APP_SECRET');
  const operatorId = required('DINGTALK_OPERATOR_ID');
  const spaceId = required('DINGTALK_SPACE_ID');
  const parentId = required('DINGTALK_PARENT_DENTRY_ID');
  const filePath = path.resolve(required('DINGTALK_FILE_PATH'));
  const file = await fs.stat(filePath);
  if (!file.isFile() || file.size <= 0) throw new Error(`待上传文件无效: ${filePath}`);

  const fileName = path.basename(filePath);
  if (!/^App-TuBu-.*\.7z$/i.test(fileName)) throw new Error(`不是受支持的发布包: ${fileName}`);

  const token = await getAccessToken(appKey, appSecret);
  const parentUuid = await resolveParentUuid(token, spaceId, parentId, operatorId);
  const children = await listChildren(token, spaceId, parentId, operatorId);
  const existing = children.find((item) => item.name === fileName || item.fileName === fileName);
  if (existing) {
    const remoteSize = Number(existing.size ?? existing.sizeBytes ?? -1);
    if (remoteSize < 0 || remoteSize === file.size) {
      console.log(`钉盘已存在同名发布包，跳过上传: ${fileName}`);
      console.log(`DINGTALK_UPLOAD_RESULT=${JSON.stringify({ status: 'already-exists', name: fileName, size: file.size })}`);
      return;
    }
    throw new Error(`钉盘已有同名但大小不同的文件: ${fileName}`);
  }

  if (process.env.DINGTALK_DRY_RUN === '1') {
    console.log(`DINGTALK_UPLOAD_RESULT=${JSON.stringify({ status: 'dry-run', name: fileName, size: file.size })}`);
    return;
  }

  await uploadFile(token, parentUuid, operatorId, fileName, file.size, filePath);
  const verified = (await listChildren(token, spaceId, parentId, operatorId)).find(
    (item) => item.name === fileName || item.fileName === fileName,
  );
  if (!verified) throw new Error(`上传后未在目标目录读到文件: ${fileName}`);
  const verifiedSize = Number(verified.size ?? verified.sizeBytes ?? -1);
  if (verifiedSize >= 0 && verifiedSize !== file.size) {
    throw new Error(`上传后文件大小不一致: local=${file.size}, remote=${verifiedSize}`);
  }

  const digest = await sha256(filePath);
  console.log(`钉盘上传并校验成功: ${fileName} (${file.size} bytes)`);
  console.log(`DINGTALK_UPLOAD_RESULT=${JSON.stringify({ status: 'uploaded', name: fileName, size: file.size, sha256: digest })}`);
}

main().catch((error) => {
  console.error(`[钉盘上传失败] ${error.message}`);
  process.exitCode = 1;
});
