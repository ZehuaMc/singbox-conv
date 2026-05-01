import assert from 'node:assert/strict';
import test from 'node:test';

test('in-memory logs keep recent entries and return copies', async () => {
  const moduleTag = `${Date.now()}-${Math.random()}`;
  const { appendLog, clearLogs, readLogs } = await import(new URL(`../src/logs.js?${moduleTag}`, import.meta.url));

  clearLogs();
  for (let index = 0; index < 205; index += 1) {
    appendLog('info', `entry ${index}`, { nested: { value: index } });
  }

  const logs = readLogs();
  assert.equal(logs.length, 200);
  assert.equal(logs[0].message, 'entry 5');
  assert.equal(logs.at(-1).message, 'entry 204');

  logs[0].details.nested.value = 'changed';
  assert.equal(readLogs()[0].details.nested.value, 5);

  clearLogs();
  assert.deepEqual(readLogs(), []);
});

test('log details normalize unsafe values', async () => {
  const moduleTag = `${Date.now()}-${Math.random()}`;
  const { appendLog, clearLogs, readLogs } = await import(new URL(`../src/logs.js?${moduleTag}`, import.meta.url));

  clearLogs();
  appendLog('debug', 'normalized', {
    error: new Error('boom'),
    ignored: undefined,
    fn: () => {},
  });

  const [entry] = readLogs();
  assert.equal(entry.level, 'info');
  assert.equal(entry.details.error.name, 'Error');
  assert.equal(entry.details.error.message, 'boom');
  assert.match(entry.details.error.stack, /Error: boom/);
  assert.equal('ignored' in entry.details, false);
  assert.equal('fn' in entry.details, false);
});
