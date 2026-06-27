import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCompatOutbounds, buildConfigFromSources, previewSources } from '../src/generator.js';

test('builds config by replacing only outbounds', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-build-cache-'));
  const ss = 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01';
  const vmess = `vmess://${Buffer.from(JSON.stringify({
    ps: '美国01',
    add: 'us.example.com',
    port: '443',
    id: '00000000-0000-0000-0000-000000000000',
    aid: '0',
  })).toString('base64')}`;
  const upstream = Buffer.from(`${ss}\n${vmess}`).toString('base64');
  const originalFetch = globalThis.fetch;
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  globalThis.fetch = async () => new Response(upstream, { status: 200 });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const template = JSON.parse(await fs.readFile(new URL('../config.json', import.meta.url), 'utf8'));
  const result = await buildConfigFromSources([
    {
      id: 'a',
      name: '机场A',
      url: 'https://example.com/sub',
      enabled: true,
    },
  ]);

  assert.deepEqual(result.config.route, template.route);
  assert.deepEqual(result.config.dns, template.dns);
  assert.notDeepEqual(result.config.outbounds, template.outbounds);
  assert.equal(result.config.outbounds.some((item) => item.tag === '机场A'), false);
  const sourceHkGroup = result.config.outbounds.find((item) => item.tag === '机场A / 香港');
  const sourceOtherGroup = result.config.outbounds.find((item) => item.tag === '机场A / 其他');
  assert.equal(sourceHkGroup.type, 'urltest');
  assert.equal(sourceHkGroup.url, 'https://www.gstatic.com/generate_204');
  assert.equal(sourceHkGroup.interval, '1m');
  assert.equal(sourceHkGroup.tolerance, 50);
  assert.equal(sourceHkGroup.default, undefined);
  assert.equal(sourceOtherGroup.type, 'urltest');
  assert.ok(result.config.outbounds.some((item) => item.tag === '🚀 手动选择'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '🏠 家宽'));
  for (const tag of ['香港', '日本', '亚太', '美国', '其他']) {
    assert.equal(result.config.outbounds.some((item) => item.tag === tag), false);
  }
  assert.equal(result.stats.nodeCount, 2);
});

test('filters subscription nodes with a source regex', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-filter-cache-'));
  const upstream = Buffer.from([
    'ss://YWVzLTI1Ni1nY206cGFzcw@hk.example.com:8388#香港01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@jp.example.com:8388#日本01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@us.example.com:8388#美国01',
  ].join('\n')).toString('base64');
  const originalFetch = globalThis.fetch;
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  globalThis.fetch = async () => new Response(upstream, { status: 200 });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const source = {
    id: 'a',
    name: '机场A',
    url: 'https://example.com/sub',
    enabled: true,
    filterPattern: '香港|日本',
  };
  const result = await buildConfigFromSources([source]);
  const preview = await previewSources([source]);
  const outbounds = result.config.outbounds;
  const manualSelector = outbounds.find((item) => item.tag === '🚀 手动选择');

  assert.equal(result.stats.nodeCount, 2);
  assert.equal(result.stats.sources[0].filteredNodeCount, 1);
  assert.equal(result.stats.sources[0].includeFilteredNodeCount, 1);
  assert.equal(result.stats.sources[0].excludeFilteredNodeCount, 0);
  assert.equal(preview.sources[0].nodes, 2);
  assert.equal(preview.sources[0].filteredNodes, 1);
  assert.equal(preview.sources[0].includeFilteredNodes, 1);
  assert.equal(preview.sources[0].excludeFilteredNodes, 0);
  assert.ok(outbounds.some((item) => item.tag.includes('香港01')));
  assert.ok(outbounds.some((item) => item.tag.includes('日本01')));
  assert.equal(outbounds.some((item) => item.tag.includes('美国01')), false);
  assert.deepEqual(manualSelector.outbounds, ['机场A / 香港', '机场A / 日本']);
});

