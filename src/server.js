import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';
import {
  ADMIN_PASSWORD,
  HOST,
  PORT,
  ROOT_DIR,
  SESSION_TTL_MS,
  ensureDataDir,
  getSubscriptionToken,
} from './config.js';
import { buildConfigFromSources, previewSources } from './generator.js';
import { appendLog, clearLogs, readLogs } from './logs.js';
import { readSettings, writeSettings } from './store.js';
import { readTemplateText, writeTemplateText } from './template.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const sessions = new Map();

const token = await getSubscriptionToken();
await ensureDataDir();

const server = http.createServer(async (req, res) => {
  const requestContext = createRequestContext(req);
  trackResponseBytes(res, requestContext);
  res.on('finish', () => logRequestFinished(requestContext, res));

  try {
    await route(req, res, requestContext);
  } catch (error) {
    appendLog('error', '请求处理失败', {
      ...getRequestLogDetails(requestContext),
      error,
    });
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || 'internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  appendLog('info', '服务已启动', {
    host: HOST,
    port: PORT,
  });
  console.log(`sing-box-conv listening on http://${HOST}:${PORT}`);
  console.log(`subscription path: /sub/${token}/config.json`);
  if (!ADMIN_PASSWORD) {
    appendLog('warn', 'ADMIN_PASSWORD 未设置，管理登录接受任意非空密码');
    console.log('ADMIN_PASSWORD is not set; management login accepts any non-empty password.');
  }
});

