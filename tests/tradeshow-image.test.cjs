'use strict';

// Native, offline image integration test (no npm install and no mocked database).
// Run from the store root:
// docker run --rm --network none --entrypoint node \
//   -v "$PWD/tests/tradeshow-image.test.cjs:/tradeshow-image.test.cjs:ro" \
//   leoparm/tradeshow:0.1.1@sha256:804ce66897bf26772fda742e31eed8c8c35661a4f6a803773b009abcb21848fe \
//   --test /tradeshow-image.test.cjs
// The image WORKDIR must be /app. Only a fresh /tmp directory is used for state.
// Forwarded HTTPS below is HTTP loopback with proxy headers: NOT TLS/browser QA.
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const transport = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const { createRequire } = require('node:module');
const { createHash, randomBytes } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');

const APP = '/app';
const NAMESPACE = 'leoparm-tradeshow';
const EMAIL = 'native-admin@example.invalid';
const PASSWORD = 'Synthetic-native-test-only-2026!';
const SECRET = randomBytes(32).toString('hex'); // stable for every restart in this run
let root, dbPath, origin, child, startError;
const children = new Set();
let Database;

// Load the image's own native addon/dependency tree, not the host checkout's.
function inspectDatabase(fn) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    return fn(db);
  } finally { db.close(); }
}

async function stopServer() {
  if (!child) return;
  const target = child;
  child = undefined;
  if (target.exitCode === null && target.signalCode === null) {
    const exited = once(target, 'exit');
    target.kill('SIGTERM');
    const timer = setTimeout(() => target.kill('SIGKILL'), 8000);
    try { await exited; } finally { clearTimeout(timer); }
  }
  children.delete(target);
}

async function startServer(secret = SECRET) {
  await stopServer();
  const probe = net.createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  origin = `http://127.0.0.1:${port}`;
  const env = { ...process.env, NODE_ENV: 'production', HOSTNAME: '0.0.0.0',
    PORT: String(port), SQLITE_PATH: dbPath, AUTH_SECRET: secret,
    AUTH_TRUST_HOST: 'true', AUTH_COOKIE_NAMESPACE: NAMESPACE,
    AUTH_URL: 'https://tradeshow.synthetic.invalid:3057' };
  // Match the package's canonical Umbrel HTTPS URL; inherited alternatives must not override it.
  for (const key of ['NEXTAUTH_URL', 'NEXT_PHASE', 'NODE_OPTIONS']) delete env[key];
  startError = undefined;
  child = spawn(process.execPath, ['server.js'], { cwd: APP, env, stdio: ['ignore', 'pipe', 'pipe'] });
  children.add(child);
  child.once('error', () => { startError = true; });
  // Consume logs but never print cookies, auth tokens or response bodies into TAP.
  child.stdout.resume();
  child.stderr.resume();
  for (let attempt = 0; attempt < 160; attempt++) {
    assert.ok(!startError && child.exitCode === null && child.signalCode === null,
      'native standalone server must remain running');
    try {
      const response = await fetch(`${origin}/api/auth/session`, {
        signal: AbortSignal.timeout(1000), headers: { 'x-forwarded-proto': 'http' } });
      await response.text();
      if (response.status === 200) return;
    } catch { /* bounded readiness polling */ }
    await delay(250);
  }
  throw new Error('native standalone server readiness timeout');
}

function client(https = true) {
  const jar = new Map();
  const setCookies = [];
  // Preserve the public Host just as a reverse proxy does; Next normalizes
  // loopback IP hostnames to localhost, so transport and application origins differ.
  const publicOrigin = () => `${https ? 'https' : 'http'}://tradeshow.synthetic.invalid:3057`;
  return {
    jar, setCookies, publicOrigin,
    async request(route, options = {}) {
      const headers = new Headers(options.headers);
      headers.set('x-forwarded-proto', https ? 'https' : 'http');
      headers.set('x-forwarded-host', new URL(publicOrigin()).host);
      headers.set('host', new URL(publicOrigin()).host);
      if (jar.size) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
      // Node's fetch silently discards a custom Host. Use the real HTTP client
      // so proxy-origin assertions exercise the supplied public Host header.
      const encoded = new Request(`${origin}${route}`, { ...options, headers });
      const payload = options.body === undefined ? undefined : Buffer.from(await encoded.arrayBuffer());
      const response = await new Promise((resolve, reject) => {
        const request = transport.request(`${origin}${route}`, {
          method: encoded.method, headers: Object.fromEntries(encoded.headers),
          signal: AbortSignal.timeout(20000),
        }, incoming => {
          const chunks = [];
          incoming.on('data', chunk => chunks.push(chunk));
          incoming.once('error', reject);
          incoming.once('end', () => {
            const responseHeaders = new Headers();
            for (let i = 0; i < incoming.rawHeaders.length; i += 2) {
              responseHeaders.append(incoming.rawHeaders[i], incoming.rawHeaders[i + 1]);
            }
            resolve(new Response(incoming.statusCode === 204 ? null : Buffer.concat(chunks), {
              status: incoming.statusCode, headers: responseHeaders,
            }));
          });
        });
        request.once('error', reject);
        request.end(payload);
      });
      for (const cookie of response.headers.getSetCookie()) {
        setCookies.push(cookie);
        const [name, ...value] = cookie.split(';', 1)[0].split('=');
        if (/;\s*Max-Age=0(?:;|$)/i.test(cookie)) jar.delete(name);
        else jar.set(name, value.join('='));
      }
      return response;
    },
    async json(route, method = 'GET', data) {
      const response = await this.request(route, { method,
        ...(data === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) }) });
      return { response, body: response.status === 204 ? null : await response.json() };
    },
  };
}

