const state = {
  sources: [],
  manualOutbounds: [],
  subscriptionPath: '',
  templateContent: '',
  templateUsingExample: false,
};

const loginView = document.querySelector('#loginView');
const managerView = document.querySelector('#managerView');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const passwordInput = document.querySelector('#passwordInput');
const sourcesList = document.querySelector('#sourcesList');
const manualOutboundsList = document.querySelector('#manualOutboundsList');
const subscriptionLink = document.querySelector('#subscriptionLink');
const statusText = document.querySelector('#statusText');
const previewOutput = document.querySelector('#previewOutput');
const logsOutput = document.querySelector('#logsOutput');
const configEditor = document.querySelector('#configEditor');
const configMeta = document.querySelector('#configMeta');

document.querySelector('#addSourceButton').addEventListener('click', () => {
  readSourcesFromDom();
  state.sources.push({
    id: createId(),
    name: '',
    url: '',
    enabled: true,
    filterPattern: '',
    excludeFilterPattern: '',
  });
  renderSources();
});

document.querySelector('#addManualOutboundButton').addEventListener('click', () => {
  if (!readFormState()) {
    return;
  }
  state.manualOutbounds.push({
    id: createId(),
    enabled: true,
    direct: false,
    includeInDetour: true,
    outbound: {
      type: '',
      tag: '',
    },
  });
  renderManualOutbounds();
});

document.querySelector('#saveButton').addEventListener('click', saveSources);
document.querySelector('#saveManualOutboundsButton').addEventListener('click', saveSources);
document.querySelector('#previewButton').addEventListener('click', previewSources);
document.querySelector('#copyButton').addEventListener('click', copySubscriptionLink);
document.querySelector('#logoutButton').addEventListener('click', logout);
document.querySelector('#refreshLogsButton').addEventListener('click', refreshLogs);
document.querySelector('#clearLogsButton').addEventListener('click', clearLogs);
document.querySelector('#reloadConfigButton').addEventListener('click', () => loadTemplate());
document.querySelector('#formatConfigButton').addEventListener('click', formatTemplate);
document.querySelector('#saveConfigButton').addEventListener('click', saveTemplate);

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  loginError.hidden = true;
  try {
    const result = await api('/api/login', {
      method: 'POST',
      body: { password: passwordInput.value },
    });
    state.subscriptionPath = result.subscriptionPath;
    await loadSources();
    showManager();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.hidden = false;
  }
});

init();

async function init() {
  try {
    const session = await api('/api/session');
    state.subscriptionPath = session.subscriptionPath;
    await loadSources();
    showManager();
  } catch {
    showLogin();
  }
}

async function loadSources() {
  const result = await api('/api/sources');
  state.sources = result.sources || [];
  state.manualOutbounds = result.manualOutbounds || [];
  state.subscriptionPath = result.subscriptionPath;
  renderSources();
  renderManualOutbounds();
  renderSubscriptionLink();
  const templateLoaded = await loadTemplate({ quiet: true });
  await refreshLogs({ quiet: true });
  if (templateLoaded) {
    setStatus('已加载');
  }
}

async function loadTemplate(options = {}) {
  if (!options.quiet) {
    setStatus('正在加载 config.json');
  }
  try {
    const result = await api('/api/template');
    state.templateContent = result.content || '';
    state.templateUsingExample = Boolean(result.usingExample);
    configEditor.value = state.templateContent;
    renderConfigMeta();
    if (!options.quiet) {
      setStatus('config.json 已加载');
    }
    return true;
  } catch (error) {
    setStatus(error.message, true);
    return false;
  }
}

async function saveTemplate() {
  const content = configEditor.value;
  if (!validateTemplateContent(content)) {
    return;
  }

  setStatus('正在保存 config.json');
  try {
    const result = await api('/api/template', {
      method: 'POST',
      body: { content },
    });
    state.templateContent = result.content || '';
    state.templateUsingExample = Boolean(result.usingExample);
    configEditor.value = state.templateContent;
    renderConfigMeta();
    setStatus('config.json 已保存');
  } catch (error) {
    setStatus(error.message, true);
  }
}

function formatTemplate() {
  const parsed = parseTemplateContent(configEditor.value);
  if (!parsed) {
    return;
  }
  configEditor.value = `${JSON.stringify(parsed, null, 2)}\n`;
  setStatus('config.json 已格式化');
}