test('applies include regex before exclude regex', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-exclude-filter-cache-'));
  const upstream = Buffer.from([
    'ss://YWVzLTI1Ni1nY206cGFzcw@hk.example.com:8388#香港01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@jp.example.com:8388#日本01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@us.example.com:8388#美国01',
  ].join('\n')).toString('base64');
  const originalFetch = globalThis.fetch;
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  globalThis.fetch = async () => new Response(upstream, { status: 200 });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const source = {
    id: 'a',
    name: '机场A',
    url: 'https://example.com/sub',
    enabled: true,
    filterPattern: '香港|日本',
    excludeFilterPattern: '日本',
  };
  const result = await buildConfigFromSources([source]);
  const preview = await previewSources([source]);
  const outbounds = result.config.outbounds;
  const manualSelector = outbounds.find((item) => item.tag === '🚀 手动选择');

  assert.equal(result.stats.nodeCount, 1);
  assert.equal(result.stats.sources[0].filteredNodeCount, 2);
  assert.equal(result.stats.sources[0].includeFilteredNodeCount, 1);
  assert.equal(result.stats.sources[0].excludeFilteredNodeCount, 1);
  assert.equal(preview.sources[0].nodes, 1);
  assert.equal(preview.sources[0].filteredNodes, 2);
  assert.equal(preview.sources[0].includeFilteredNodes, 1);
  assert.equal(preview.sources[0].excludeFilteredNodes, 1);
  assert.ok(outbounds.some((item) => item.tag.includes('香港01')));
  assert.equal(outbounds.some((item) => item.tag.includes('日本01')), false);
  assert.equal(outbounds.some((item) => item.tag.includes('美国01')), false);
  assert.deepEqual(manualSelector.outbounds, ['机场A / 香港']);
});

test('adds manual outbounds beside subscription region urltests', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-manual-cache-'));
  const ss = 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01';
  const vmess = `vmess://${Buffer.from(JSON.stringify({
    ps: '美国01',
    add: 'us.example.com',
    port: '443',
    id: '00000000-0000-0000-0000-000000000000',
    aid: '0',
  })).toString('base64')}`;
  const trojan = 'trojan://secret@other.example.com:443#火星01';
  const apac = 'trojan://secret@sg.example.com:443#新加坡01';
  const upstream = Buffer.from(`${ss}\n${vmess}\n${trojan}\n${apac}`).toString('base64');
  const originalFetch = globalThis.fetch;
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  globalThis.fetch = async () => new Response(upstream, { status: 200 });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const result = await buildConfigFromSources([
    {
      id: 'a',
      name: '机场A',
      url: 'https://example.com/sub',
      enabled: true,
    },
  ], [
    {
      id: 'manual-hk',
      enabled: true,
      outbound: {
        type: 'direct',
        tag: '手动香港',
        detour: '家宽落地',
      },
    },
    {
      id: 'manual-custom',
      enabled: true,
      direct: true,
      outbound: {
        type: 'socks',
        tag: '家宽落地',
        server: '127.0.0.1',
        server_port: 1080,
      },
    },
    {
      id: 'manual-direct-opt-out',
      enabled: true,
      direct: true,
      includeInDetour: false,
      outbound: {
        type: 'direct',
        tag: '本地直连',
      },
    },
  ]);

  const outbounds = result.config.outbounds;
  const manualSelector = outbounds.find((item) => item.tag === '🚀 手动选择');
  const sourceHkSelector = outbounds.find((item) => item.tag === '机场A / 香港');
  const sourceOtherSelector = outbounds.find((item) => item.tag === '机场A / 其他');
  const manualHk = outbounds.find((item) => item.tag === '手动香港');
  const manualCustom = outbounds.find((item) => item.tag === '家宽落地');
  const manualDirectOptOut = outbounds.find((item) => item.tag === '本地直连');
  const manualHkDetourSelector = outbounds.find((item) => item.tag === '🧭 手动香港 Detour');
  const manualCustomDetourSelector = outbounds.find((item) => item.tag === '🧭 家宽落地 Detour');
  const compatSelector = outbounds.find((item) => item.tag === '🏠 家宽');
  const manualCustomStats = result.stats.manualOutbounds.find((item) => item.id === 'manual-custom');
  const manualDirectOptOutStats = result.stats.manualOutbounds.find((item) => item.id === 'manual-direct-opt-out');

  assert.deepEqual(manualSelector.outbounds, ['机场A / 香港', '机场A / 其他', '手动香港', '家宽落地', '本地直连']);
  assert.deepEqual(manualHkDetourSelector.outbounds, ['机场A / 香港', '机场A / 其他', '家宽落地']);
  assert.equal(manualCustomDetourSelector, undefined);
  for (const tag of ['香港', '日本', '亚太', '美国', '其他']) {
    assert.equal(outbounds.some((item) => item.tag === tag), false);
  }
  assert.equal(sourceHkSelector.type, 'urltest');
  assert.equal(sourceOtherSelector.type, 'urltest');
  assert.ok(sourceHkSelector.outbounds.some((tag) => tag.includes('香港01')));
  assert.ok(sourceOtherSelector.outbounds.some((tag) => tag.includes('美国01')));
  assert.ok(sourceOtherSelector.outbounds.some((tag) => tag.includes('火星01')));
  assert.ok(sourceOtherSelector.outbounds.some((tag) => tag.includes('新加坡01')));
  assert.deepEqual(compatSelector.outbounds, ['🚀 手动选择', '手动香港', '家宽落地', '本地直连', '机场A / 香港', '机场A / 其他']);
  assert.equal(manualHk.detour, '🧭 手动香港 Detour');
  assert.equal(manualCustom.detour, undefined);
  assert.equal(manualDirectOptOut.detour, undefined);
  assert.equal(manualCustomStats.direct, true);
  assert.equal(manualCustomStats.includeInDetour, true);
  assert.equal(manualDirectOptOutStats.includeInDetour, false);
  assert.equal(manualCustomStats.detour, '');
  assert.equal(result.stats.manualOutboundCount, 3);
});

