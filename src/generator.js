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
      const filtered = applyNodeFilter(parsed.outbounds, source);
      previews.push({
        id: source.id,
        name: source.name,
        url: source.url,
        enabled: true,
        nodes: filtered.outbounds.length,
        filteredNodes: filtered.filteredCount,
        includeFilteredNodes: filtered.includeFilteredCount,
        excludeFilteredNodes: filtered.excludeFilteredCount,
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
      filteredNodes: 0,
      includeFilteredNodes: 0,
      excludeFilteredNodes: 0,
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
      direct: item.direct === true,
      tag: validation.ok ? validation.outbound.tag : '',
      type: validation.ok ? validation.outbound.type : '',
      detour: validation.ok && item.direct !== true ? buildManualDetourTag(validation.outbound.tag) : '',
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
  const manualOutboundTags = [];
  const directManualOutboundTags = [];
  const directManualOutbounds = [];
  const manualDetourLinks = [];
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

      const filtered = applyNodeFilter(parsed.outbounds, source);
      const sourceNodes = filtered.outbounds.map((outbound) => {
        const next = structuredClone(outbound);
        next.tag = uniqueTag(`${source.name} / ${next.tag || next.server || next.type}`, usedTags);
        return next;
      });

      if (sourceNodes.length === 0) {
        const emptyWarning = buildNodeFilterEmptyWarning(source.name, filtered, parsed.outbounds.length);
        warnings.push(emptyWarning);
        sourceStats.push({
          id: source.id,
          name: source.name,
          status: 'empty',
          nodeCount: 0,
          filteredNodeCount: filtered.filteredCount,
          includeFilteredNodeCount: filtered.includeFilteredCount,
          excludeFilteredNodeCount: filtered.excludeFilteredCount,
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
      sourceStats.push({
        id: source.id,
        name: source.name,
        status: 'ok',
        nodeCount: sourceNodes.length,
        filteredNodeCount: filtered.filteredCount,
        includeFilteredNodeCount: filtered.includeFilteredCount,
        excludeFilteredNodeCount: filtered.excludeFilteredCount,
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
    const direct = item.direct === true;
    const detourTag = direct ? '' : uniqueTag(buildManualDetourTag(tag), usedTags);
    next.tag = tag;
    proxyOutbounds.push(next);
    if (direct) {
      directManualOutboundTags.push(tag);
      directManualOutbounds.push(next);
    } else {
      manualDetourLinks.push({ outbound: next, detourTag });
    }
    manualOutboundTags.push(tag);
    totalManualOutbounds += 1;
    manualOutboundStats.push({
      id: item.id,
      status: 'ok',
      direct,
      type: next.type,
      originalTag,
      tag,
      renamed: tag !== originalTag,
      detour: detourTag,
    });
  }

  rewriteManualDetours(proxyOutbounds, manualTagRenames);
  for (const outbound of directManualOutbounds) {
    delete outbound.detour;
  }
  for (const { outbound, detourTag } of manualDetourLinks) {
    outbound.detour = detourTag;
  }

  const sourceRegionSelectorTags = sourceGroups
    .filter((group) => group.kind === 'region')
    .map((group) => group.selector.tag);
  const selectorChoiceTags = sourceRegionSelectorTags.length > 0 ? sourceRegionSelectorTags : [DIRECT_TAG];

  const manualFallback = [...selectorChoiceTags, ...manualOutboundTags];
  const manualDetourOutbounds = buildManualDetourOutbounds(selectorChoiceTags, directManualOutboundTags);
  const manualDetourSelectors = manualDetourLinks.map(({ detourTag }) => ({
    type: 'selector',
    tag: detourTag,
    outbounds: manualDetourOutbounds,
    default: manualDetourOutbounds[0],
  }));
  const selectors = [
    {
      type: 'selector',
      tag: MANUAL_TAG,
      outbounds: manualFallback,
      default: manualFallback[0],
    },
    ...manualDetourSelectors,
    ...sourceGroups.map((group) => group.selector),
  ];

  for (const tag of collectReferencedOutboundTags(template)) {
    if (
      tag === DIRECT_TAG
      || tag === MANUAL_TAG
      || selectors.some((selector) => selector.tag === tag)
    ) {
      continue;
    }
    selectors.push({
      type: 'selector',
      tag,
      outbounds: buildCompatOutbounds(selectorChoiceTags, manualOutboundTags),
      default: MANUAL_TAG,
    });
  }

  for (const tag of COMPAT_SELECTOR_TAGS) {
    if (!selectors.some((selector) => selector.tag === tag)) {
      selectors.push({
        type: 'selector',
        tag,
        outbounds: buildCompatOutbounds(selectorChoiceTags, manualOutboundTags),
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

function applyNodeFilter(outbounds, source) {
  const includeRegex = compileNodeFilterRegex(source?.filterPattern);
  const excludeRegex = compileNodeFilterRegex(source?.excludeFilterPattern);
  if (!includeRegex && !excludeRegex) {
    return {
      active: false,
      outbounds,
      filteredCount: 0,
      includeFilteredCount: 0,
      excludeFilteredCount: 0,
    };
  }

  const afterInclude = includeRegex
    ? outbounds.filter((outbound) => testNodeFilter(includeRegex, outbound))
    : outbounds;
  const filteredOutbounds = excludeRegex
    ? afterInclude.filter((outbound) => !testNodeFilter(excludeRegex, outbound))
    : afterInclude;
  return {
    active: true,
    includeActive: Boolean(includeRegex),
    excludeActive: Boolean(excludeRegex),
    outbounds: filteredOutbounds,
    filteredCount: outbounds.length - filteredOutbounds.length,
    includeFilteredCount: outbounds.length - afterInclude.length,
    excludeFilteredCount: afterInclude.length - filteredOutbounds.length,
  };
}

export function compileNodeFilterRegex(pattern) {
  const raw = String(pattern || '').trim();
  if (!raw) {
    return null;
  }

  const literal = parseRegexLiteral(raw);
  try {
    return literal
      ? new RegExp(literal.pattern, literal.flags)
      : new RegExp(raw, 'i');
  } catch (error) {
    throw new Error(`invalid filter regex: ${error.message}`);
  }
}

function parseRegexLiteral(value) {
  if (!value.startsWith('/')) {
    return null;
  }

  const slashIndex = value.lastIndexOf('/');
  if (slashIndex <= 0) {
    return null;
  }

  const flags = value.slice(slashIndex + 1);
  if (!/^[dgimsuvy]*$/.test(flags)) {
    return null;
  }

  return {
    pattern: value.slice(1, slashIndex),
    flags,
  };
}

function getNodeFilterTarget(outbound) {
  return cleanTag(outbound?.tag || outbound?.server || outbound?.type);
}

function testNodeFilter(regex, outbound) {
  regex.lastIndex = 0;
  return regex.test(getNodeFilterTarget(outbound));
}

function buildNodeFilterEmptyWarning(sourceName, filtered, originalNodeCount) {
  if (!filtered.active || originalNodeCount === 0) {
    return `${sourceName}: no usable nodes`;
  }
  if (filtered.includeActive && filtered.includeFilteredCount === originalNodeCount) {
    return `${sourceName}: no nodes matched include filter`;
  }
  if (filtered.excludeActive && filtered.excludeFilteredCount > 0) {
    return `${sourceName}: all remaining nodes removed by exclude filter`;
  }
  return `${sourceName}: all nodes removed by filters`;
}

function buildSourceSelectors(sourceName, nodes, usedTags) {
  const result = [];

  for (const region of REGION_GROUPS) {
    const regionNodes = nodes.filter((node) => classifyRegion(node.tag) === region.key);
    if (regionNodes.length === 0) {
      continue;
    }
    const tag = uniqueTag(`${sourceName} / ${region.label}`, usedTags);
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

function buildManualDetourOutbounds(regionSelectorTags, directManualOutboundTags = []) {
  return [...new Set([...regionSelectorTags, ...directManualOutboundTags, DIRECT_TAG])];
}

function buildManualDetourTag(tag) {
  return `🧭 ${cleanTag(tag)} Detour`;
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
