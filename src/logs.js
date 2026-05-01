const MAX_LOG_ENTRIES = 200;
const MAX_LOG_MESSAGE_LENGTH = 500;
const MAX_DETAIL_STRING_LENGTH = 2000;
const MAX_ARRAY_ITEMS = 100;
const MAX_OBJECT_KEYS = 50;
const MAX_DETAIL_DEPTH = 4;
const MAX_STACK_LINES = 12;
const LEVELS = new Set(['info', 'warn', 'error']);

const entries = [];

export function appendLog(level, message, details = {}) {
  const entry = {
    time: new Date().toISOString(),
    level: LEVELS.has(level) ? level : 'info',
    message: String(message || '').slice(0, MAX_LOG_MESSAGE_LENGTH),
  };

  const normalizedDetails = normalizeDetails(details);
  if (normalizedDetails) {
    entry.details = normalizedDetails;
  }

  entries.push(entry);
  if (entries.length > MAX_LOG_ENTRIES) {
    entries.splice(0, entries.length - MAX_LOG_ENTRIES);
  }

  return cloneEntry(entry);
}

export function readLogs() {
  return entries.map(cloneEntry);
}

export function clearLogs() {
  entries.length = 0;
}

function normalizeDetails(details) {
  if (!details || typeof details !== 'object' || Array.isArray(details)) {
    return null;
  }

  const normalized = {};
  for (const [key, value] of Object.entries(details)) {
    const normalizedValue = normalizeDetailValue(value);
    if (normalizedValue !== undefined) {
      normalized[key] = normalizedValue;
    }
  }

  return Object.keys(normalized).length ? normalized : null;
}

function normalizeDetailValue(value, depth = 0) {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }
  if (typeof value === 'string') {
    return value.slice(0, MAX_DETAIL_STRING_LENGTH);
  }
  if (value instanceof Error) {
    return normalizeError(value, depth);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value
      .slice(0, MAX_ARRAY_ITEMS)
      .map((item) => normalizeDetailValue(item, depth + 1))
      .filter((item) => item !== undefined);
  }
  if (typeof value === 'object' && depth < MAX_DETAIL_DEPTH) {
    const normalized = {};
    for (const [key, childValue] of Object.entries(value).slice(0, MAX_OBJECT_KEYS)) {
      const normalizedValue = normalizeDetailValue(childValue, depth + 1);
      if (normalizedValue !== undefined) {
        normalized[key] = normalizedValue;
      }
    }
    return normalized;
  }
  return String(value).slice(0, MAX_DETAIL_STRING_LENGTH);
}

function normalizeError(error, depth) {
  const normalized = {
    name: String(error.name || 'Error').slice(0, MAX_DETAIL_STRING_LENGTH),
    message: String(error.message || '').slice(0, MAX_DETAIL_STRING_LENGTH),
  };

  for (const key of ['code', 'status', 'statusCode', 'errno', 'syscall']) {
    const value = error[key];
    if (value !== undefined) {
      normalized[key] = normalizeDetailValue(value, depth + 1);
    }
  }

  if (typeof error.stack === 'string') {
    normalized.stack = error.stack
      .split('\n')
      .slice(0, MAX_STACK_LINES)
      .join('\n')
      .slice(0, MAX_DETAIL_STRING_LENGTH);
  }

  if (error.cause !== undefined) {
    normalized.cause = normalizeDetailValue(error.cause, depth + 1);
  }

  return normalized;
}

function cloneEntry(entry) {
  const clone = {
    time: entry.time,
    level: entry.level,
    message: entry.message,
  };
  if (entry.details) {
    clone.details = JSON.parse(JSON.stringify(entry.details));
  }
  return clone;
}