async function saveSources() {
  if (!readFormState()) {
    return;
  }
  try {
    const result = await api('/api/sources', {
      method: 'POST',
      body: {
        sources: state.sources,
        manualOutbounds: state.manualOutbounds,
      },
    });
    state.sources = result.sources || [];
    state.manualOutbounds = result.manualOutbounds || [];
    state.subscriptionPath = result.subscriptionPath;
    renderSources();
    renderManualOutbounds();
    renderSubscriptionLink();
    setStatus('已保存');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function previewSources() {
  if (!readFormState()) {
    return;
  }
  setStatus('正在预览');
  previewOutput.textContent = '正在读取上游订阅...';
  try {
    const result = await api('/api/preview', {
      method: 'POST',
      body: {
        sources: state.sources,
        manualOutbounds: state.manualOutbounds,
      },
    });
    const lines = result.sources.map((source) => {
      const stateText = source.enabled ? `${source.nodes} nodes` : 'disabled';
      const filterText = source.filteredNodes
        ? `, 移除 ${source.filteredNodes}（保留阶段 ${source.includeFilteredNodes || 0}，移除阶段 ${source.excludeFilteredNodes || 0}）`
        : '';
      return `${source.name}: ${stateText}${filterText}${source.error ? `, ${source.error}` : ''}`;
    });
    if (result.manualOutbounds?.length) {
      lines.push('', 'Manual outbounds:');
      for (const outbound of result.manualOutbounds) {
        const stateText = outbound.enabled ? `${outbound.type || '-'} ${outbound.tag || '-'}` : 'disabled';
        const modeText = outbound.direct
          ? ` direct detour-candidate=${outbound.includeInDetour !== false ? 'on' : 'off'}`
          : outbound.detour ? ` detour=${outbound.detour}` : '';
        lines.push(`${stateText}${modeText}${outbound.error ? `, ${outbound.error}` : ''}`);
      }
    }
    if (result.warnings.length) {
      lines.push('', 'Warnings:', ...result.warnings);
    }
    previewOutput.textContent = lines.join('\n') || '暂无订阅源';
    setStatus('预览完成');
  } catch (error) {
    previewOutput.textContent = error.message;
    setStatus(error.message, true);
  }
}

async function refreshLogs(options = {}) {
  if (!options.quiet) {
    setStatus('正在刷新日志');
  }
  try {
    const result = await api('/api/logs');
    renderLogs(result.logs || []);
    if (!options.quiet) {
      setStatus('日志已刷新');
    }
  } catch (error) {
    logsOutput.textContent = error.message;
    logsOutput.classList.add('error');
    setStatus(error.message, true);
  }
}

async function clearLogs() {
  try {
    const result = await api('/api/logs', { method: 'DELETE' });
    renderLogs(result.logs || []);
    setStatus('日志已清空');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function logout() {
  await api('/api/logout', { method: 'POST', body: {} }).catch(() => {});
  showLogin();
}

function renderSources() {
  sourcesList.replaceChildren();
  if (state.sources.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '还没有订阅源。';
    sourcesList.append(empty);
    return;
  }

  state.sources.forEach((source, index) => {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.dataset.id = source.id;
    row.innerHTML = `
      <div class="source-enabled">
        <label class="toggle">
          <input data-field="enabled" type="checkbox">
          启用
        </label>
      </div>
      <label class="source-name">
        名称
        <input data-field="name" placeholder="机场 A">
      </label>
      <label class="source-url">
        订阅 URL
        <input data-field="url" placeholder="https://example.com/sub">
      </label>
      <label class="source-include-filter">
        保留匹配正则
        <input data-field="filterPattern" placeholder="香港|日本">
      </label>
      <label class="source-exclude-filter">
        移除匹配正则
        <input data-field="excludeFilterPattern" placeholder="倍率|过期|官网">
      </label>
      <div class="source-actions">
        <div class="source-order" aria-label="调整顺序">
          <button class="secondary order-button move-up-button" type="button" title="上移" aria-label="上移">↑</button>
          <button class="secondary order-button move-down-button" type="button" title="下移" aria-label="下移">↓</button>
        </div>
        <button class="secondary remove-button" type="button">删除</button>
      </div>
    `;
    row.querySelector('[data-field="enabled"]').checked = source.enabled !== false;
    row.querySelector('[data-field="name"]').value = source.name;
    row.querySelector('[data-field="url"]').value = source.url;
    const filters = normalizeSourceFilters(source);
    row.querySelector('[data-field="filterPattern"]').value = filters.filterPattern;
    row.querySelector('[data-field="excludeFilterPattern"]').value = filters.excludeFilterPattern;
    const moveUpButton = row.querySelector('.move-up-button');
    const moveDownButton = row.querySelector('.move-down-button');
    moveUpButton.disabled = index === 0;
    moveDownButton.disabled = index === state.sources.length - 1;
    moveUpButton.addEventListener('click', () => moveSource(source.id, -1));
    moveDownButton.addEventListener('click', () => moveSource(source.id, 1));
    row.querySelector('.remove-button').addEventListener('click', () => {
      readFormState();
      state.sources = state.sources.filter((item) => item.id !== source.id);
      renderSources();
    });
    sourcesList.append(row);
  });
}

function moveSource(id, direction) {
  readSourcesFromDom();
  const index = state.sources.findIndex((source) => source.id === id);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= state.sources.length) {
    return;
  }

  const [source] = state.sources.splice(index, 1);
  state.sources.splice(nextIndex, 0, source);
  renderSources();
}

function renderManualOutbounds() {
  manualOutboundsList.replaceChildren();
  if (state.manualOutbounds.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = '还没有手动出站。';
    manualOutboundsList.append(empty);
    return;
  }

  for (const item of state.manualOutbounds) {
    const row = document.createElement('div');
    row.className = 'manual-row';
    row.dataset.id = item.id;
    const outbound = getManualOutboundForDisplay(item);
    row.innerHTML = `
      <div class="manual-row-head">
        <label class="toggle">
          <input data-field="enabled" type="checkbox">
          启用
        </label>
        <label class="toggle">
          <input data-field="direct" type="checkbox">
          直连
        </label>
        <label class="toggle detour-candidate-toggle" data-detour-candidate-option hidden>
          <input data-field="includeInDetour" type="checkbox">
          加入 Detour 候选
        </label>
        <button class="secondary remove-button" type="button">删除</button>
      </div>
      <label>
        Outbound JSON
        <textarea data-field="outbound" spellcheck="false" placeholder='{"type":"direct","tag":"自定义出站"}'></textarea>
      </label>
    `;
    row.querySelector('[data-field="enabled"]').checked = item.enabled !== false;
    row.querySelector('[data-field="direct"]').checked = item.direct === true;
    row.querySelector('[data-field="includeInDetour"]').checked = item.includeInDetour !== false;
    row.querySelector('[data-field="outbound"]').value = JSON.stringify(outbound, null, 2);
    row.querySelector('[data-field="direct"]').addEventListener('change', () => {
      syncManualOutboundRow(row);
    });
    syncManualOutboundRow(row);
    row.querySelector('.remove-button').addEventListener('click', () => {
      readSourcesFromDom();
      if (!readManualOutboundsFromDom(item.id)) {
        return;
      }
      renderManualOutbounds();
    });
    manualOutboundsList.append(row);
  }
}

function syncManualOutboundRow(row) {
  const directInput = row.querySelector('[data-field="direct"]');
  const includeInDetourInput = row.querySelector('[data-field="includeInDetour"]');
  const option = row.querySelector('[data-detour-candidate-option]');
  if (!directInput || !includeInDetourInput || !option) {
    return;
  }

  const direct = directInput.checked;
  includeInDetourInput.disabled = !direct;
  option.hidden = !direct;
}

function renderLogs(logs) {
  logsOutput.replaceChildren();
  logsOutput.classList.remove('error');
  if (logs.length === 0) {
    logsOutput.classList.add('muted');
    logsOutput.textContent = '暂无日志';
    return;
  }

  logsOutput.classList.remove('muted');
  for (const entry of [...logs].reverse()) {
    const item = document.createElement('div');
    item.className = `log-entry log-${entry.level || 'info'}`;

    const meta = document.createElement('div');
    meta.className = 'log-meta';

    const level = document.createElement('span');
    level.className = 'log-level';
    level.textContent = entry.level || 'info';

    const time = document.createElement('time');
    time.dateTime = entry.time || '';
    time.textContent = formatLogTime(entry.time);

    meta.append(level, time);

    const message = document.createElement('div');
    message.className = 'log-message';
    message.textContent = entry.message || '';

    item.append(meta, message);
    if (entry.details) {
      const details = document.createElement('pre');
      details.className = 'log-details';
      details.textContent = JSON.stringify(entry.details, null, 2);
      item.append(details);
    }
    logsOutput.append(item);
  }
}

function readFormState() {
  readSourcesFromDom();
  return readManualOutboundsFromDom();
}

function readSourcesFromDom() {
  state.sources = [...sourcesList.querySelectorAll('.source-row')].map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    name: row.querySelector('[data-field="name"]').value.trim(),
    url: row.querySelector('[data-field="url"]').value.trim(),
    filterPattern: row.querySelector('[data-field="filterPattern"]').value.trim(),
    excludeFilterPattern: row.querySelector('[data-field="excludeFilterPattern"]').value.trim(),
  }));
}

