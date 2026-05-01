import fs from 'node:fs/promises';
import { EXAMPLE_TEMPLATE_PATH, FETCH_TIMEOUT_MS, TEMPLATE_PATH } from './config.js';
import { parseSubscriptionText } from './parse.js';

const REGION_GROUPS = [
  {
    key: 'hongkong',
    label: '香港',
    pattern: /(香港|港|hk|hong\s*kong|hongkong)/i,
  },
  {
    key: 'japan',
    label: '日本',
    pattern: /(日本|日|jp|japan|tokyo|osaka)/i,
  },
  {
    key: 'apac',
    label: '亚太',
    pattern: /(台湾|台灣|新加坡|韩国|韓国|南韩|越南|泰国|马来|菲律宾|澳大利亚|澳洲|印尼|印度|tw|taiwan|sg|singapore|kr|korea|vn|vietnam|th|thai|my|malaysia|ph|philippines|au|australia|id|indonesia|in|india)/i,
  },
  {
    key: 'us',
    label: '美国',
    pattern: /(美国|美國|美|us|usa|united\s*states|america|los\s*angeles|san\s*jose|new\s*york|seattle|dallas)/i,
  },
  {
    key: 'other',
    label: '其他',
    pattern: null,
  },
];

const MANUAL_TAG = '🚀 手动选择';
const DIRECT_TAG = 'direct-out';
const COMPAT_SELECTOR_TAGS = ['🏠 家宽', '📠 电报', '🚨 Block', '🔦 Google'];

export async function buildConfigFromSources(sources) {
  const template = await readTemplate();
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const { outbounds, warnings, stats } = await buildOutbounds(enabledSources, template);
  return {
    config: {
      ...template,
      outbounds,
    },
    warnings,
    stats,
  };
}

export async function previewSources(sources) {
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const warnings = [];
  const previews = [];

  for (const source of enabledSources) {
    try {
      const text = await fetchText(source.url);
      const parsed = parseSubscriptionText(text, source.name);
      previews.push({
        id: source.id,
        name: source.name,
        url: source.url,
        enabled: true,
        nodes: parsed.outbounds.length,
      });
      warnings.push(...parsed.warnings);
    } catch (error) {
      previews.push({
        id: source.id,
        name: source.name,
        url: source.url,
        enabled: true,
        nodes: 0,
        error: error.message,
      });
      warnings.push(`${source.name}: ${error.message}`);
    }
  }

  for (const source of sources.filter((item) => item.enabled === false)) {
    previews.push({
      id: source.id,
      name: source.name,
      url: source.url,
      enabled: false,
      nodes: 0,
    });
  }

  return { sources: previews, warnings };
}

async function buildOutbounds(sources, template) {
  const warnings = [];
  const nodeOutbounds = [];
  const sourceGroups = [];
  const usedTags = new Set([DIRECT_TAG]);
  let totalNodes = 0;

  for (const source of sources) {
    try {
      const text = await fetchText(source.url);
      const parsed = parseSubscriptionText(text, source.name);
      warnings.push(...parsed.warnings);

      const sourceNodes = parsed.outbounds.map((outbound) => {
        const next = structuredClone(outbound);
        next.tag = uniqueTag(`${source.name} / ${next.tag || next.server || next.type}`, usedTags);
        return next;
      });

      if (sourceNodes.length === 0) {
        warnings.push(`${source.name}: no usable nodes`);
        continue;
      }

      totalNodes += sourceNodes.length;
      nodeOutbounds.push(...sourceNodes);
      sourceGroups.push(...buildSourceSelectors(source.name, sourceNodes, usedTags));
    } catch (error) {
      warnings.push(`${source.name}: ${error.message}`);
    }
  }

  const allGroupTags = sourceGroups.filter((group) => group.kind === 'source').map((group) => group.selector.tag);
  const fallback = allGroupTags.length > 0 ? allGroupTags : [DIRECT_TAG];
  const selectors = [
    {
      type: 'selector',
      tag: MANUAL_TAG,
      outbounds: fallback,
      default: fallback[0],
    },
    ...sourceGroups.map((group) => group.selector),
  ];

  for (const tag of collectReferencedOutboundTags(template)) {
    if (tag === DIRECT_TAG || tag === MANUAL_TAG || selectors.some((selector) => selector.tag === tag)) {
      continue;
    }
    selectors.push({
      type: 'selector',
      tag,
      outbounds: buildCompatOutbounds(tag, allGroupTags),
      default: MANUAL_TAG,
    });
  }

  for (const tag of COMPAT_SELECTOR_TAGS) {
    if (!selectors.some((selector) => selector.tag === tag)) {
      selectors.push({
        type: 'selector',
        tag,
        outbounds: buildCompatOutbounds(tag, allGroupTags),
        default: MANUAL_TAG,
      });
    }
  }

  return {
    outbounds: [
      {
        type: 'direct',
        tag: DIRECT_TAG,
      },
      ...selectors,
      ...nodeOutbounds,
    ],
    warnings,
    stats: {
      sourceCount: sources.length,
      nodeCount: totalNodes,
      selectorCount: selectors.length,
    },
  };
}

