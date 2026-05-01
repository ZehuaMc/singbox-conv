import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const ROOT_DIR = path.resolve(import.meta.dirname, '..');
export const DATA_DIR = path.join(ROOT_DIR, 'data');
export const TEMPLATE_PATH = process.env.TEMPLATE_PATH
  ? path.resolve(process.env.TEMPLATE_PATH)
  : path.join(ROOT_DIR, 'config.json');
export const EXAMPLE_TEMPLATE_PATH = path.join(ROOT_DIR, 'config.example.json');
export const SOURCES_PATH = process.env.SOURCES_PATH
  ? path.resolve(process.env.SOURCES_PATH)
  : path.join(DATA_DIR, 'sources.json');
export const SUBSCRIPTION_CACHE_DIR = process.env.SUBSCRIPTION_CACHE_DIR
  ? path.resolve(process.env.SUBSCRIPTION_CACHE_DIR)
  : path.join(DATA_DIR, 'subscription-cache');
export const TOKEN_PATH = process.env.TOKEN_PATH
  ? path.resolve(process.env.TOKEN_PATH)
  : path.join(DATA_DIR, 'token.txt');

export const PORT = Number(process.env.PORT || 3000);
export const HOST = process.env.HOST || '0.0.0.0';
export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';
export const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS || 12 * 60 * 60 * 1000);
export const FETCH_TIMEOUT_MS = Number(process.env.FETCH_TIMEOUT_MS || 15000);

export async function ensureDataDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

export async function getSubscriptionToken() {
  if (process.env.SUB_TOKEN) {
    return process.env.SUB_TOKEN.trim();
  }

  await ensureDataDir();
  try {
    const existing = await fs.readFile(TOKEN_PATH, 'utf8');
    const token = existing.trim();
    if (token) {
      return token;
    }
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }

  const token = crypto.randomBytes(24).toString('base64url');
  await fs.writeFile(TOKEN_PATH, `${token}\n`, { mode: 0o600 });
  return token;
}
