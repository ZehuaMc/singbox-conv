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
import { readSources, writeSources } from './store.js';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const sessions = new Map();

const token = await getSubscriptionToken();
await ensureDataDir();

const server = http.createServer(async (req, res) => {
  try {
    await route(req, res);
  } catch (error) {
    console.error(error);
    sendJson(res, error.status || 500, { error: error.message || 'internal server error' });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`sing-box-conv listening on http://${HOST}:${PORT}`);
  console.log(`subscription path: /sub/${token}/config.json`);
  if (!ADMIN_PASSWORD) {
    console.log('ADMIN_PASSWORD is not set; management login accepts any non-empty password.');
  }
});

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const method = req.method || 'GET';

  if (method === 'GET' && url.pathname === '/healthz') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (method === 'POST' && url.pathname === '/api/login') {
    await handleLogin(req, res);
    return;
  }

  if (method === 'POST' && url.pathname === '/api/logout') {
    handleLogout(req, res);
    return;
  }

  if (url.pathname === '/api/session') {
    requireAuth(req, res);
    if (res.writableEnded) return;
    sendJson(res, 200, { ok: true, subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (url.pathname === '/api/sources') {
    requireAuth(req, res);
    if (res.writableEnded) return;
    await handleSources(req, res, method);
    return;
  }

  if (method === 'GET' && url.pathname === '/api/preview') {
    requireAuth(req, res);
    if (res.writableEnded) return;
    const sources = await readSources();
    const preview = await previewSources(sources);
    sendJson(res, 200, preview);
    return;
  }

  if (method === 'GET' && url.pathname === `/sub/${token}/config.json`) {
    const sources = await readSources();
    const result = await buildConfigFromSources(sources);
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Node-Count': String(result.stats.nodeCount),
      'X-Source-Count': String(result.stats.sourceCount),
      'X-Converter-Warnings': encodeURIComponent(result.warnings.slice(0, 5).join(' | ')),
    });
    res.end(`${JSON.stringify(result.config, null, 2)}\n`);
    return;
  }

  if (url.pathname.startsWith('/sub/')) {
    sendJson(res, 403, { error: 'invalid subscription token' });
    return;
  }

  if (method === 'GET') {
    await serveStatic(url.pathname, res);
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
}

async function handleLogin(req, res) {
  const body = await readJsonBody(req);
  const password = String(body.password || '');
  const accepted = ADMIN_PASSWORD ? password === ADMIN_PASSWORD : password.length > 0;
  if (!accepted) {
    sendJson(res, 401, { error: 'invalid password' });
    return;
  }

  const sessionId = crypto.randomBytes(24).toString('base64url');
  sessions.set(sessionId, Date.now() + SESSION_TTL_MS);
  res.setHeader('Set-Cookie', cookie('sid', sessionId, { maxAge: Math.floor(SESSION_TTL_MS / 1000) }));
  sendJson(res, 200, { ok: true, subscriptionPath: `/sub/${token}/config.json` });
}

function handleLogout(req, res) {
  const sid = parseCookies(req.headers.cookie || '').sid;
  if (sid) {
    sessions.delete(sid);
  }
  res.setHeader('Set-Cookie', cookie('sid', '', { maxAge: 0 }));
  sendJson(res, 200, { ok: true });
}

async function handleSources(req, res, method) {
  if (method === 'GET') {
    sendJson(res, 200, { sources: await readSources(), subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (method === 'POST') {
    const body = await readJsonBody(req);
    const sources = normalizeSources(body.sources);
    await writeSources(sources);
    sendJson(res, 200, { sources, subscriptionPath: `/sub/${token}/config.json` });
    return;
  }

  if (method === 'DELETE') {
    await writeSources([]);
    sendJson(res, 200, { sources: [] });
    return;
  }

  sendJson(res, 405, { error: 'method not allowed' });
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

function requireAuth(req, res) {
  const sid = parseCookies(req.headers.cookie || '').sid;
  if (!sid || !sessions.has(sid)) {
    sendJson(res, 401, { error: 'unauthorized' });
    return;
  }
  const expiresAt = sessions.get(sid);
  if (expiresAt <= Date.now()) {
    sessions.delete(sid);
    sendJson(res, 401, { error: 'session expired' });
    return;
  }
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

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
