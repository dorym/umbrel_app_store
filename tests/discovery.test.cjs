'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { spawnSync } = require('node:child_process');
const Database = require('/app/node_modules/better-sqlite3');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'mediadec-discovery-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return path.join(directory, 'cache.db');
}
function discovery() {
  const script = process.env.DISCOVERY_SCRIPT || '/discovery.cjs';
  assert.ok(fs.existsSync(script), 'Optional integration discovery is missing');
  return require(script);
}
function settings(databasePath) {
  const db = new Database(databasePath);
  try {
    return Object.fromEntries(db.prepare('SELECT key, value FROM app_settings').all()
      .map(row => [row.key, row.value]));
  } finally { db.close(); }
}
function seed(databasePath, values = {}) {
  const db = new Database(databasePath);
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  for (const [key, value] of Object.entries(values)) {
    db.prepare('INSERT INTO app_settings VALUES (?, ?)').run(key, value);
  }
  db.close();
}
async function listener(t) {
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

test('reachable official services fill only their empty URL settings', async (t) => {
  const databasePath = fixture(t);
  new Database(databasePath).close();
  await discovery().discoverOptionalArr({ databasePath, probe: async () => true });
  assert.deepEqual(settings(databasePath), {
    radarrUrl: 'http://radarr_server_1:7878',
    sonarrUrl: 'http://sonarr_server_1:8989',
  });
});

test('saved URLs, API keys and unrelated settings are never overwritten', async (t) => {
  const databasePath = fixture(t);
  const initial = {
    radarrUrl: 'http://synthetic-external-radarr:7878',
    sonarrUrl: 'http://synthetic-external-sonarr:8989',
    radarrApiKey: 'synthetic-radarr-key', sonarrApiKey: 'synthetic-sonarr-key',
    mediaRoots: '["/synthetic-media"]',
  };
  seed(databasePath, initial);
  let probed = false;
  await discovery().discoverOptionalArr({ databasePath, probe: async () => { probed = true; return true; } });
  assert.equal(probed, false);
  assert.deepEqual(settings(databasePath), initial);
});

test('unavailable optional integrations leave URLs empty without failing', async (t) => {
  const databasePath = fixture(t);
  seed(databasePath, { radarrUrl: '', sonarrUrl: '' });
  const result = await discovery().discoverOptionalArr({ databasePath, probe: async () => false });
  assert.deepEqual(result, { radarrUrl: false, sonarrUrl: false });
  assert.deepEqual(settings(databasePath), { radarrUrl: '', sonarrUrl: '' });
});

test('each optional service can be detected independently', async (t) => {
  const databasePath = fixture(t);
  seed(databasePath);
  await discovery().discoverOptionalArr({ databasePath,
    probe: async (host, port) => host === 'radarr_server_1' && port === 7878 });
  assert.deepEqual(settings(databasePath), { radarrUrl: 'http://radarr_server_1:7878' });
});

test('a later startup detects services installed after MediaDec', async (t) => {
  const databasePath = fixture(t);
  seed(databasePath);
  await discovery().discoverOptionalArr({ databasePath, probe: async () => false });
  await discovery().discoverOptionalArr({ databasePath, probe: async () => true });
  assert.equal(settings(databasePath).sonarrUrl, 'http://sonarr_server_1:8989');
});

test('a manual URL saved while discovery is pending wins', async (t) => {
  const databasePath = fixture(t);
  seed(databasePath, { sonarrUrl: 'http://synthetic-existing:8989' });
  await discovery().discoverOptionalArr({ databasePath, probe: async () => {
    const db = new Database(databasePath);
    db.prepare('INSERT INTO app_settings VALUES (?, ?)').run('radarrUrl', 'http://synthetic-manual:7878');
    db.close();
    return true;
  } });
  assert.equal(settings(databasePath).radarrUrl, 'http://synthetic-manual:7878');
});

test('a failed probe does not prevent detecting the other service', async (t) => {
  const databasePath = fixture(t);
  seed(databasePath);
  await discovery().discoverOptionalArr({ databasePath, probe: async host => {
    if (host === 'radarr_server_1') throw new Error('synthetic DNS failure');
    return true;
  } });
  assert.deepEqual(settings(databasePath), { sonarrUrl: 'http://sonarr_server_1:8989' });
});

test('missing database is optional and does not create another database', async (t) => {
  const databasePath = fixture(t);
  const result = await discovery().discoverOptionalArr({ databasePath, probe: async () => true });
  assert.deepEqual(result, { radarrUrl: false, sonarrUrl: false });
  assert.equal(fs.existsSync(databasePath), false);
});

test('the standalone discovery process exits successfully for missing storage', (t) => {
  const databasePath = fixture(t);
  discovery();
  const script = process.env.DISCOVERY_SCRIPT || '/discovery.cjs';
  const result = spawnSync(process.execPath, [script], {
    env: { ...process.env, CACHE_DB_PATH: databasePath }, encoding: 'utf8', timeout: 4000,
  });
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  assert.equal(fs.existsSync(databasePath), false);
});

test('DNS discovery succeeds only when the resolved TCP port responds', async (t) => {
  const server = await listener(t);
  let requestedHost;
  const result = await discovery().probeTcp('radarr_server_1', server.address().port, {
    resolverFactory: () => ({
      resolve4(host, callback) { requestedHost = host; callback(null, ['127.0.0.1']); },
      cancel() {},
    }),
  });
  assert.equal(requestedHost, 'radarr_server_1');
  assert.equal(result, true);
});

test('DNS failure is a normal unavailable result', async () => {
  const result = await discovery().probeTcp('synthetic-absent', 7878, {
    resolverFactory: () => ({
      resolve4(_host, callback) { callback(new Error('synthetic unavailable')); },
      cancel() {},
    }),
  });
  assert.equal(result, false);
});

test('DNS requests that never answer are cancelled at the deadline', { timeout: 2000 }, async () => {
  let cancelled = false;
  const result = await discovery().probeTcp('synthetic-no-answer', 7878, {
    timeoutMs: 20,
    resolverFactory: () => ({ resolve4() {}, cancel() { cancelled = true; } }),
  });
  assert.equal(result, false);
  assert.equal(cancelled, true);
});

test('a refused TCP port is unavailable rather than a startup error', async () => {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  assert.equal(await discovery().probeTcp('127.0.0.1', port, { timeoutMs: 200 }), false);
});
