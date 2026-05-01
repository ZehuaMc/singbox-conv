const state = {
  sources: [],
  subscriptionPath: '',
};

const loginView = document.querySelector('#loginView');
const managerView = document.querySelector('#managerView');
const loginForm = document.querySelector('#loginForm');
const loginError = document.querySelector('#loginError');
const passwordInput = document.querySelector('#passwordInput');
const sourcesList = document.querySelector('#sourcesList');
const subscriptionLink = document.querySelector('#subscriptionLink');
const statusText = document.querySelector('#statusText');
const previewOutput = document.querySelector('#previewOutput');

document.querySelector('#addSourceButton').addEventListener('click', () => {
  readSourcesFromDom();
  state.sources.push({
    id: createId(),
    name: '',
    url: '',
    enabled: true,
  });
  renderSources();
});

document.querySelector('#saveButton').addEventListener('click', saveSources);
document.querySelector('#previewButton').addEventListener('click', previewSources);
document.querySelector('#copyButton').addEventListener('click', copySubscriptionLink);
document.querySelector('#logoutButton').addEventListener('click', logout);

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
  state.sources = result.sources;
  state.subscriptionPath = result.subscriptionPath;
  renderSources();
  renderSubscriptionLink();
  setStatus('已加载');
}

async function saveSources() {
  readSourcesFromDom();
  try {
    const result = await api('/api/sources', {
      method: 'POST',
      body: { sources: state.sources },
    });
    state.sources = result.sources;
    state.subscriptionPath = result.subscriptionPath;
    renderSources();
    renderSubscriptionLink();
    setStatus('已保存');
  } catch (error) {
    setStatus(error.message, true);
  }
}

async function previewSources() {
  readSourcesFromDom();
  setStatus('正在预览');
  previewOutput.textContent = '正在读取上游订阅...';
  try {
    await api('/api/sources', {
      method: 'POST',
      body: { sources: state.sources },
    });
    const result = await api('/api/preview');
    const lines = result.sources.map((source) => {
      const stateText = source.enabled ? `${source.nodes} nodes` : 'disabled';
      return `${source.name}: ${stateText}${source.error ? `, ${source.error}` : ''}`;
    });
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

  for (const source of state.sources) {
    const row = document.createElement('div');
    row.className = 'source-row';
    row.dataset.id = source.id;
    row.innerHTML = `
      <label class="toggle">
        <input data-field="enabled" type="checkbox">
        启用
      </label>
      <label>
        名称
        <input data-field="name" placeholder="机场 A">
      </label>
      <label>
        订阅 URL
        <input data-field="url" placeholder="https://example.com/sub">
      </label>
      <button class="secondary remove-button" type="button">删除</button>
    `;
    row.querySelector('[data-field="enabled"]').checked = source.enabled !== false;
    row.querySelector('[data-field="name"]').value = source.name;
    row.querySelector('[data-field="url"]').value = source.url;
    row.querySelector('.remove-button').addEventListener('click', () => {
      state.sources = state.sources.filter((item) => item.id !== source.id);
      renderSources();
    });
    sourcesList.append(row);
  }
}

function readSourcesFromDom() {
  state.sources = [...sourcesList.querySelectorAll('.source-row')].map((row) => ({
    id: row.dataset.id,
    enabled: row.querySelector('[data-field="enabled"]').checked,
    name: row.querySelector('[data-field="name"]').value.trim(),
    url: row.querySelector('[data-field="url"]').value.trim(),
  }));
}

function renderSubscriptionLink() {
  subscriptionLink.value = `${location.origin}${state.subscriptionPath}`;
}

async function copySubscriptionLink() {
  await navigator.clipboard.writeText(subscriptionLink.value);
  setStatus('已复制');
}

function showManager() {
  loginView.hidden = true;
  managerView.hidden = false;
  renderSubscriptionLink();
}

function showLogin() {
  state.subscriptionPath = '';
  subscriptionLink.value = '';
  managerView.hidden = true;
  loginView.hidden = false;
  passwordInput.focus();
}

function setStatus(message, isError = false) {
  statusText.textContent = message;
  statusText.className = isError ? 'error' : '';
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
