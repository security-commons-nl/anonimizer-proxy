# anonimizer-proxy

> Cloudflare Worker — minimale forward-only proxy naar de Mistral API voor [anonimizer-browser](https://github.com/security-commons-nl/anonimizer-browser).

[![Bijdragen](https://img.shields.io/badge/📝_Bijdragen-238636?style=for-the-badge)](../../issues/new/choose)&nbsp;&nbsp;&nbsp;&nbsp;[![Meepraten](https://img.shields.io/badge/💬_Meepraten-0969da?style=for-the-badge)](../../discussions)

---

## Waarom

`anonimizer-browser` is een browser-only tool, dus de Mistral-API moet rechtstreeks vanuit de browser aangeroepen worden. Twee opties voor de eindgebruiker:

1. **Bring your own key (BYOK)** — perfecte privacy, hoge drempel: eigen Mistral-account, betaalmethode, key genereren.
2. **Via deze proxy** — geen drempel, jij (security-commons-nl) betaalt Mistral, gebruiker hoeft niks te configureren.

Deze repo levert optie 2 op een uitlegbare, minimale manier.

## Wat de proxy WEL doet

- `POST /v1/chat/completions` forwarden naar `api.mistral.ai`
- `Authorization`-header injecteren uit een Worker-secret
- Rate-limiten per client-IP (default 20 requests / minuut) via Cloudflare's native rate-limiter
- CORS-headers afgeven voor de officiële frontend-origin
- `messages`-array valideren (1–4 entries, JSON-vorm) om misbruik te beperken
- Model en `response_format` forceren (`mistral-large-latest`, JSON-mode) zodat de proxy niet als open chat-API te misbruiken is

## Wat de proxy NIET doet

- Inhoud loggen (geen request- of response-body in observability)
- State bewaren
- Andere endpoints exposen (`/v1/embeddings`, `/v1/files`, etc.)
- Andere modellen ondersteunen
- Eigen retry-logic
- Caching

Door deze scope is de AVG-verwerkersrol minimaal en uitlegbaar — zie de [DPA-template](https://github.com/security-commons-nl/.github/blob/main/DPA-template.md) in de organisatie-repo.

## Architectuur

```
browser ─POST /v1/chat/completions─▶ anonimizer-proxy ─POST /v1/chat/completions─▶ api.mistral.ai
                                          │
                                          ├─ rate-limit per IP (Cloudflare native)
                                          ├─ messages-validatie
                                          └─ Authorization injectie uit secret
```

## Lokaal draaien

```bash
npm install
npm test
```

Voor lokaal testen tegen een echte Mistral-API:

```bash
wrangler secret put MISTRAL_API_KEY    # plak je dev-key
npm run dev
```

## Deploy

Vereist een Cloudflare-account met Workers paid plan (free tier ondersteunt geen native rate-limiter — voor MVP is `$5/maand` voldoende).

```bash
# Eenmalig:
npx wrangler login
npx wrangler secret put MISTRAL_API_KEY

# Bij elke wijziging:
npx wrangler deploy
```

De worker is daarna bereikbaar op `https://anonimizer-proxy.<je-cf-account>.workers.dev` of een custom domein.

## Configuratie

Niet-gevoelige config in `wrangler.toml` (vars):

| Variabele | Default | Wat het doet |
|---|---|---|
| `ALLOWED_ORIGINS` | `https://security-commons-nl.github.io` | Komma-gescheiden lijst origins die de proxy mogen aanroepen |
| `MISTRAL_BASE_URL` | `https://api.mistral.ai` | Doelhost — alleen wijzigen voor testen of EU-mirror |
| `MISTRAL_MODEL` | `mistral-large-latest` | Welke model upstream wordt aangeroepen |

Secret (via `wrangler secret put`):

| Secret | Wat het is |
|---|---|
| `MISTRAL_API_KEY` | Jouw eigen Mistral API-key. Wordt nooit aan de client doorgegeven. |

## Kosten-overweging

| Resource | Free tier | Bij realistisch gebruik |
|---|---|---|
| Cloudflare Workers requests | 100 000 / dag | < 1% gebruikt |
| Cloudflare rate-limiter | Workers Paid (~$5/mnd) | basis voor MVP |
| Mistral API | n.v.t. | ~€0,002 per document afhankelijk van lengte |

Per-IP rate limiting voorkomt dat één misbruiker je Mistral-budget leegtrekt. Bij twijfel kun je de limit in `wrangler.toml` verlagen of een hardere cap inbouwen.

## Licentie

EUPL-1.2 — zie [LICENSE](LICENSE).
