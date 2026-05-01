import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { SUBSCRIPTION_CACHE_DIR } from './config.js';

export async function readSubscriptionCache(source) {
  try {
    const content = await fs.readFile(cachePath(source.url), 'utf8');
    const cache = JSON.parse(content);
    if (!cache || cache.url !== source.url || typeof cache.content !== 'string') {
      return null;
    }
    return {
      url: cache.url,
      name: String(cache.name || ''),
      fetchedAt: String(cache.fetchedAt || ''),
      content: cache.content,
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return null;
    }
    throw error;
  }
}

export async function writeSubscriptionCache(source, content) {
  await fs.mkdir(subscriptionCacheDir(), { recursive: true });
  const cache = {
    url: source.url,
    name: source.name,
    fetchedAt: new Date().toISOString(),
    content,
  };
  await fs.writeFile(cachePath(source.url), `${JSON.stringify(cache, null, 2)}\n`, { mode: 0o600 });
}

function cachePath(url) {
  const key = crypto.createHash('sha256').update(url).digest('hex');
  return path.join(subscriptionCacheDir(), `${key}.json`);
}

function subscriptionCacheDir() {
  return process.env.SUBSCRIPTION_CACHE_DIR
    ? path.resolve(process.env.SUBSCRIPTION_CACHE_DIR)
    : SUBSCRIPTION_CACHE_DIR;
}
