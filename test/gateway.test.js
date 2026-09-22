import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

// Minimal in-memory stand-in for a Cloudflare KV namespace (TTL ignored — irrelevant to logic).
function fakeKV() {
  const store = new Map();
  return {
    store,
    async put(k, v) {
      store.set(k, v);
    },
    async get(k) {
      return store.has(k) ? store.get(k) : null;
    },
    async delete(k) {
      store.delete(k);
    },
  };
}

const STATE = 'a'.repeat(24);
const call = (path, kv, method = 'GET') =>
  worker.fetch(new Request('https://gw.example' + path, { method }), { STATE: kv });

test('healthz', async () => {
  const res = await call('/healthz', fakeKV());
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown path 404s', async () => {
  const res = await call('/nope', fakeKV());
  assert.equal(res.status, 404);
});

test('non-GET rejected', async () => {
  const res = await call('/callback', fakeKV(), 'POST');
  assert.equal(res.status, 405);
});

test('callback stores code, exchange returns it once then pending', async () => {
  const kv = fakeKV();
  const cb = await call(`/callback?state=${STATE}&code=xyz123`, kv);
  assert.equal(cb.status, 200);
  assert.match(cb.headers.get('content-type'), /text\/html/);

  const first = await call(`/exchange?state=${STATE}`, kv);
  assert.equal(first.status, 200);
  assert.deepEqual(await first.json(), { code: 'xyz123' });

  const second = await call(`/exchange?state=${STATE}`, kv);
  assert.equal(second.status, 404);
  assert.deepEqual(await second.json(), { status: 'pending' });
});

test('provider error is stored and passed through', async () => {
  const kv = fakeKV();
  await call(`/callback?state=${STATE}&error=access_denied`, kv);
  const res = await call(`/exchange?state=${STATE}`, kv);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { error: 'access_denied' });
});

test('malformed state rejected at callback and exchange', async () => {
  const kv = fakeKV();
  const cb = await call('/callback?state=short&code=xyz', kv);
  assert.equal(cb.status, 200); // shows an HTML error page, stores nothing
  assert.match(await cb.text(), /Invalid request/);
  assert.equal(kv.store.size, 0);

  const ex = await call('/exchange?state=short', kv);
  assert.equal(ex.status, 400);
});

test('callback without code or error shows failure page', async () => {
  const kv = fakeKV();
  const cb = await call(`/callback?state=${STATE}`, kv);
  assert.equal(cb.status, 200);
  assert.match(await cb.text(), /Authorization failed/);
  assert.equal(kv.store.size, 0);
});


test('callback closes its tab without exposing authorization data', async () => {
  const kv = fakeKV();
  const response = await call(`/callback?state=${STATE}&code=private-code`, kv);
  const page = await response.text();
  assert.ok(kv.store.has(STATE));
  assert.ok(!page.includes('private-code'));
  assert.ok(!page.includes(STATE));
  assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
  const [, nonce, script] = page.match(/<script nonce="([^"]+)">([\s\S]*?)<\/script>/);
  assert.ok(response.headers.get('content-security-policy').includes(`'nonce-${nonce}'`));
  let closes = 0;
  let click;
  const { runInNewContext } = await import('node:vm');
  runInNewContext(script, {
    history: { replaceState: (_, __, path) => assert.equal(path, '/callback') },
    location: { pathname: '/callback' },
    window: { close: () => closes++ },
    document: { getElementById: () => ({ addEventListener: (_, action) => { click = action; } }) },
    setTimeout: (action, delay) => { assert.equal(delay, 750); action(); },
  });
  assert.equal(closes, 1);
  click();
  assert.equal(closes, 2);
});