function normalizeSourceFilters(source) {
  let filterPattern = source.filterPattern || '';
  let excludeFilterPattern = source.excludeFilterPattern || '';
  if (source.filterMode === 'exclude' && filterPattern && !excludeFilterPattern) {
    excludeFilterPattern = filterPattern;
    filterPattern = '';
  }
  return { filterPattern, excludeFilterPattern };
}

function readManualOutboundsFromDom(skipId = '') {
  const manualOutbounds = [];
  for (const row of manualOutboundsList.querySelectorAll('.manual-row')) {
    if (row.dataset.id === skipId) {
      continue;
    }
    const raw = row.querySelector('[data-field="outbound"]').value.trim();
    let outbound;
    try {
      outbound = raw ? JSON.parse(raw) : {};
    } catch (error) {
      setStatus(`手动出站 JSON 无效：${error.message}`, true);
      return false;
    }
    manualOutbounds.push({
      id: row.dataset.id,
      enabled: row.querySelector('[data-field="enabled"]').checked,
      direct: row.querySelector('[data-field="direct"]').checked,
      includeInDetour: row.querySelector('[data-field="includeInDetour"]').checked,
      outbound: normalizeManualOutboundForSave(outbound),
    });
  }
  state.manualOutbounds = manualOutbounds;
  return true;
}