test('uses subscription region urltests directly across sources', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-region-cache-'));
  const sourceA = Buffer.from([
    'ss://YWVzLTI1Ni1nY206cGFzcw@a-us.example.com:8388#美国A01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@a-jp.example.com:8388#日本A01',
  ].join('\n')).toString('base64');
  const sourceB = Buffer.from([
    'ss://YWVzLTI1Ni1nY206cGFzcw@b-us.example.com:8388#美国B01',
    'ss://YWVzLTI1Ni1nY206cGFzcw@b-jp.example.com:8388#日本B01',
  ].join('\n')).toString('base64');
  const originalFetch = globalThis.fetch;
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  globalThis.fetch = async (url) => new Response(String(url).includes('/b') ? sourceB : sourceA, { status: 200 });
  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  const result = await buildConfigFromSources([
    {
      id: 'a',
      name: '机场A',
      url: 'https://example.com/a',
      enabled: true,
    },
    {
      id: 'b',
      name: '机场B',
      url: 'https://example.com/b',
      enabled: true,
    },
  ]);

  const outbounds = result.config.outbounds;
  const manualSelector = outbounds.find((item) => item.tag === '🚀 手动选择');
  const sourceAOtherSelector = outbounds.find((item) => item.tag === '机场A / 其他');
  const sourceAJpSelector = outbounds.find((item) => item.tag === '机场A / 日本');
  const sourceBOtherSelector = outbounds.find((item) => item.tag === '机场B / 其他');
  const sourceBJpSelector = outbounds.find((item) => item.tag === '机场B / 日本');

  assert.deepEqual(manualSelector.outbounds, ['机场A / 日本', '机场A / 其他', '机场B / 日本', '机场B / 其他']);
  assert.equal(sourceAOtherSelector.type, 'urltest');
  assert.equal(sourceAJpSelector.type, 'urltest');
  assert.equal(sourceBOtherSelector.type, 'urltest');
  assert.equal(sourceBJpSelector.type, 'urltest');
  assert.ok(sourceAOtherSelector.outbounds.some((tag) => tag.includes('美国A01')));
  assert.ok(sourceAJpSelector.outbounds.some((tag) => tag.includes('日本A01')));
  assert.ok(sourceBOtherSelector.outbounds.some((tag) => tag.includes('美国B01')));
  assert.ok(sourceBJpSelector.outbounds.some((tag) => tag.includes('日本B01')));
  assert.equal(outbounds.some((item) => item.tag === '机场A / 美国'), false);
  assert.equal(outbounds.some((item) => item.tag === '机场B / 美国'), false);
  assert.equal(outbounds.some((item) => item.tag === '美国'), false);
  assert.equal(outbounds.some((item) => item.tag === '日本'), false);
});

