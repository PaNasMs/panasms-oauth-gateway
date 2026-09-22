// PaNasMs OAuth gateway — a dumb, stateless redirect target shared by all NASes.
//
// Each NAS registers its OWN OAuth client (client_id/secret) with the provider and points its
// redirect URI at this gateway's /callback. The gateway only ever holds a short-lived
// authorization `code` keyed by an opaque one-time `state`. It never sees client secrets or
// tokens — the NAS exchanges the code for tokens itself.

const STATE_RE = /^[A-Za-z0-9_-]{16,128}$/;
const CODE_MAX = 2048;
const TTL_SECONDS = 600;

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const html = (body) =>
  new Response(
    `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">` +
      `<title>PaNasMs</title><body style="font:16px system-ui;margin:3rem auto;max-width:32rem;text-align:center;color:#222">${body}`,
    { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
  );

async function callback(url, env) {
  const state = url.searchParams.get('state') || '';
  if (!STATE_RE.test(state)) {
    return html('<h1>Invalid request</h1><p>Missing or malformed authorization state. You can close this tab.</p>');
  }
  const error = url.searchParams.get('error');
  const code = url.searchParams.get('code') || '';

  let value;
  if (error) {
    value = { error: String(error).slice(0, 256) };
  } else if (code && code.length <= CODE_MAX) {
    value = { code };
  } else {
    return html('<h1>Authorization failed</h1><p>No authorization code was returned. You can close this tab.</p>');
  }

  await env.STATE.put(state, JSON.stringify(value), { expirationTtl: TTL_SECONDS });
  return html('<h1>Authorized ✓</h1><p>Return to your PaNasMs panel — this tab can be closed.</p>');
}

async function exchange(url, env) {
  const state = url.searchParams.get('state') || '';
  if (!STATE_RE.test(state)) return json(400, { error: 'invalid_state' });

  const raw = await env.STATE.get(state);
  if (raw === null) return json(404, { status: 'pending' });

  await env.STATE.delete(state); // one-shot
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    return json(500, { error: 'corrupt' });
  }
  if (value.error) return json(200, { error: value.error });
  return json(200, { code: value.code });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'GET') return json(405, { error: 'method_not_allowed' });

    switch (url.pathname) {
      case '/callback':
        return callback(url, env);
      case '/exchange':
        return exchange(url, env);
      case '/healthz':
        return json(200, { ok: true });
      default:
        return json(404, { error: 'not_found' });
    }
  },
};
