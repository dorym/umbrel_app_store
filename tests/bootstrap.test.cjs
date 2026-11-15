'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const Database = require('/app/node_modules/better-sqlite3');

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mediadec-bootstrap-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'cache.db');
}
function run(databasePath, password) {
  const env = { ...process.env, CACHE_DB_PATH: databasePath };
  delete env.UMBREL_APP_PASSWORD;
  if (password !== undefined) env.UMBREL_APP_PASSWORD = password;
  return spawnSync(process.execPath, ['/bootstrap.cjs'], { env, encoding: 'utf8' });
}
function credentials(databasePath) {
  const db = new Database(databasePath);
  try { return db.prepare('SELECT * FROM auth_credentials').all(); }
  finally { db.close(); }
}

test('first install seeds the Umbrel password without logging it', (t) => {
  const databasePath = fixture(t);
  const password = 'synthetic-password-' + crypto.randomBytes(16).toString('hex');
  const result = run(databasePath, password);
  assert.equal(result.status, 0);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, '');
  const rows = credentials(databasePath);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].username, 'admin');
  assert.equal(rows[0].password_hash,
    crypto.scryptSync(password, rows[0].salt, 64).toString('hex'));
});

test('restart never resets a changed password or deletes settings', (t) => {
  const databasePath = fixture(t);
  assert.equal(run(databasePath, 'synthetic-initial-password').status, 0);
  const db = new Database(databasePath);
  db.prepare('UPDATE auth_credentials SET password_hash = ?, salt = ?')
    .run('synthetic-changed-hash', 'synthetic-changed-salt');
  db.exec('CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
  db.prepare('INSERT INTO app_settings VALUES (?, ?)').run('synthetic-setting', 'retained');
  db.close();
  const before = credentials(databasePath);
  assert.equal(run(databasePath, 'synthetic-different-umbrel-password').status, 0);
  assert.deepEqual(credentials(databasePath), before);
  const reopened = new Database(databasePath);
  try {
    assert.equal(reopened.prepare('SELECT value FROM app_settings WHERE key = ?')
      .get('synthetic-setting').value, 'retained');
  } finally { reopened.close(); }
  assert.equal(run(databasePath, undefined).status, 0);
  assert.deepEqual(credentials(databasePath), before);
});

test('missing first-install password fails closed without creating an account', (t) => {
  const databasePath = fixture(t);
  const result = run(databasePath, undefined);
  assert.equal(result.status, 1);
  assert.deepEqual(credentials(databasePath), []);
});

test('short first-install password fails closed and is not logged', (t) => {
  const databasePath = fixture(t);
  const password = 'tiny';
  const result = run(databasePath, password);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(password));
  assert.ok(!result.stderr.includes(password));
  assert.deepEqual(credentials(databasePath), []);
});

test('an invalid database path fails without leaking the password', (t) => {
  const databasePath = fixture(t);
  fs.mkdirSync(databasePath, { recursive: true });
  const password = 'synthetic-never-log-this-password';
  const result = run(databasePath, password);
  assert.equal(result.status, 1);
  assert.ok(!result.stdout.includes(password));
  assert.ok(!result.stderr.includes(password));
});