function getManualOutboundForDisplay(item) {
  const outbound = item.outbound && typeof item.outbound === 'object' && !Array.isArray(item.outbound)
    ? { ...item.outbound }
    : {};
  delete outbound.detour;
  return outbound;
}

function normalizeManualOutboundForSave(outbound) {
  const next = { ...outbound };
  delete next.detour;
  return next;
}

function validateTemplateContent(content) {
  return Boolean(parseTemplateContent(content));
}

function parseTemplateContent(content) {
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch (error) {
    setStatus(`config.json 无效：${error.message}`, true);
    return null;
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    setStatus('config.json 必须是一个 JSON 对象', true);
    return null;
  }

  return parsed;
}

function renderConfigMeta() {
  const bytes = new TextEncoder().encode(configEditor.value).length;
  configMeta.textContent = state.templateUsingExample
    ? `当前显示 config.example.json，保存后会写入 config.json · ${bytes} bytes`
    : `当前编辑 config.json · ${bytes} bytes`;
}

function renderSubscriptionLink() {
  subscriptionLink.value = `${location.origin}${state.subscriptionPath}`;
}

async function copySubscriptionLink() {
  const value = subscriptionLink.value.trim();
  if (!value) {
    setStatus('没有可复制的订阅链接', true);
    return;
  }

  try {
    await copyTextToClipboard(value);
    setStatus('已复制');
  } catch (error) {
    subscriptionLink.focus({ preventScroll: true });
    subscriptionLink.select();
    setStatus(`复制失败，请手动复制：${error.message}`, true);
  }
}

async function copyTextToClipboard(value) {
  if (globalThis.isSecureContext && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back to the selection based copy path below.
    }
  }

  copyTextWithSelection(value);
}

function copyTextWithSelection(value) {
  const activeElement = document.activeElement;
  subscriptionLink.value = value;
  subscriptionLink.focus({ preventScroll: true });
  subscriptionLink.select();
  subscriptionLink.setSelectionRange(0, value.length);

  if (typeof document.execCommand !== 'function' || !document.execCommand('copy')) {
    throw new Error('浏览器阻止了剪贴板访问');
  }

  if (activeElement && activeElement !== subscriptionLink && typeof activeElement.focus === 'function') {
    activeElement.focus({ preventScroll: true });
  }
}

function showManager() {
  loginView.hidden = true;
  managerView.hidden = false;
  renderSubscriptionLink();
}

function showLogin() {
  state.subscriptionPath = '';
  state.templateContent = '';
  state.templateUsingExample = false;
  subscriptionLink.value = '';
  configEditor.value = '';
  configMeta.textContent = '尚未加载';
  managerView.hidden = true;
  loginView.hidden = false;
  passwordInput.focus();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.className = isError ? 'error' : '';
}

function formatLogTime(value) {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString('zh-CN', { hour12: false });
}

async function api(url, options = {}) {
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function createId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }
  return `source-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
