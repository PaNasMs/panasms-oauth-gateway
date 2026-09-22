# panasms-oauth-gateway

A tiny, stateless **OAuth redirect gateway** shared by all [PaNasMs](https://github.com/PaNasMs)
NAS devices. It exists so a NAS can complete a one-click OAuth flow (Google Drive, Dropbox, …)
without exposing its LAN address to the provider as a redirect URI.

## Why this exists

Each NAS registers its **own** OAuth client (its own `client_id`/`client_secret`) with the
provider. But an OAuth provider must redirect the browser to a stable, public HTTPS URL — a NAS
sitting on `http://192.168.x.x` can't be that URL. So every NAS points its redirect URI at this
single shared gateway, and the gateway hands the authorization `code` back to the right NAS.

Providers throttle *shared client_ids*, not a redirect URI shared across *distinct* clients — so
this stays clean at any number of NASes.

## What it does (and doesn't)

It **relays the authorization `code` only.** It never sees a `client_secret` or any token — the
NAS performs the `code → token` exchange itself.

Flow:

1. NAS builds the provider authorize URL: its `client_id`, `redirect_uri=<gateway>/callback`, and
   a one-time random `state`. It opens that URL in the admin's browser.
2. Provider redirects the browser to `GET <gateway>/callback?code=…&state=…`.
3. Gateway stores `code` under `state` in KV with a ~10-minute TTL and shows a "close this tab"
   page.
4. NAS polls `GET <gateway>/exchange?state=…`, receives the `code`, and the gateway deletes it
   (one-shot).
5. NAS exchanges the `code` for tokens against the provider using its own `client_secret`.

## Endpoints

| Method | Path         | Purpose                                                            |
| ------ | ------------ | ------------------------------------------------------------------ |
| GET    | `/callback`  | Provider redirect target. Stores `code` (or `error`) under `state`.|
| GET    | `/exchange`  | NAS polls with `state`; returns `{code}` / `{error}` once, or 404 `{status:"pending"}`. |
| GET    | `/healthz`   | `{ok:true}`.                                                       |

`state` must match `^[A-Za-z0-9_-]{16,128}$`. Anything else → 404. Non-GET → 405.

## Pointing a NAS at it

Register this exact redirect URI in the provider console (Google Cloud Console / Dropbox App
Console) for the NAS's OAuth client, and use the same value at token-exchange time:

```
https://<gateway-domain>/callback
```

The Cloud Sync module surfaces this value in its admin settings.

## Hosting — Cloudflare Worker

```bash
npm install
npm test                       # router unit tests, no network
wrangler login                 # once
wrangler kv namespace create STATE   # paste the printed id into wrangler.toml
npm run dev                    # local: http://127.0.0.1:8787/healthz
npm run deploy                 # manual deploy
```

### CI/CD

`.github/workflows/deploy.yml` runs the tests on every push/PR and deploys on push to `main`.
Configure two repository secrets:

- `CLOUDFLARE_API_TOKEN` — token with **Workers Scripts: Edit** + **Workers KV Storage: Edit**.
- `CLOUDFLARE_ACCOUNT_ID` — your Cloudflare account id.

## License

[PolyForm Noncommercial 1.0.0](LICENSE).
