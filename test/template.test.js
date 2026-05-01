import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

test('template text falls back to config.example.json', async (t) => {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-template-missing-')), 'config.json');
  const moduleTag = Date.now();
  process.env.TEMPLATE_PATH = target;
  const { readTemplateText } = await import(new URL(`../src/template.js?missing-${moduleTag}`, import.meta.url));

  t.after(async () => {
    delete process.env.TEMPLATE_PATH;
    await fs.rm(path.dirname(target), { recursive: true, force: true });
  });

  const result = await readTemplateText();

  assert.equal(result.usingExample, true);
  assert.match(result.content, /"outbounds"/);
});

test('template text validates and writes config.json', async (t) => {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-template-write-')), 'nested', 'config.json');
  const moduleTag = Date.now();
  process.env.TEMPLATE_PATH = target;
  const { readTemplateJson, writeTemplateText } = await import(new URL(`../src/template.js?write-${moduleTag}`, import.meta.url));

  t.after(async () => {
    delete process.env.TEMPLATE_PATH;
    await fs.rm(path.dirname(path.dirname(target)), { recursive: true, force: true });
  });

  await writeTemplateText('{"log":{"level":"info"},"outbounds":[]}');

  assert.deepEqual(await readTemplateJson(), {
    log: { level: 'info' },
    outbounds: [],
  });
  assert.equal(await fs.readFile(target, 'utf8'), '{"log":{"level":"info"},"outbounds":[]}\n');
});

test('template text rejects invalid config JSON', async (t) => {
  const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'sing-box-conv-template-invalid-')), 'config.json');
  const moduleTag = Date.now();
  process.env.TEMPLATE_PATH = target;
  const { writeTemplateText } = await import(new URL(`../src/template.js?invalid-${moduleTag}`, import.meta.url));

  t.after(async () => {
    delete process.env.TEMPLATE_PATH;
    await fs.rm(path.dirname(target), { recursive: true, force: true });
  });

  await assert.rejects(
    writeTemplateText('[]'),
    /config\.json must contain a JSON object/,
  );
  await assert.rejects(
    writeTemplateText('{'),
    /config\.json contains invalid JSON/,
  );
});
