import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import { buildConfigFromSources } from '../src/generator.js';

test('builds config by replacing only outbounds', async (t) => {
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
  globalThis.fetch = async () => new Response(upstream, { status: 200 });
  t.after(() => {
    globalThis.fetch = originalFetch;
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
  assert.equal(result.stats.nodeCount, 2);
});