function buildSourceSelectors(sourceName, nodes, usedTags) {
  const result = [];
  const regionSelectors = [];

  for (const region of REGION_GROUPS) {
    const regionNodes = nodes.filter((node) => classifyRegion(node.tag) === region.key);
    if (regionNodes.length === 0) {
      continue;
    }
    const tag = uniqueTag(`${sourceName} / ${region.label}`, usedTags);
    regionSelectors.push(tag);
    result.push({
      kind: 'region',
      selector: {
        type: 'selector',
        tag,
        outbounds: regionNodes.map((node) => node.tag),
        default: regionNodes[0].tag,
      },
    });
  }

  const sourceTag = uniqueTag(sourceName, usedTags);
  const outbounds = regionSelectors.length > 0 ? regionSelectors : nodes.map((node) => node.tag);
  result.unshift({
    kind: 'source',
    selector: {
      type: 'selector',
      tag: sourceTag,
      outbounds,
      default: outbounds[0],
    },
  });
  return result;
}

function classifyRegion(tag) {
  for (const region of REGION_GROUPS) {
    if (region.pattern && region.pattern.test(tag)) {
      return region.key;
    }
  }
  return 'other';
}

function buildCompatOutbounds(tag, sourceGroupTags) {
  const outbounds = [MANUAL_TAG];
  if (tag === '🔦 Google') {
    outbounds.push(...sourceGroupTags.filter((groupTag) => /(美国|美國|us|usa|america)/i.test(groupTag)));
  } else if (tag === '🏠 家宽') {
    outbounds.push(...sourceGroupTags);
  } else if (tag === '📠 电报' || tag === '🚨 Block') {
    outbounds.push(...sourceGroupTags);
  }
  if (outbounds.length === 1) {
    outbounds.push(DIRECT_TAG);
  }
  return [...new Set(outbounds)];
}

function collectReferencedOutboundTags(template) {
  const tags = new Set();
  walk(template.dns, (key, value) => {
    if (key === 'detour' && typeof value === 'string') {
      tags.add(value);
    }
  });
  walk(template.route, (key, value) => {
    if ((key === 'outbound' || key === 'download_detour') && typeof value === 'string') {
      tags.add(value);
    }
  });
  walk(template.experimental, (key, value) => {
    if (key.endsWith('_detour') && typeof value === 'string') {
      tags.add(value);
    }
  });
  return tags;
}

function walk(value, visitor, key = '') {
  visitor(key, value);
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor, key);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      walk(childValue, visitor, childKey);
    }
  }
}

async function readTemplate() {
  let content;
  try {
    content = await fs.readFile(TEMPLATE_PATH, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
    content = await fs.readFile(EXAMPLE_TEMPLATE_PATH, 'utf8');
  }
  return JSON.parse(content);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'sing-box-conv/1.0',
        Accept: 'text/plain, application/json, */*',
      },
    });
    if (!response.ok) {
      throw new Error(`upstream returned HTTP ${response.status}`);
    }
    return await response.text();
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error(`fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function uniqueTag(base, usedTags) {
  const clean = sanitizeTag(base);
  let tag = clean;
  let index = 2;
  while (usedTags.has(tag)) {
    tag = `${clean} ${index}`;
    index += 1;
  }
  usedTags.add(tag);
  return tag;
}

function sanitizeTag(value) {
  const clean = String(value || '').replace(/\s+/g, ' ').trim();
  return clean || 'node';
}
