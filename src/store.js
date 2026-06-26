import fs from 'node:fs/promises';
import path from 'node:path';
import { ensureDataDir, SOURCES_PATH } from './config.js';

export async function readSettings() {
  await ensureDataDir();
  try {
    const content = await fs.readFile(sourcesPath(), 'utf8');
    const settings = JSON.parse(content);
    if (Array.isArray(settings)) {
      return {
        sources: normalizePersistedSources(settings),
        manualOutbounds: [],
      };
    }
    if (!settings || typeof settings !== 'object') {
      return emptySettings();
    }
    return {
      sources: normalizePersistedSources(settings.sources),
      manualOutbounds: normalizePersistedManualOutbounds(settings.manualOutbounds),
    };
  } catch (error) {
    if (error.code === 'ENOENT') {
      return emptySettings();
    }
    throw error;
  }
}

export async function writeSettings(settings) {
  await ensureDataDir();
  const next = {
    sources: normalizePersistedSources(settings?.sources),
    manualOutbounds: normalizePersistedManualOutbounds(settings?.manualOutbounds),
  };
  await fs.mkdir(path.dirname(sourcesPath()), { recursive: true });
  await fs.writeFile(sourcesPath(), `${JSON.stringify(next, null, 2)}\n`);
}

export async function readSources() {
  const settings = await readSettings();
  return settings.sources;
}

export async function writeSources(sources) {
  await writeSettings({ sources, manualOutbounds: [] });
}

function emptySettings() {
  return {
    sources: [],
    manualOutbounds: [],
  };
}

function normalizePersistedSources(sources) {
  if (!Array.isArray(sources)) {
    return [];
  }
  return sources
    .filter((source) => source && typeof source === 'object')
    .map((source) => {
      const { filterPattern, excludeFilterPattern } = normalizePersistedSourceFilters(source);
      return {
        id: String(source.id || ''),
        name: String(source.name || ''),
        url: String(source.url || ''),
        enabled: source.enabled !== false,
        filterPattern,
        excludeFilterPattern,
      };
    })
    .filter((source) => source.id && source.name && source.url);
}

function normalizePersistedSourceFilters(source) {
  let filterPattern = String(source.filterPattern || '').trim();
  let excludeFilterPattern = String(source.excludeFilterPattern || '').trim();
  if (source.filterMode === 'exclude' && filterPattern && !excludeFilterPattern) {
    excludeFilterPattern = filterPattern;
    filterPattern = '';
  }
  return { filterPattern, excludeFilterPattern };
}

function normalizePersistedManualOutbounds(manualOutbounds) {
  if (!Array.isArray(manualOutbounds)) {
    return [];
  }
  return manualOutbounds
    .filter((item) => item && typeof item === 'object')
    .map((item) => {
      const outbound = isPlainObject(item.outbound) ? { ...item.outbound } : {};
      delete outbound.detour;
      return {
        id: String(item.id || ''),
        enabled: item.enabled !== false,
        direct: item.direct === true,
        includeInDetour: item.includeInDetour !== false,
        outbound,
      };
    })
    .filter((item) => item.id && isPlainObject(item.outbound));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sourcesPath() {
  return process.env.SOURCES_PATH
    ? path.resolve(process.env.SOURCES_PATH)
    : SOURCES_PATH;
}
