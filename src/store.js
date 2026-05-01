import fs from 'node:fs/promises';
import { ensureDataDir, SOURCES_PATH } from './config.js';

export async function readSources() {
  await ensureDataDir();
  try {
    const content = await fs.readFile(SOURCES_PATH, 'utf8');
    const sources = JSON.parse(content);
    if (!Array.isArray(sources)) {
      return [];
    }
    return sources
      .filter((source) => source && typeof source === 'object')
      .map((source) => ({
        id: String(source.id || ''),
        name: String(source.name || ''),
        url: String(source.url || ''),
        enabled: source.enabled !== false,
      }))
      .filter((source) => source.id && source.name && source.url);
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

export async function writeSources(sources) {
  await ensureDataDir();
  await fs.writeFile(SOURCES_PATH, `${JSON.stringify(sources, null, 2)}\n`);
}
