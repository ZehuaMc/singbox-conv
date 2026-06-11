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

test('front-end exposes manual outbound controls', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(html, /id="addManualOutboundButton"/);
  assert.match(html, /id="saveManualOutboundsButton"/);
  assert.match(html, /id="manualOutboundsList"/);
  assert.doesNotMatch(html, /id="detourOptions"/);
  assert.doesNotMatch(js, /data-field="detour"/);
  assert.match(js, /data-field="direct"/);
  assert.match(html, /直连手动出站/);
  assert.doesNotMatch(js, /detourOptionValues/);
  assert.doesNotMatch(js, /setupDetourCombobox/);
  assert.doesNotMatch(js, /openDetourMenu/);
  assert.doesNotMatch(js, /closeDetourMenus/);
  assert.doesNotMatch(js, /aria-expanded/);
  assert.match(js, /normalizeManualOutboundForSave/);
  assert.doesNotMatch(html, /id="regionOptions"/);
  assert.match(js, /manualOutbounds/);
  assert.match(js, /#saveManualOutboundsButton/);
  assert.match(js, /readManualOutboundsFromDom/);
});

test('front-end supports reordering upstream sources', async () => {
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../public/style.css', import.meta.url), 'utf8');

  assert.match(js, /moveSource/);
  assert.match(js, /move-up-button/);
  assert.match(js, /move-down-button/);
  assert.match(js, /readSourcesFromDom\(\)/);
  assert.match(css, /\.source-order/);
});

test('preview supports unsaved form data', async () => {
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(server, /async function handlePreview/);
  assert.match(server, /method === 'POST'/);
  assert.match(js, /api\('\/api\/preview'/);
  assert.doesNotMatch(js, /api\('\/api\/sources',\s*\{\s*method: 'POST'[\s\S]*?const result = await api\('\/api\/preview'\)/);
});

test('management UI exposes runtime logs', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../public/style.css', import.meta.url), 'utf8');

  assert.match(html, /id="refreshLogsButton"/);
  assert.match(html, /id="clearLogsButton"/);
  assert.match(html, /id="logsOutput"/);
  assert.match(js, /api\('\/api\/logs'\)/);
  assert.match(js, /method: 'DELETE'/);
  assert.match(js, /function renderLogs/);
  assert.match(css, /\.log-entry/);
});

test('front-end copies subscription links with a fallback path', async () => {
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');

  assert.match(js, /async function copyTextToClipboard/);
  assert.match(js, /navigator\.clipboard\?\.writeText/);
  assert.match(js, /function copyTextWithSelection/);
  assert.match(js, /document\.execCommand\('copy'\)/);
  assert.match(js, /浏览器阻止了剪贴板访问/);
});

test('server exposes authenticated in-memory logs API', async () => {
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');

  assert.match(server, /from '\.\/logs\.js'/);
  assert.match(server, /url\.pathname === '\/api\/logs'/);
  assert.match(server, /requireAuth\(req, res, requestContext\)/);
  assert.match(server, /function handleLogs/);
  assert.match(server, /method === 'GET'/);
  assert.match(server, /method === 'DELETE'/);
  assert.match(server, /appendLog\('info', '服务已启动'/);
});

test('management UI exposes config.json editor', async () => {
  const html = await fs.readFile(new URL('../public/index.html', import.meta.url), 'utf8');
  const js = await fs.readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const css = await fs.readFile(new URL('../public/style.css', import.meta.url), 'utf8');

  assert.match(html, /id="configEditor"/);
  assert.match(html, /id="reloadConfigButton"/);
  assert.match(html, /id="formatConfigButton"/);
  assert.match(html, /id="saveConfigButton"/);
  assert.match(html, /id="configMeta"/);
  assert.match(js, /api\('\/api\/template'\)/);
  assert.match(js, /function loadTemplate/);
  assert.match(js, /function saveTemplate/);
  assert.match(js, /function formatTemplate/);
  assert.match(js, /function validateTemplateContent/);
  assert.match(css, /\.config-editor/);
});

test('server exposes authenticated config template API', async () => {
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');

  assert.match(server, /from '\.\/template\.js'/);
  assert.match(server, /url\.pathname === '\/api\/template'/);
  assert.match(server, /requireAuth\(req, res, requestContext\)/);
  assert.match(server, /async function handleTemplate/);
  assert.match(server, /readTemplateText/);
  assert.match(server, /writeTemplateText/);
  assert.match(server, /配置模板已保存/);
});

test('server writes detailed runtime log context', async () => {
  const server = await fs.readFile(new URL('../src/server.js', import.meta.url), 'utf8');
  const logs = await fs.readFile(new URL('../src/logs.js', import.meta.url), 'utf8');
  const generator = await fs.readFile(new URL('../src/generator.js', import.meta.url), 'utf8');

  assert.match(server, /createRequestContext/);
  assert.match(server, /logRequestFinished/);
  assert.match(server, /summarizeSources/);
  assert.match(server, /direct: item\.direct === true/);
  assert.match(server, /warnings: result\.warnings\.slice\(0, 10\)/);
  assert.match(logs, /function normalizeError/);
  assert.match(logs, /MAX_STACK_LINES/);
  assert.match(generator, /sourceStats/);
  assert.match(generator, /tagSamples/);
});
