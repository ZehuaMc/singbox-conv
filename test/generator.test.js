import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildCompatOutbounds, buildConfigFromSources } from '../src/generator.js';

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
  assert.ok(result.config.outbounds.some((item) => item.tag === '机场A'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '机场A / 香港'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '机场A / 美国'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '🚀 手动选择'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '🏠 家宽'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '香港'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '日本'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '亚太'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '美国'));
  assert.ok(result.config.outbounds.some((item) => item.tag === '其他'));
  assert.equal(result.stats.nodeCount, 2);
});

test('adds manual outbounds beside global region selectors', async (t) => {
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
  const upstream = Buffer.from(`${ss}\n${vmess}\n${trojan}`).toString('base64');
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
      outbound: {
        type: 'socks',
        tag: '家宽落地',
        server: '127.0.0.1',
        server_port: 1080,
      },
    },
  ]);

  const outbounds = result.config.outbounds;
  const manualSelector = outbounds.find((item) => item.tag === '🚀 手动选择');
  const hkSelector = outbounds.find((item) => item.tag === '香港');
  const usSelector = outbounds.find((item) => item.tag === '美国');
  const otherSelector = outbounds.find((item) => item.tag === '其他');
  const sourceHkSelector = outbounds.find((item) => item.tag === '机场A / 香港');
  const sourceUsSelector = outbounds.find((item) => item.tag === '机场A / 美国');
  const sourceOtherSelector = outbounds.find((item) => item.tag === '机场A / 其他');
  const manualHk = outbounds.find((item) => item.tag === '手动香港');
  const manualCustom = outbounds.find((item) => item.tag === '家宽落地');
  const manualHkDetourSelector = outbounds.find((item) => item.tag === '🧭 手动香港 Detour');
  const manualCustomDetourSelector = outbounds.find((item) => item.tag === '🧭 家宽落地 Detour');
  const compatSelector = outbounds.find((item) => item.tag === '🏠 家宽');

  assert.deepEqual(manualSelector.outbounds, ['香港', '日本', '亚太', '美国', '其他', '手动香港', '家宽落地']);
  assert.deepEqual(manualHkDetourSelector.outbounds, ['香港', '日本', '亚太', '美国', '其他', 'direct-out']);
  assert.deepEqual(manualCustomDetourSelector.outbounds, ['香港', '日本', '亚太', '美国', '其他', 'direct-out']);
  assert.deepEqual(hkSelector.outbounds, ['机场A / 香港']);
  assert.deepEqual(usSelector.outbounds, ['机场A / 美国']);
  assert.deepEqual(otherSelector.outbounds, ['机场A / 其他']);
  assert.ok(sourceHkSelector.outbounds.some((tag) => tag.includes('香港01')));
  assert.ok(sourceUsSelector.outbounds.some((tag) => tag.includes('美国01')));
  assert.ok(sourceOtherSelector.outbounds.some((tag) => tag.includes('火星01')));
  assert.deepEqual(compatSelector.outbounds, ['🚀 手动选择', '手动香港', '家宽落地', '香港', '日本', '亚太', '美国', '其他']);
  assert.equal(manualHk.detour, '🧭 手动香港 Detour');
  assert.equal(manualCustom.detour, '🧭 家宽落地 Detour');
  assert.equal(result.stats.manualOutboundCount, 2);
});

test('groups global regions by subscription region selectors', async (t) => {
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
  const usSelector = outbounds.find((item) => item.tag === '美国');
  const jpSelector = outbounds.find((item) => item.tag === '日本');
  const sourceAUsSelector = outbounds.find((item) => item.tag === '机场A / 美国');
  const sourceBUsSelector = outbounds.find((item) => item.tag === '机场B / 美国');

  assert.deepEqual(usSelector.outbounds, ['机场A / 美国', '机场B / 美国']);
  assert.deepEqual(jpSelector.outbounds, ['机场A / 日本', '机场B / 日本']);
  assert.ok(sourceAUsSelector.outbounds.some((tag) => tag.includes('美国A01')));
  assert.ok(sourceBUsSelector.outbounds.some((tag) => tag.includes('美国B01')));
  assert.equal(usSelector.outbounds.some((tag) => tag.includes('美国A01')), false);
  assert.equal(usSelector.outbounds.some((tag) => tag.includes('美国B01')), false);
});

test('builds all compatibility selectors with every region choice', () => {
  const regionTags = ['香港', '日本', '亚太', '美国', '其他'];

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
