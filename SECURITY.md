# Security Policy

HK City Monitor is a public, entirely static web application. This document describes how the
project is secured, the threats it is designed to resist, and how to report a vulnerability.

## Reporting a vulnerability

Report suspected vulnerabilities privately through GitHub's
[security advisory](https://github.com/Cyruschu430/hk-city-monitor/security/advisories/new) form
rather than in a public issue. Please include the affected component, reproduction steps and any
supporting evidence. A response is normally provided within a few days.

Please do not open a public issue, submit a pull request, or disclose the finding elsewhere until
it has been assessed.

## Supported versions

Only the current `master` branch and the live deployment are supported. There are no maintained
release branches.

## Security design

### No credentials in the client

Nothing delivered to the browser may contain a credential. Any key visible in client-side
JavaScript is public by definition. Accordingly:

- Sources that require no key are called directly from the browser.
- Sources that require a key are proxied by the Worker, and the key is held in the Worker's
  environment. It is never inlined into a response.
- The 3D configuration endpoint (`/config/3d`) refuses to serve any URL containing a `key=`,
  `token=` or `signature=` parameter, and logs the refusal. Keyed tilesets must be requested
  through the proxy instead.

### Edge proxy hardening

The Worker is the only server-side component. It is deliberately not a general-purpose proxy:

| Control | Behaviour |
|---|---|
| Host allow-list | Only hosts declared in `sources.json` are proxied; all others are refused. |
| Scheme | `https://` only; credentials in the URL are rejected. |
| Ports | Restricted to the default HTTPS port. |
| Methods | `GET` only. No write or generic POST proxy. |
| Redirects | Followed manually, up to a fixed hop limit, re-validated at every hop. Same-registrable-domain hops may use HTTP or HTTPS; cross-domain hops must be HTTPS **and** allow-listed. |
| Response size | Capped by a streamed byte counter, not by `Content-Length` alone, so chunked responses cannot bypass the limit. |
| Cookies | `Set-Cookie` from upstreams is never forwarded. |
| Caching | Upstream error responses are never cached. |
| Rate limiting | Per-IP, with separate budgets for cache hits and cache misses. |
| Client identity | Derived from `CF-Connecting-IP`, never from forgeable `X-Forwarded-For`. |

### Response headers

A Content-Security-Policy is served with the application, restricting scripts, styles, workers,
images, connections and frames to the origins the application actually uses. `frame-ancestors
'none'` prevents clickjacking. Cross-origin resource sharing is permissive (`*`) but is never
combined with credentials.

### Third-party data handling

Feed content is untrusted input. Every value interpolated into map popups is HTML-escaped before
insertion; there is no unescaped injection path from a third-party response into the DOM.

### Repository hygiene

The repository is public, so every commit and every line of history is visible. Committed
secrets are treated as disclosed, regardless of later removal:

- `.gitignore` excludes `.env` files and key material; only `.env.example` (with placeholder
  values) is committed.
- GitHub secret scanning and push protection are enabled.
- CI workflows are triggered only by `schedule` and `workflow_dispatch`, never by pull requests,
  and run with the minimum required permissions.
- Infrastructure identifiers (host IP addresses and internal hostnames) are not published in this
  repository.

## Threat model

| Threat | Mitigation |
|---|---|
| **Open-proxy abuse** — the Worker used as a free relay or launchpad | Allow-list of upstream hosts; `GET` only; credentials-in-URL rejected; HTTPS only. |
| **Quota exhaustion** — an attacker burning the free-tier request allowance | Per-IP rate limits; the visitor path is served as static JSON so requests do not reach the Worker; cold-load request count is asserted in CI against a fixed budget. |
| **Cross-site scripting** — malicious content in a third-party feed | All popup values escaped; strict CSP. |
| **Clickjacking** | `frame-ancestors 'none'`. |
| **Credential leakage** | No client-side keys; keyed sources proxied; secret scanning enabled. |
| **Cache poisoning** | Upstream errors excluded from the cache; redirects re-validated per hop. |

### Deployment note on rate limiting

Per-IP limits implemented inside the Worker apply per isolate and cannot protect the account-wide
daily request allowance, because a request that reaches the Worker has already been counted
against it. The visitor-facing path is therefore static. If the Worker is ever placed on the
visitor path, an account-level rate-limiting rule — which requires the Worker to be served from a
Cloudflare zone via a custom domain — is the appropriate control.

## Data protection

Most sources are public data and carry no personal information. Two areas are treated as
sensitive:

1. **Tip-offs.** Any future public-submission feature must store submissions outside this
   repository (a private repository or private storage). The public repository may contain the
   submission UI only, never the storage logic.
2. **Crawler caches.** Raw responses containing personal data must not be committed to `data/`.
   Only aggregated or de-identified outputs are committed. De-identification is not sufficient
   where an area contains a single event, since the subject can still be inferred; such cases
   require manual review.

## Pre-release checks

The following checks are run before a release:

```bash
# 1. Secret scan across history
git log -p | grep -iE '(api[_-]?key|secret|token|password)\s*[:=]' | grep -v example

# 2. Confirm no sensitive files are staged
git status --porcelain | grep -E '\.env|secret|credential'

# 3. Check for hard-coded IP addresses
grep -rEn '([0-9]{1,3}\.){3}[0-9]{1,3}' --include='*.json' --include='*.md' --include='*.js' . | grep -v '127\.0\.0\.1'
```

If a credential is ever found in the history, the response is to **rotate the credential first**,
then filter the history. Removing the commit alone does not un-disclose it.
