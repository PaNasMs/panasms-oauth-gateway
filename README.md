# PaNasMs OAuth gateway

This repository holds the OAuth redirect gateway used by
[PaNasMs](https://github.com/PaNasMs/panasms), a browser panel for managing a NAS
on Debian-based Linux. It is a Cloudflare Worker that receives the provider's
redirect after a user authorizes Google, GitHub or Dropbox, and passes the
authorization code back to the NAS that started the flow. Project website:
<https://panasms.github.io/>.

The public deployment is:

```
https://panasms-oauth-gateway.panasms.workers.dev/callback
```

## Why a gateway

An OAuth provider redirects the browser to a registered HTTPS URL. A NAS on a
home network usually has only a LAN address such as `http://192.168.1.10`, which
providers do not accept as a redirect target, and it should not need an inbound
public address. Every NAS therefore registers the gateway's `/callback` URL as its
redirect URI, and the gateway hands the code back to the NAS that asked for it.

Each NAS still registers its own OAuth client with the provider and keeps its own
client ID and secret. The gateway shares only the redirect URI.

## What the gateway sees

The gateway relays the authorization `code`, or the provider's `error`, and
nothing else. It never receives a client secret, an access token or a refresh
token. The NAS exchanges the code for tokens itself.

1. The NAS builds the provider's authorization URL with its own client ID,
   `redirect_uri=<gateway>/callback` and a random one-time `state`, and opens it
   in the user's browser.
2. The provider redirects the browser to `GET <gateway>/callback?code=...&state=...`.
3. The gateway stores the code under `state` in Cloudflare KV for 10 minutes and
   shows a page that tells the user to return to the PaNasMs tab.
4. The NAS polls `GET <gateway>/exchange?state=...`. The first successful poll
   returns the code and deletes it, so each code can be read once.
5. The NAS exchanges the code for tokens with the provider, using its own client
   secret.

The callback page removes the OAuth query parameters from browser history and
does not put the code in the HTML. It tries to close its tab automatically after
the result is stored. If the browser blocks that, the page shows a **Close tab**
button and tells the user to go back to the PaNasMs tab, which finishes the flow
on its own. Responses use `Cache-Control: no-store`, `Referrer-Policy: no-referrer`
and a nonce-based Content Security Policy.

## Endpoints

| Method | Path | Result |
| --- | --- | --- |
| GET | `/callback` | Stores `code` (up to 2048 characters) or `error` (cut to 256 characters) under `state` and shows a status page. A malformed `state`, or a request without a code or error, gets an error page and stores nothing. |
| GET | `/exchange` | Returns `{"code": ...}` or `{"error": ...}` once, then deletes it. Returns 404 `{"status":"pending"}` while nothing is stored and 400 `{"error":"invalid_state"}` for a malformed `state`. |
| GET | `/healthz` | Returns `{"ok":true}`. |

`state` must match `^[A-Za-z0-9_-]{16,128}$`. Other paths return 404, and any
method other than GET returns 405.

## Using it from a NAS

Register the exact URL above as the redirect or callback URL of the NAS's OAuth
client at the provider, then enter the client ID and secret in the PaNasMs panel
under **Settings**, **External connections**. The core uses the same URL when it
exchanges the code. The website has setup guides for
[Google](https://panasms.github.io/docs/setup/google/),
[GitHub](https://panasms.github.io/docs/setup/github/) and
[Dropbox](https://panasms.github.io/docs/setup/dropbox/).

## Development and deployment

The Worker is a single file, `src/index.js`, with its configuration in
`wrangler.toml` and tests in `test/gateway.test.js`. The tests use Node's built-in
test runner and do not touch the network.

```bash
npm ci
npm test                                # unit tests, no network
npx wrangler login                      # once
npx wrangler kv namespace create STATE  # new deployment only; put the id in wrangler.toml
npm run dev                             # local Worker at http://127.0.0.1:8787/healthz
npm run deploy                          # manual deploy
```

The [CI workflow](.github/workflows/deploy.yml) runs the tests on Node.js 22 for
every push and pull request, and deploys with Wrangler on every push to `main`.
It needs two repository secrets:

- `CLOUDFLARE_API_TOKEN`, a token with the **Workers Scripts: Edit** and
  **Workers KV Storage: Edit** permissions.
- `CLOUDFLARE_ACCOUNT_ID`, the Cloudflare account ID.

## License

[PolyForm Noncommercial 1.0.0](LICENSE).
