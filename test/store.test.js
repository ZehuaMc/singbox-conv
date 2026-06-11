import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('reads legacy source array as settings', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-store-legacy-'));
  const file = path.join(dir, 'sources.json');
  process.env.SOURCES_PATH = file;
  const moduleTag = Date.now();
  const { readSettings } = await import(new URL(`../src/store.js?legacy-${moduleTag}`, import.meta.url));

  t.after(async () => {
    delete process.env.SOURCES_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });

  await fs.writeFile(file, `${JSON.stringify([
    {
      id: 'a',
      name: '机场A',
      url: 'https://example.com/sub',
      enabled: true,
    },
  ])}\n`);

  const settings = await readSettings();

  assert.equal(settings.sources.length, 1);
  assert.equal(settings.sources[0].name, '机场A');
  assert.deepEqual(settings.manualOutbounds, []);
});

test('writes and reads settings with manual outbounds', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-store-settings-'));
  const file = path.join(dir, 'sources.json');
  process.env.SOURCES_PATH = file;
  const moduleTag = Date.now();
  const { readSettings, writeSettings } = await import(new URL(`../src/store.js?settings-${moduleTag}`, import.meta.url));

  t.after(async () => {
    delete process.env.SOURCES_PATH;
    await fs.rm(dir, { recursive: true, force: true });
  });

  await writeSettings({
    sources: [
      {
        id: 'a',
        name: '机场A',
        url: 'https://example.com/sub',
        enabled: false,
      },
    ],
    manualOutbounds: [
      {
        id: 'manual-a',
        enabled: true,
        direct: true,
        region: '韩国',
        outbound: {
          type: 'socks',
          tag: '韩国手动',
          server: '127.0.0.1',
          server_port: 1080,
        },
      },
    ],
  });

  const settings = await readSettings();

  assert.equal(settings.sources[0].enabled, false);
  assert.equal(settings.manualOutbounds.length, 1);
  assert.equal(settings.manualOutbounds[0].direct, true);
  assert.equal(settings.manualOutbounds[0].outbound.tag, '韩国手动');
  assert.equal(settings.manualOutbounds[0].outbound.detour, undefined);
});
