import { FETCH_TIMEOUT_MS } from './config.js';
import { readSubscriptionCache, writeSubscriptionCache } from './cache.js';
import { parseSubscriptionText } from './parse.js';
import { readTemplateJson } from './template.js';

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

const FIXED_REGION_LABELS = new Set(REGION_GROUPS.map((region) => region.label));
const MANUAL_TAG = '🚀 手动选择';
const DIRECT_TAG = 'direct-out';
const COMPAT_SELECTOR_TAGS = ['🏠 家宽', '📠 电报', '🚨 Block', '🔦 Google'];

export async function buildConfigFromSources(sources, manualOutbounds = []) {
  const template = await readTemplate();
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const enabledManualOutbounds = manualOutbounds.filter((item) => item.enabled !== false);
  const { outbounds, warnings, stats } = await buildOutbounds(
    enabledSources,
    enabledManualOutbounds,
    template,
  );
  return {
    config: {
      ...template,
      outbounds,
    },
    warnings,
    stats,
  };
}

export async function previewSources(sources, manualOutbounds = []) {
  const enabledSources = sources.filter((source) => source.enabled !== false);
  const warnings = [];
  const previews = [];

  for (const source of enabledSources) {
    try {
      const { text, warnings: fetchWarnings } = await fetchSubscriptionText(source);
      warnings.push(...fetchWarnings);
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

  const manualPreviews = [];
  for (const item of manualOutbounds) {
    const validation = validateManualOutbound(item);
    if (item.enabled !== false && !validation.ok) {
      warnings.push(`${item.id || 'manual outbound'}: ${validation.error}`);
    }
    manualPreviews.push({
      id: item.id,
      enabled: item.enabled !== false,
      tag: validation.ok ? validation.outbound.tag : '',
      type: validation.ok ? validation.outbound.type : '',
      detour: validation.ok && typeof validation.outbound.detour === 'string' ? validation.outbound.detour : '',
      error: validation.ok ? '' : validation.error,
    });
  }

  return { sources: previews, manualOutbounds: manualPreviews, warnings };
}

async function buildOutbounds(sources, manualOutbounds, template) {
  const warnings = [];
  const proxyOutbounds = [];
  const sourceGroups = [];
  const usedTags = new Set([
    DIRECT_TAG,
    MANUAL_TAG,
    ...FIXED_REGION_LABELS,
    ...COMPAT_SELECTOR_TAGS,
  ]);
  const regionBuckets = new Map(REGION_GROUPS.map((region) => [region.label, []]));
  const manualOutboundTags = [];
  const sourceStats = [];
  const manualOutboundStats = [];
  let totalNodes = 0;
  let totalManualOutbounds = 0;

  for (const source of sources) {
    const sourceStartedAt = Date.now();
    try {
      const { text, warnings: fetchWarnings } = await fetchSubscriptionText(source);
      warnings.push(...fetchWarnings);
      const parsed = parseSubscriptionText(text, source.name);
      warnings.push(...parsed.warnings);

      const sourceNodes = parsed.outbounds.map((outbound) => {
        const next = structuredClone(outbound);
        next.tag = uniqueTag(`${source.name} / ${next.tag || next.server || next.type}`, usedTags);
        return next;
      });

      if (sourceNodes.length === 0) {
        warnings.push(`${source.name}: no usable nodes`);
        sourceStats.push({
          id: source.id,
          name: source.name,
          status: 'empty',
          nodeCount: 0,
          warningCount: fetchWarnings.length + parsed.warnings.length + 1,
          textBytes: Buffer.byteLength(text, 'utf8'),
          cacheUsed: fetchWarnings.some((warning) => warning.includes('using cached subscription')),
          durationMs: Date.now() - sourceStartedAt,
        });
        continue;
      }

      totalNodes += sourceNodes.length;
      proxyOutbounds.push(...sourceNodes);
      const sourceSelectors = buildSourceSelectors(source.name, sourceNodes, usedTags);
      sourceGroups.push(...sourceSelectors);
      addSourceRegionsToBuckets(regionBuckets, sourceSelectors);
      sourceStats.push({
        id: source.id,
        name: source.name,
        status: 'ok',
        nodeCount: sourceNodes.length,
        selectorCount: sourceSelectors.length,
        warningCount: fetchWarnings.length + parsed.warnings.length,
        textBytes: Buffer.byteLength(text, 'utf8'),
        cacheUsed: fetchWarnings.some((warning) => warning.includes('using cached subscription')),
        regions: sourceSelectors
          .filter((group) => group.kind === 'region')
          .map((group) => ({
            tag: group.selector.tag,
            nodeCount: group.selector.outbounds.length,
          })),
        tagSamples: sourceNodes.slice(0, 5).map((node) => node.tag),
        durationMs: Date.now() - sourceStartedAt,
      });
    } catch (error) {
      warnings.push(`${source.name}: ${error.message}`);
      sourceStats.push({
        id: source.id,
        name: source.name,
        status: 'error',
        nodeCount: 0,
        error: error.message,
        durationMs: Date.now() - sourceStartedAt,
      });
    }
  }

  const manualTagRenames = new Map();
  for (const item of manualOutbounds) {
    const validation = validateManualOutbound(item);
    if (!validation.ok) {
      warnings.push(`${item.name || item.id || 'manual outbound'}: ${validation.error}`);
      manualOutboundStats.push({
        id: item.id,
        status: 'invalid',
        error: validation.error,
      });
      continue;
    }

    const next = structuredClone(validation.outbound);
    const originalTag = cleanTag(next.tag || next.server || next.type || `manual-${totalManualOutbounds + 1}`);
    const tag = uniqueTag(originalTag, usedTags);
    if (!manualTagRenames.has(originalTag)) {
      manualTagRenames.set(originalTag, tag);
    }
    next.tag = tag;
    proxyOutbounds.push(next);
    manualOutboundTags.push(tag);
    totalManualOutbounds += 1;
    manualOutboundStats.push({
      id: item.id,
      status: 'ok',
      type: next.type,
      originalTag,
      tag,
      renamed: tag !== originalTag,
      detour: typeof next.detour === 'string' ? next.detour : '',
    });
  }

  rewriteManualDetours(proxyOutbounds, manualTagRenames);

  const fixedRegionSelectors = [];
  const regionSelectorTags = [];
  for (const region of REGION_GROUPS) {
    const outbounds = regionBuckets.get(region.label);
    const resolved = outbounds && outbounds.length > 0 ? outbounds : [DIRECT_TAG];
    fixedRegionSelectors.push({
      type: 'selector',
      tag: region.label,
      outbounds: resolved,
      default: resolved[0],
    });
    regionSelectorTags.push(region.label);
  }

  const manualFallback = [...regionSelectorTags, ...manualOutboundTags];
  const selectors = [
    {
      type: 'selector',
      tag: MANUAL_TAG,
      outbounds: manualFallback,
      default: manualFallback[0],
    },
    ...fixedRegionSelectors,
    ...sourceGroups.map((group) => group.selector),
  ];

  for (const tag of collectReferencedOutboundTags(template)) {
    if (
      tag === DIRECT_TAG
      || tag === MANUAL_TAG
      || selectors.some((selector) => selector.tag === tag)
      || regionSelectorTags.includes(tag)
    ) {
      continue;
    }
    selectors.push({
      type: 'selector',
      tag,
      outbounds: buildCompatOutbounds(regionSelectorTags, manualOutboundTags),
      default: MANUAL_TAG,
    });
  }

  for (const tag of COMPAT_SELECTOR_TAGS) {
    if (!selectors.some((selector) => selector.tag === tag)) {
      selectors.push({
        type: 'selector',
        tag,
        outbounds: buildCompatOutbounds(regionSelectorTags, manualOutboundTags),
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
      ...proxyOutbounds,
    ],
    warnings,
    stats: {
      sourceCount: sources.length,
      manualOutboundCount: totalManualOutbounds,
      nodeCount: totalNodes,
      selectorCount: selectors.length,
      sources: sourceStats,
      manualOutbounds: manualOutboundStats,
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
      regionLabel: region.label,
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

function addSourceRegionsToBuckets(regionBuckets, sourceSelectors) {
  for (const group of sourceSelectors) {
    if (group.kind !== 'region') {
      continue;
    }
    if (!regionBuckets.has(group.regionLabel)) {
      regionBuckets.set(group.regionLabel, []);
    }
    regionBuckets.get(group.regionLabel).push(group.selector.tag);
  }
}

function validateManualOutbound(item) {
  if (!item || typeof item !== 'object') {
    return { ok: false, error: 'manual outbound must be an object' };
  }
  if (!item.outbound || typeof item.outbound !== 'object' || Array.isArray(item.outbound)) {
    return { ok: false, error: 'manual outbound must include an outbound object' };
  }

  const tag = cleanTag(item.outbound.tag);
  const type = cleanTag(item.outbound.type);
  if (!tag) {
    return { ok: false, error: 'manual outbound is missing tag' };
  }
  if (!type) {
    return { ok: false, error: 'manual outbound is missing type' };
  }

  return {
    ok: true,
    outbound: {
      ...item.outbound,
      tag,
      type,
    },
  };
}

function rewriteManualDetours(outbounds, renameMap) {
  if (renameMap.size === 0) {
    return;
  }

  for (const outbound of outbounds) {
    walk(outbound, (key, value, parent) => {
      if (!shouldRewriteReferenceKey(key) || typeof value !== 'string') {
        return;
      }
      const replacement = renameMap.get(value);
      if (replacement && parent && typeof parent === 'object') {
        parent[key] = replacement;
      }
    });
  }
}

function shouldRewriteReferenceKey(key) {
  return key === 'detour' || key === 'outbound' || key === 'download_detour' || key.endsWith('_detour');
}

export function buildCompatOutbounds(regionSelectorTags, manualOutboundTags = []) {
  return [...new Set([MANUAL_TAG, ...manualOutboundTags, ...regionSelectorTags])];
}

function collectReferencedOutboundTags(template) {
  const tags = new Set();
  walk(template.dns, (key, value) => {
    if (key === 'detour' && typeof value === 'string') {
      tags.add(value);
    }
  });
  walk(template.route, (key, value) => {
    if ((key === 'outbound' || key === 'download_detour' || key === 'final') && typeof value === 'string') {
      tags.add(value);
    }
  });
  walk(template.route_set, (key, value) => {
    if (key === 'download_detour' && typeof value === 'string') {
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

function walk(value, visitor, key = '', parent = null) {
  visitor(key, value, parent);
  if (Array.isArray(value)) {
    for (const item of value) {
      walk(item, visitor, key, value);
    }
    return;
  }
  if (value && typeof value === 'object') {
    for (const [childKey, childValue] of Object.entries(value)) {
      walk(childValue, visitor, childKey, value);
    }
  }
}

async function readTemplate() {
  return readTemplateJson();
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
      const timeoutError = new Error(`fetch timed out after ${FETCH_TIMEOUT_MS}ms`);
      timeoutError.code = 'FETCH_TIMEOUT';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSubscriptionText(source) {
  try {
    const text = await fetchText(source.url);
    try {
      await writeSubscriptionCache(source, text);
      return { text, warnings: [] };
    } catch (error) {
      return {
        text,
        warnings: [`${source.name}: fetched upstream but failed to update cache (${error.message})`],
      };
    }
  } catch (error) {
    let cache;
    try {
      cache = await readSubscriptionCache(source);
    } catch (cacheError) {
      throw new Error(`${error.message}; cache read failed (${cacheError.message})`);
    }

    if (!cache) {
      throw new Error(`${error.message}; no cached subscription available`);
    }

    const fetchedAt = cache.fetchedAt || 'unknown time';
    return {
      text: cache.content,
      warnings: [`${source.name}: ${error.message}; using cached subscription from ${fetchedAt}`],
    };
  }
}

function uniqueTag(base, usedTags) {
  const clean = cleanTag(base) || 'node';
  let tag = clean;
  let index = 2;
  while (usedTags.has(tag)) {
    tag = `${clean} ${index}`;
    index += 1;
  }
  usedTags.add(tag);
  return tag;
}

function cleanTag(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}