async function route(req, res, requestContext) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';
  requestContext.path = sanitizeRequestPath(url.pathname);
  requestContext.queryKeys = [...url.searchParams.keys()];

  if (method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/login') {
    await handleLogin(req, res, requestContext);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/logout') {
    handleLogout(req, res, requestContext);
    return;
  }

  if (url.pathname === '/api/session') {
    requireAuth(req, res, requestContext);
    if (res.writableEnded) return;
    sendJson(res, 200, { ok: true, subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (url.pathname === '/api/sources') {
    requireAuth(req, res, requestContext);
    if (res.writableEnded) return;
    await handleSources(req, res, method, requestContext);
    return;
  }

  if (url.pathname === '/api/preview') {
    requireAuth(req, res, requestContext);
    if (res.writableEnded) return;
    await handlePreview(req, res, method, requestContext);
    return;
  }

  if (url.pathname === '/api/logs') {
    requireAuth(req, res, requestContext);
    if (res.writableEnded) return;
    handleLogs(res, method);
    return;
  }

  if (url.pathname === '/api/template') {
    requireAuth(req, res, requestContext);
    if (res.writableEnded) return;
    await handleTemplate(req, res, method, requestContext);
    return;
  }

  if (method === 'GET' && url.pathname === `/sub/${token}/config.json`) {
    const settings = await readSettings();
    const startedAt = Date.now();
    let result;
    appendLog('info', '订阅配置生成开始', {
      ...getRequestLogDetails(requestContext),
      sourceCount: settings.sources.length,
      enabledSourceCount: settings.sources.filter((source) => source.enabled !== false).length,
      manualOutboundCount: settings.manualOutbounds.length,
      enabledManualOutboundCount: settings.manualOutbounds.filter((item) => item.enabled !== false).length,
      sources: summarizeSources(settings.sources),
      manualOutbounds: summarizeManualOutbounds(settings.manualOutbounds),
    });
    try {
      result = await buildConfigFromSources(settings.sources, settings.manualOutbounds);
    } catch (error) {
      appendLog('error', '订阅配置生成失败', {
        ...getRequestLogDetails(requestContext),
        sourceCount: settings.sources.length,
        manualOutboundCount: settings.manualOutbounds.length,
        error,
      });
      throw error;
    }
    appendLog(result.warnings.length ? 'warn' : 'info', '订阅配置生成完成', {
      ...getRequestLogDetails(requestContext),
      sourceCount: result.stats.sourceCount,
      nodeCount: result.stats.nodeCount,
      manualOutboundCount: result.stats.manualOutboundCount,
      selectorCount: result.stats.selectorCount,
      warningCount: result.warnings.length,
      warnings: result.warnings.slice(0, 10),
      sources: result.stats.sources || [],
      manualOutbounds: result.stats.manualOutbounds || [],
      durationMs: Date.now() - startedAt,
    });
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Node-Count': String(result.stats.nodeCount),
      'X-Source-Count': String(result.stats.sourceCount),
      'X-Manual-Outbound-Count': String(result.stats.manualOutboundCount),
      'X-Converter-Warnings': encodeURIComponent(result.warnings.slice(0, 5).join(' | ')),
    });
    res.end(`${JSON.stringify(result.config, null, 2)}\n`);
    return;
  }

  if (url.pathname.startsWith('/sub/')) {
    appendLog('warn', '订阅令牌无效', getRequestLogDetails(requestContext));
    sendJson(res, 403, { error: 'invalid subscription token' });
    return;
  }

  if (method === 'GET') {
    await serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

async function handleLogin(req, res, requestContext) {
  const body = await readJsonBody(req);
  const password = String(body.password || '');
  const accepted = ADMIN_PASSWORD ? password === ADMIN_PASSWORD : password.length > 0;
  if (!accepted) {
    appendLog('warn', '登录失败', {
      ...getRequestLogDetails(requestContext),
      adminPasswordConfigured: Boolean(ADMIN_PASSWORD),
      passwordPresent: password.length > 0,
      passwordLength: password.length,
    });
    sendJson(res, 401, { error: 'invalid password' });
    return;
  }

  const sessionId = crypto.randomBytes(24).toString('base64url');
  sessions.set(sessionId, Date.now() + SESSION_TTL_MS);
  requestContext.authenticated = true;
  res.setHeader('Set-Cookie', cookie('sid', sessionId, { maxAge: Math.floor(SESSION_TTL_MS / 1000) }));
  appendLog('info', '登录成功', {
    ...getRequestLogDetails(requestContext),
    sessionTtlMs: SESSION_TTL_MS,
    activeSessionCount: sessions.size,
  });
  sendJson(res, 200, { ok: true, subscriptionPath: `/sub/${token}/config.json` });
}

function handleLogout(req, res, requestContext) {
  const sid = parseCookies(req.headers.cookie || '').sid;
  const hadSession = Boolean(sid && sessions.has(sid));
  if (sid) {
    sessions.delete(sid);
  }
  res.setHeader('Set-Cookie', cookie('sid', '', { maxAge: 0 }));
  appendLog('info', '已退出登录', {
    ...getRequestLogDetails(requestContext),
    hadSession,
    activeSessionCount: sessions.size,
  });
  sendJson(res, 200, { ok: true });
}

async function handleSources(req, res, method, requestContext) {
  if (method === 'GET') {
    const settings = await readSettings();
    appendLog('info', '订阅设置已读取', {
      ...getRequestLogDetails(requestContext),
      sourceCount: settings.sources.length,
      enabledSourceCount: settings.sources.filter((source) => source.enabled !== false).length,
      manualOutboundCount: settings.manualOutbounds.length,
      enabledManualOutboundCount: settings.manualOutbounds.filter((item) => item.enabled !== false).length,
      sources: summarizeSources(settings.sources),
      manualOutbounds: summarizeManualOutbounds(settings.manualOutbounds),
    });
    sendJson(res, 200, { ...settings, subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const sources = normalizeSources(body.sources);
    const manualOutbounds = normalizeManualOutbounds(body.manualOutbounds);
    await writeSettings({ sources, manualOutbounds });
    appendLog('info', '订阅设置已保存', {
      ...getRequestLogDetails(requestContext),
      sourceCount: sources.length,
      enabledSourceCount: sources.filter((source) => source.enabled !== false).length,
      manualOutboundCount: manualOutbounds.length,
      enabledManualOutboundCount: manualOutbounds.filter((item) => item.enabled !== false).length,
      sources: summarizeSources(sources),
      manualOutbounds: summarizeManualOutbounds(manualOutbounds),
    });
    sendJson(res, 200, { sources, manualOutbounds, subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (method === 'DELETE') {
    await writeSettings({ sources: [], manualOutbounds: [] });
    appendLog('info', '订阅设置已清空', getRequestLogDetails(requestContext));
    sendJson(res, 200, { sources: [], manualOutbounds: [] });
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

async function handlePreview(req, res, method, requestContext) {
  if (method === 'GET') {
    const settings = await readSettings();
    const preview = await buildPreview(settings.sources, settings.manualOutbounds, requestContext);
    sendJson(res, 200, preview);
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const sources = normalizeSources(body.sources);
    const manualOutbounds = normalizeManualOutbounds(body.manualOutbounds);
    const preview = await buildPreview(sources, manualOutbounds, requestContext);
    sendJson(res, 200, preview);
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

function handleLogs(res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { logs: readLogs() });
    return;
  }

  if (method === 'DELETE') {
    clearLogs();
    sendJson(res, 200, { logs: [] });
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

async function handleTemplate(req, res, method, requestContext) {
  if (method === 'GET') {
    const template = await readTemplateText();
    appendLog('info', '配置模板已读取', {
      ...getRequestLogDetails(requestContext),
      usingExample: template.usingExample,
      templateBytes: Buffer.byteLength(template.content, 'utf8'),
    });
    sendJson(res, 200, template);
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const template = await writeTemplateText(body.content);
    appendLog('info', '配置模板已保存', {
      ...getRequestLogDetails(requestContext),
      templateBytes: Buffer.byteLength(template.content, 'utf8'),
    });
    sendJson(res, 200, template);
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

async function buildPreview(sources, manualOutbounds, requestContext) {
  appendLog('info', '预览开始', {
    ...getRequestLogDetails(requestContext),
    sourceCount: sources.length,
    enabledSourceCount: sources.filter((source) => source.enabled !== false).length,
    manualOutboundCount: manualOutbounds.length,
    enabledManualOutboundCount: manualOutbounds.filter((item) => item.enabled !== false).length,
    sources: summarizeSources(sources),
    manualOutbounds: summarizeManualOutbounds(manualOutbounds),
  });
  const startedAt = Date.now();
  try {
    const preview = await previewSources(sources, manualOutbounds);
    appendLog(preview.warnings.length ? 'warn' : 'info', '预览完成', {
      ...getRequestLogDetails(requestContext),
      sourceCount: preview.sources.length,
      manualOutboundCount: preview.manualOutbounds.length,
      nodeCount: preview.sources.reduce((total, source) => total + source.nodes, 0),
      warningCount: preview.warnings.length,
      warnings: preview.warnings.slice(0, 10),
      sources: preview.sources.map((source) => ({
        id: source.id,
        name: source.name,
        enabled: source.enabled,
        nodeCount: source.nodes,
        status: source.error ? 'error' : 'ok',
        error: source.error || '',
      })),
      manualOutbounds: preview.manualOutbounds.map((item) => ({
        id: item.id,
        enabled: item.enabled,
        type: item.type,
        tag: item.tag,
        detour: item.detour,
        status: item.error ? 'error' : 'ok',
        error: item.error || '',
      })),
      durationMs: Date.now() - startedAt,
    });
    return preview;
  } catch (error) {
    appendLog('error', '预览失败', {
      ...getRequestLogDetails(requestContext),
      sourceCount: sources.length,
      manualOutboundCount: manualOutbounds.length,
      durationMs: Date.now() - startedAt,
      error,
    });
    throw error;
  }
}

function normalizeSources(sources) {
  if (!Array.isArray(sources)) {
    throw new HttpError(400, 'sources must be an array');
  }

  return sources.map((source, index) => {
    const name = String(source.name || '').trim();
    const url = String(source.url || '').trim();
    if (!name) {
      throw new HttpError(400, `source #${index + 1} missing name`);
    }
    if (!/^https?:\/\//i.test(url)) {
      throw new HttpError(400, `source #${index + 1} must use http(s) URL`);
    }
    return {
      id: source.id ? String(source.id) : crypto.randomUUID(),
      name,
      url,
      enabled: source.enabled !== false,
    };
  });
}

function normalizeManualOutbounds(manualOutbounds) {
  if (!Array.isArray(manualOutbounds)) {
    return [];
  }

  return manualOutbounds.map((item, index) => {
    if (!item || typeof item !== 'object') {
      throw new HttpError(400, `manual outbound #${index + 1} must be an object`);
    }

    const outbound = normalizeManualOutboundObject(item.outbound, index);
    const tag = String(outbound.tag || '').trim();
    const type = String(outbound.type || '').trim();
    if (!tag) {
      throw new HttpError(400, `manual outbound #${index + 1} missing outbound.tag`);
    }
    if (!type) {
      throw new HttpError(400, `manual outbound #${index + 1} missing outbound.type`);
    }
    const outboundDetour = typeof outbound.detour === 'string' ? outbound.detour.trim() : '';
    const legacyRegionDetour = String(item.region || '').trim();
    const detour = outboundDetour || legacyRegionDetour;
    const normalizedOutbound = {
      ...outbound,
      tag,
      type,
    };
    if (detour) {
      normalizedOutbound.detour = detour;
    } else {
      delete normalizedOutbound.detour;
    }

    return {
      id: item.id ? String(item.id) : crypto.randomUUID(),
      enabled: item.enabled !== false,
      outbound: normalizedOutbound,
    };
  });
}

function normalizeManualOutboundObject(outbound, index) {
  if (typeof outbound === 'string') {
    try {
      outbound = JSON.parse(outbound);
    } catch {
      throw new HttpError(400, `manual outbound #${index + 1} contains invalid JSON`);
    }
  }

  if (!outbound || typeof outbound !== 'object' || Array.isArray(outbound)) {
    throw new HttpError(400, `manual outbound #${index + 1} must include an outbound object`);
  }

  return outbound;
}

function requireAuth(req, res, requestContext) {
  const sid = parseCookies(req.headers.cookie || '').sid;
  if (!sid || !sessions.has(sid)) {
    appendLog('warn', '认证失败', {
      ...getRequestLogDetails(requestContext),
      reason: sid ? 'unknown session' : 'missing session',
    });
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const expiresAt = sessions.get(sid);
  if (expiresAt <= Date.now()) {
    sessions.delete(sid);
    appendLog('warn', '认证失败', {
      ...getRequestLogDetails(requestContext),
      reason: 'expired session',
    });
    sendJson(res, 401, { error: 'session expired' });
    return;
  }
  requestContext.authenticated = true;
  requestContext.sessionExpiresInMs = expiresAt - Date.now();
  sessions.set(sid, Date.now() + SESSION_TTL_MS);
}

async function serveStatic(pathname, res) {
  const target = pathname === '/' ? '/index.html' : pathname;
  const resolved = path.resolve(PUBLIC_DIR, `.${target}`);
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: 'forbidden' });
    return;
  }

  try {
    const content = await fs.readFile(resolved);
    res.writeHead(200, {
      'Content-Type': contentType(resolved),
      'Cache-Control': 'no-store',
    });
    res.end(content);
  } catch (error) {
    if (error.code === 'ENOENT') {
      sendJson(res, 404, { error: 'not found' });
      return;
    }
    throw error;
  }
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 1024 * 1024) {
      throw new HttpError(413, 'request body too large');
    }
    chunks.push(chunk);
  }
  if (chunks.length === 0) {
    return {};
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid JSON body');
  }
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseCookies(header) {
  const result = {};
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    result[key] = decodeURIComponent(part.slice(index + 1).trim());
  }
  return result;
}

function cookie(name, value, { maxAge }) {
  const parts = [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAge}`,
  ];
  return parts.join('; ');
}

function contentType(file) {
  if (file.endsWith('.html')) return 'text/html; charset=utf-8';
  if (file.endsWith('.css')) return 'text/css; charset=utf-8';
  if (file.endsWith('.js')) return 'application/javascript; charset=utf-8';
  if (file.endsWith('.json')) return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

function sanitizeRequestPath(pathname) {
  return pathname.replace(/^\/sub\/[^/]+/, '/sub/<token>');
}

function createRequestContext(req) {
  return {
    id: crypto.randomUUID(),
    method: req.method || 'GET',
    path: getRequestPath(req),
    remoteAddress: req.socket?.remoteAddress || '',
    userAgent: String(req.headers['user-agent'] || '').slice(0, 300),
    referer: sanitizeReferer(req.headers.referer || req.headers.referrer || ''),
    startedAt: Date.now(),
    responseBytes: 0,
    authenticated: false,
  };
}

function getRequestPath(req) {
  try {
    return sanitizeRequestPath(new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname);
  } catch {
    return sanitizeRequestPath(req.url || '');
  }
}

function trackResponseBytes(res, requestContext) {
  const originalWrite = res.write;
  const originalEnd = res.end;

  res.write = function writeWithByteCount(chunk, ...args) {
    requestContext.responseBytes += getChunkByteLength(chunk);
    return originalWrite.call(this, chunk, ...args);
  };

  res.end = function endWithByteCount(chunk, ...args) {
    requestContext.responseBytes += getChunkByteLength(chunk);
    return originalEnd.call(this, chunk, ...args);
  };
}

function getChunkByteLength(chunk) {
  if (!chunk) {
    return 0;
  }
  if (Buffer.isBuffer(chunk)) {
    return chunk.length;
  }
  if (typeof chunk === 'string') {
    return Buffer.byteLength(chunk);
  }
  if (chunk instanceof Uint8Array) {
    return chunk.byteLength;
  }
  return 0;
}

function logRequestFinished(requestContext, res) {
  const statusCode = res.statusCode || 0;
  if (statusCode < 400 && requestContext.path === '/api/logs') {
    return;
  }
  if (statusCode < 400 && !shouldLogSuccessfulRequest(requestContext.path)) {
    return;
  }

  appendLog(statusCode >= 500 ? 'error' : statusCode >= 400 ? 'warn' : 'info', 'HTTP 请求完成', {
    ...getRequestLogDetails(requestContext),
    statusCode,
    durationMs: Date.now() - requestContext.startedAt,
    responseBytes: requestContext.responseBytes,
  });
}

function shouldLogSuccessfulRequest(pathname) {
  return pathname.startsWith('/api/') || pathname.startsWith('/sub/');
}

function getRequestLogDetails(requestContext) {
  return {
    requestId: requestContext.id,
    method: requestContext.method,
    path: requestContext.path,
    queryKeys: requestContext.queryKeys || [],
    remoteAddress: requestContext.remoteAddress,
    userAgent: requestContext.userAgent,
    referer: requestContext.referer,
    authenticated: requestContext.authenticated,
    sessionExpiresInMs: requestContext.sessionExpiresInMs,
  };
}

function sanitizeReferer(value) {
  if (!value) {
    return '';
  }
  try {
    const url = new URL(value);
    return `${url.origin}${sanitizeRequestPath(url.pathname)}`;
  } catch {
    return sanitizeRequestPath(String(value)).slice(0, 300);
  }
}

function summarizeSources(sources) {
  return sources.map((source) => ({
    id: source.id,
    name: source.name,
    enabled: source.enabled !== false,
    urlProtocol: getUrlProtocol(source.url),
    urlHost: getUrlHost(source.url),
  }));
}

function summarizeManualOutbounds(manualOutbounds) {
  return manualOutbounds.map((item) => ({
    id: item.id,
    enabled: item.enabled !== false,
    type: item.outbound?.type || '',
    tag: item.outbound?.tag || '',
    detour: typeof item.outbound?.detour === 'string' ? item.outbound.detour : '',
  }));
}

function getUrlProtocol(value) {
  try {
    return new URL(value).protocol.replace(/:$/, '');
  } catch {
    return '';
  }
}

function getUrlHost(value) {
  try {
    return new URL(value).host;
  } catch {
    return '';
  }
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
