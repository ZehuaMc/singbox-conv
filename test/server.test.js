import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

test('hidden attribute is preserved in the stylesheet', async () => {
  const css = await fs.readFile(new URL('../public/style.css', import.meta.url), 'utf8');
  assert.match(css, /\[hidden\]\s*\{\s*display:\s*none\s*!important;\s*\}/);
});

test('front-end app avoids direct randomUUID dependency', async () => {
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(js, /function createId\(\)/);
  assert.match(js, /globalThis\.crypto\?\.(?:randomUUID|randomUUID\(\))/);
  assert.match(js, /Math\.random\(\)/);
});