test('builds all compatibility selectors with every subscription region choice', () => {
  const regionTags = ['机场A / 香港', '机场A / 日本'];

  assert.deepEqual(buildCompatOutbounds(regionTags), ['🚀 手动选择', ...regionTags]);
  assert.deepEqual(buildCompatOutbounds(regionTags, ['手动香港']), ['🚀 手动选择', '手动香港', ...regionTags]);
});

test('writes upstream subscription cache after successful fetch', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-cache-'));
  const cacheUrl = new URL(`../src/cache.js?cache-write-${Date.now()}`, import.meta.url);
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  const { readSubscriptionCache, writeSubscriptionCache } = await import(cacheUrl);
  const source = {
    name: '机场A',
    url: 'https://example.com/sub',
  };
  const content = 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01';

  t.after(async () => {
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  await writeSubscriptionCache(source, content);

  const cache = await readSubscriptionCache(source);
  const cacheKey = crypto.createHash('sha256').update(source.url).digest('hex');
  const stat = await fs.stat(path.join(cacheDir, `${cacheKey}.json`));

  assert.equal(cache.content, content);
  assert.equal(cache.url, source.url);
  assert.equal(stat.isFile(), true);
});

test('uses cached upstream subscription when fetch times out', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-timeout-cache-'));
  const moduleTag = Date.now();
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  const { writeSubscriptionCache } = await import(new URL(`../src/cache.js?timeout-cache-${moduleTag}`, import.meta.url));
  const { buildConfigFromSources: buildWithCache } = await import(new URL(`../src/generator.js?timeout-cache-${moduleTag}`, import.meta.url));
  const originalFetch = globalThis.fetch;
  const source = {
    id: 'a',
    name: '机场A',
    url: 'https://example.com/sub',
    enabled: true,
  };
  const upstream = 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01';

  globalThis.fetch = async () => {
    throw new DOMException('aborted', 'AbortError');
  };

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  await writeSubscriptionCache(source, upstream);

  const result = await buildWithCache([source]);

  assert.equal(result.stats.nodeCount, 1);
  assert.ok(result.config.outbounds.some((item) => item.tag.includes('香港01')));
  assert.ok(result.warnings.some((warning) => warning.includes('using cached subscription')));
});

test('uses cached upstream subscription when fetch returns an error', async (t) => {
  const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-http-error-cache-'));
  const moduleTag = Date.now();
  process.env.SUBSCRIPTION_CACHE_DIR = cacheDir;
  const { writeSubscriptionCache } = await import(new URL(`../src/cache.js?http-error-cache-${moduleTag}`, import.meta.url));
  const { buildConfigFromSources: buildWithCache } = await import(new URL(`../src/generator.js?http-error-cache-${moduleTag}`, import.meta.url));
  const originalFetch = globalThis.fetch;
  const source = {
    id: 'a',
    name: '机场A',
    url: 'https://example.com/sub',
    enabled: true,
  };
  const upstream = 'ss://YWVzLTI1Ni1nY206cGFzcw@example.com:8388#香港01';

  globalThis.fetch = async () => new Response('bad gateway', { status: 502 });

  t.after(async () => {
    globalThis.fetch = originalFetch;
    delete process.env.SUBSCRIPTION_CACHE_DIR;
    await fs.rm(cacheDir, { recursive: true, force: true });
  });

  await writeSubscriptionCache(source, upstream);

  const result = await buildWithCache([source]);

  assert.equal(result.stats.nodeCount, 1);
  assert.ok(result.config.outbounds.some((item) => item.tag.includes('香港01')));
  assert.ok(result.warnings.some((warning) => warning.includes('upstream returned HTTP 502')));
  assert.ok(result.warnings.some((warning) => warning.includes('using cached subscription')));
});