async function login(c, username = EMAIL, password = PASSWORD) {
  const csrf = await c.json('/api/auth/csrf');
  assert.equal(csrf.response.status, 200);
  assert.equal(typeof csrf.body.csrfToken, 'string');
  const body = new URLSearchParams({ username, password, csrfToken: csrf.body.csrfToken,
    callbackUrl: `${c.publicOrigin()}/accounts` });
  const response = await c.request('/api/auth/callback/credentials', { method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' }, body });
  assert.equal(response.status, 200);
  return (await response.json()).url;
}

function assertCookies(c, secure) {
  const prefix = secure ? '__Secure-' : '';
  const csrfPrefix = secure ? '__Host-' : '';
  for (const name of [`${prefix}${NAMESPACE}.authjs.session-token`,
    `${csrfPrefix}${NAMESPACE}.authjs.csrf-token`, `${prefix}${NAMESPACE}.authjs.callback-url`]) {
    assert.ok(c.jar.has(name), 'all Auth.js cookies must have the deployment namespace/prefix');
    const raw = c.setCookies.findLast(value => value.startsWith(`${name}=`));
    assert.match(raw, /;\s*Path=\/(?:;|$)/i);
    assert.match(raw, /;\s*HttpOnly(?:;|$)/i);
    assert.match(raw, /;\s*SameSite=Lax(?:;|$)/i);
    assert.equal(/;\s*Secure(?:;|$)/i.test(raw), secure);
    assert.doesNotMatch(raw, /;\s*Domain=/i);
  }
  assert.ok([...c.jar.keys()].every(key => key.includes(`${NAMESPACE}.authjs.`)));
}

function migrationSnapshot() {
  const journal = JSON.parse(fs.readFileSync(`${APP}/drizzle/meta/_journal.json`, 'utf8'));
  assert.equal(journal.entries.length, 17, 'v0.1.1 ships all seventeen migrations');
  return inspectDatabase(db => {
    assert.equal(db.pragma('integrity_check', { simple: true }), 'ok');
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');
    const rows = db.prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY id').all();
    assert.deepEqual(rows, journal.entries.map(entry => ({
      hash: createHash('sha256').update(fs.readFileSync(`${APP}/drizzle/${entry.tag}.sql`)).digest('hex'),
      created_at: entry.when,
    })), 'real startup must apply each packaged SQL migration exactly once');
    const columns = table => db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
    assert.ok(columns('users').includes('session_version'));
    assert.ok(columns('users').includes('date_format'));
    assert.ok(columns('assets').includes('identity_key'));
    assert.ok(columns('import_file_rows').includes('review_draft'));
    assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
    return rows;
  });
}

let http, accountId, migrations, httpCallback, httpsCallback, httpsRedirectOrigin;
describe('published Tradeshow 0.1.1 native image', { concurrency: false, timeout: 180000 }, () => {
  before(async () => {
    assert.equal(process.cwd(), APP, 'execute inside the published image at its /app WORKDIR');
    assert.ok(fs.existsSync(`${APP}/server.js`));
    Database = createRequire(`${APP}/package.json`)('better-sqlite3');
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'tradeshow-native-'));
    dbPath = path.join(root, 'tradeshow.db');
    assert.equal(fs.existsSync(dbPath), false);
    await startServer();
    http = client();
  });
  after(async () => {
    await stopServer();
    for (const target of children) {
      child = target;
      await stopServer();
    }
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  test('empty SQLite is migrated by real handlers; setup HTML contains baked v0.1.1 and no demo account', async () => {
    const response = await http.request('/setup');
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, />v(?:<!-- -->)?0\.1\.1</);
    assert.match(html, /Create admin account/);
    assert.doesNotMatch(html, /demo@tradeshow\.app|Demo credentials/i);
    assert.match(html, /name="\$ACTION_ID_[a-f0-9]+"/i);
    assert.equal(fs.readFileSync(dbPath).subarray(0, 16).toString(), 'SQLite format 3\u0000');
    migrations = migrationSnapshot();
    inspectDatabase(db => assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 0));
    const loginPage = await http.request('/login');
    assert.ok([302, 303, 307].includes(loginPage.status));
    assert.equal(new URL(loginPage.headers.get('location'), origin).pathname, '/setup');
  });

  test('unauthenticated protected API mutations cannot create synthetic accounts', async () => {
    const unauthenticated = client();
    const response = await unauthenticated.request('/api/accounts', { method: 'POST',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Must not exist' }) });
    assert.ok([401, 302, 303, 307].includes(response.status));
    if (response.status !== 401) {
      const destination = new URL(response.headers.get('location'), origin);
      assert.equal(destination.pathname, '/login');
    }
    inspectDatabase(db => assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get().n, 0));
  });

  test('first setup posts the actual HTML server action and creates one scrypt admin/default portfolio', async () => {
    const response = await http.request('/setup');
    const html = await response.text();
    const action = html.match(/name="(\$ACTION_ID_[a-f0-9]+)"/i);
    assert.ok(action, 'discover the baked action ID, never hardcode it');
    const form = new FormData();
    for (const [key, value] of Object.entries({ [action[1]]: '', name: 'Native Synthetic Admin',
      email: EMAIL, password: PASSWORD, confirm: PASSWORD })) form.set(key, value);
    const created = await http.request('/setup', { method: 'POST', headers: { origin: http.publicOrigin() }, body: form });
    await created.text();
    assert.equal(created.status, 303);
    assert.equal(new URL(created.headers.get('location'), origin).pathname, '/login');
    inspectDatabase(db => {
      const users = db.prepare('SELECT email, role, password_hash FROM users').all();
      assert.equal(users.length, 1);
      assert.equal(users[0].email, EMAIL);
      assert.equal(users[0].role, 'admin');
      assert.match(users[0].password_hash, /^scrypt/);
      const portfolios = db.prepare('SELECT name, base_currency FROM portfolios').all();
      assert.deepEqual(portfolios, [{ name: 'Default', base_currency: 'USD' }]);
    });
    const page = await http.request('/login');
    assert.equal(page.status, 200);
    const loginHtml = await page.text();
    assert.match(loginHtml, />v(?:<!-- -->)?0\.1\.1</);
    assert.doesNotMatch(loginHtml, /demo@tradeshow\.app|Demo credentials/i);
    const repeated = await http.request('/setup', { method: 'POST', headers: { origin: http.publicOrigin() }, body: form });
    await repeated.text();
    assert.equal(new URL(repeated.headers.get('location'), origin).pathname, '/login');
    inspectDatabase(db => assert.equal(db.prepare('SELECT count(*) AS n FROM users').get().n, 1));
  });

  test('credentials reject wrong passwords, absent demo account and invalid CSRF', async () => {
    for (const [username, password] of [[EMAIL, 'incorrect-synthetic-password'], ['demo@tradeshow.app', 'demo']]) {
      const rejected = client();
      const destination = new URL(await login(rejected, username, password));
      assert.ok(destination.searchParams.has('error'));
      assert.equal((await rejected.json('/api/auth/session')).body, null);
      assert.ok([...rejected.jar.keys()].every(key => !key.endsWith('.authjs.session-token')));
    }
    const rejected = client();
    await rejected.json('/api/auth/csrf');
    const response = await rejected.request('/api/auth/callback/credentials', { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-auth-return-redirect': '1' },
      body: new URLSearchParams({ username: EMAIL, password: PASSWORD, csrfToken: 'deliberately-invalid',
        callbackUrl: `${rejected.publicOrigin()}/accounts` }) });
    assert.equal(response.status, 200);
    assert.match((await response.json()).url, /(?:MissingCSRF|csrf)/i);
    assert.equal((await rejected.json('/api/auth/session')).body, null);
  });

  test('packaged HTTPS login issues namespaced Secure cookies and enforces namespace isolation', async () => {
    httpCallback = await login(http);
    assertCookies(http, true);
    const { response, body } = await http.json('/api/auth/session');
    assert.equal(response.status, 200);
    assert.equal(body.user.email, EMAIL);
    assert.equal(body.user.role, 'admin');
    assert.ok(body.user.id);
    const otherNamespace = client();
    otherNamespace.jar.set('__Secure-other-app.authjs.session-token', http.jar.get(`__Secure-${NAMESPACE}.authjs.session-token`));
    assert.equal((await otherNamespace.json('/api/auth/session')).body, null);
  });

  test('packaged credentials callback preserves the canonical HTTPS origin and requested path', () => {
    assert.equal(httpCallback, `${http.publicOrigin()}/accounts`);
  });

  test('authenticated real HTTP account create/update/read reaches native SQLite', async () => {
    const created = await http.json('/api/accounts', 'POST', { name: 'Synthetic image account', currency: 'USD' });
    assert.equal(created.response.status, 201);
    accountId = created.body.data.id;
    assert.equal(typeof accountId, 'string');
    const updated = await http.json(`/api/accounts/${accountId}`, 'PUT', { name: 'Synthetic persisted account' });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.body.data.name, 'Synthetic persisted account');
    const list = await http.json('/api/accounts');
    assert.equal(list.response.status, 200);
    assert.ok(list.body.data.some(row => row.id === accountId && row.name === 'Synthetic persisted account'));
    inspectDatabase(db => assert.equal(db.prepare('SELECT name FROM accounts WHERE id = ?').get(accountId).name,
      'Synthetic persisted account'));
  });

  test('restart retains SQLite migrations/data and accepts existing session with stable AUTH_SECRET', async () => {
    await startServer();
    assert.deepEqual(migrationSnapshot(), migrations);
    const session = await http.json('/api/auth/session');
    assert.equal(session.response.status, 200);
    assert.equal(session.body.user.email, EMAIL);
    const list = await http.json('/api/accounts');
    assert.equal(list.response.status, 200);
    assert.ok(list.body.data.some(row => row.id === accountId && row.name === 'Synthetic persisted account'));
    const setup = await client().request('/setup');
    assert.equal(new URL(setup.headers.get('location'), origin).pathname, '/login');
  });

  test('changing AUTH_SECRET rejects an old session; restoring the stable secret accepts it', async () => {
    // Preserve the original cookie: failed JWT decoding may expire it in a browser.
    const original = new Map(http.jar);
    await startServer(randomBytes(32).toString('hex'));
    const rejected = client();
    for (const [key, value] of original) rejected.jar.set(key, value);
    assert.equal((await rejected.json('/api/auth/session')).body, null);
    await startServer();
    for (const [key, value] of original) http.jar.set(key, value);
    assert.equal((await http.json('/api/auth/session')).body.user.email, EMAIL);
  });

  test('forwarded HTTPS headers select Secure cookie prefixes and authenticate APIs (no TLS/browser claim)', async () => {
    const https = client(true);
    httpsCallback = await login(https);
    assertCookies(https, true);
    assert.equal((await https.json('/api/auth/session')).body.user.email, EMAIL);
    // The test explicitly supplies Secure cookies over loopback to emulate a TLS terminator.
    const list = await https.json('/api/accounts');
    assert.equal(list.response.status, 200);
    assert.ok(list.body.data.some(row => row.id === accountId));
    const anonymous = await client(true).request('/accounts');
    assert.ok([302, 303, 307].includes(anonymous.status));
    const destination = new URL(anonymous.headers.get('location'), https.publicOrigin());
    assert.equal(destination.pathname, '/login');
    httpsRedirectOrigin = destination.origin;
  });

  test('packaged HTTPS callback and redirect preserve the canonical origin (header simulation only)', () => {
    assert.deepEqual({ callback: httpsCallback, redirectOrigin: httpsRedirectOrigin }, {
      callback: 'https://tradeshow.synthetic.invalid:3057/accounts',
      redirectOrigin: 'https://tradeshow.synthetic.invalid:3057',
    });
  });

  test('authenticated delete persists through a final server restart without seeding demo data', async () => {
    const deleted = await http.json(`/api/accounts/${accountId}`, 'DELETE');
    assert.equal(deleted.response.status, 204);
    await startServer();
    const list = await http.json('/api/accounts');
    assert.equal(list.response.status, 200);
    assert.equal(list.body.data.some(row => row.id === accountId), false);
    inspectDatabase(db => {
      assert.equal(db.prepare('SELECT count(*) AS n FROM accounts').get().n, 0);
      assert.deepEqual(db.prepare('SELECT email, role FROM users').all(), [{ email: EMAIL, role: 'admin' }]);
    });
    assert.deepEqual(migrationSnapshot(), migrations);
  });
});
