# AI providers: what the browser actually allows

This is the evidence behind the `errorsReadableInBrowser` and `requiredBrowserHeaders`
fields in `src/lib/ai/providers.ts`. Those are measurements, not folklore — and one of
them is the reason the error handling in `src/lib/ai/client.ts` is as careful as it is.

**Nothing here was verified against documentation.** Each endpoint was probed with a
deliberately invalid key so the real code path ran without spending anything.

## Architecture

Bring-your-own-key, called **from the browser**. The user's request goes straight from
their machine to the provider they chose.

Two consequences, both good:

- **This project spends nothing.** No model call is proxied through Convex, so there is
  no per-call database read, no action execution, and nothing on the free-plan quota.
- **No idea text touches a server we run.** Only the provider the user selected sees it.

The cost is that a key typed into a browser cannot be kept secret from that browser.
There is no storage arrangement that fixes this while still letting the browser call the
provider directly. The app therefore defaults to **session-only** (`sessionStorage`) and
makes persistence a separately labelled opt-in, rather than claiming protection it does
not have.

## Measurement 1 — the CORS handshake

`OPTIONS` with `Origin`, `Access-Control-Request-Method: POST`, and
`Access-Control-Request-Headers: authorization,content-type`.

| Provider | Preflight | Notes |
|---|---|---|
| OpenAI | ✅ `ACAO` echoed | |
| Anthropic | ⚠️ 400, then ✅ with `anthropic-dangerous-direct-browser-access` | **see below** |
| Gemini | ✅ `ACAO` echoed | |
| OpenRouter | ✅ `ACAO: *` | |
| Groq | ✅ `ACAO: *` | |

**Anthropic is the trap.** Without the header, the preflight returns `400 Bad Request`
with no `Access-Control-Allow-Origin` at all. Adding
`anthropic-dangerous-direct-browser-access: true` returns `200` with `ACAO: *`. Because
that header has to appear in `Access-Control-Request-Headers`, omitting it fails the
handshake *before any key is examined* — so the symptom looks exactly like a bad key.
It is not in the registry's `requiredBrowserHeaders` without this.

## Measurement 2 — the one that matters

Same preflight, then a **real `POST` with an invalid key**. A provider can pass the
handshake and still withhold the body when authentication fails.

| Provider | `ACAO` on a 401/400? | What the browser hands JavaScript |
|---|---|---|
| **OpenAI** | **no** | `TypeError: Failed to fetch` |
| **Anthropic** | **no** | `TypeError: Failed to fetch` |
| **Gemini** | **no** | `TypeError: Failed to fetch` |
| **Groq** | **no** | `TypeError: Failed to fetch` |
| **OpenRouter** | **yes** (`*`) | the real 401 body |
| local runtimes | n/a | readable |

So the most common user action — pasting an expired, wrong, or ChatGPT-subscription key —
produces an exception indistinguishable from a dead network. Reporting "Failed to fetch"
there would be a lie by omission: the app knows more than it is saying.

`describeFailure` uses the measured flag to convert it. On a provider that withholds the
body, a `TypeError` is reported as *"did not let the browser read the reply"* with the
likely cause and what to check; on one that returns `ACAO: *`, the same exception is
correctly reported as an unreachable host. This is why **OpenRouter is the recommended
first choice**: it is the one that can explain itself when the key is wrong.

## Not verified

**No successful model call has been made.** Every probe used a deliberately invalid key,
so the request/response shapes in `src/lib/ai/adapters.ts` are verified only for their
*construction* and *parsing*, not against a live provider's real reply. A first run with
a real key may reveal a model id or response field that differs from expectation.

That is why `/settings/ai` has a **Test connection** button that makes a real,
eight-token call: it is the fastest way to find out, and it is the user's own key doing
the finding.