# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Patah Pensill — a Progressive Web App that screens Binance USDT-M Perpetual Futures in real time, entirely client-side (no backend, no API key, no build step). It talks directly to `fapi.binance.com` / `fstream.binance.com` from the user's browser. All persistent state (watchlist, journal, alerts, settings) lives in `localStorage` — nothing is sent to any server the app controls.

Live deploy: https://patahpensil.github.io/screener-crypto-patah-pensill/

The README.md (in Indonesian) is the product-level source of truth for features and scoring systems — read it first for what the app does before touching how it's coded.

## Repo structure

There is no build system, package manager, or bundler, and nothing to compile. This is deployed as-is to GitHub Pages. There *are* now zero-dependency check scripts (see Development workflow below) — they are not a test suite for app behaviour, only a guard against mistakes that would otherwise surface in a user's browser.

```
index.html                     the entire app: HTML + CSS + JS in one file (~5,300 lines)
sw.js                          service worker — caches the app shell, never caches live API data
manifest.json                  PWA metadata
icon-*.png                     app icons
scripts/check.js               static checks (syntax, undefined functions, DOM ids, inline handlers)
scripts/check-cache-bump.js    enforces the CACHE_NAME rule below
scripts/selftest.js            proves check.js actually rejects defects, so it can't rot into always-green
.github/workflows/checks.yml   runs all three on push + PR
```

## Development workflow

- Edit `index.html` directly; there's nothing to compile. Open it in a browser (or serve the folder statically) to test.
- **Before committing, run `node scripts/check.js`.** Requires only Node — no install step. It catches, in seconds, the class of mistake this single-file app is most prone to: a function called but never defined (the `mkComputeFeatures()` bug sat dead for a long time because its ReferenceError was swallowed by a surrounding catch), a `getElementById` pointing at an id that doesn't exist, a duplicate id, an inline `onclick` naming a function that isn't there, or a plain syntax error.
- These checks are static only. They say nothing about whether an indicator is *correct* — that still needs loading the page and exercising the relevant workspace in-browser.
- `node scripts/selftest.js` verifies the checker itself by injecting real defects into a throwaway copy and confirming each one is rejected. Run it after changing `scripts/check.js`.
- Deploy = push to the `main` branch. GitHub Pages is configured in "deploy from a branch" mode (main, root folder) and rebuilds automatically; the live site updates roughly 30–45 seconds after the push. There is no deploy workflow, and none is needed — `.github/workflows/checks.yml` only runs checks.

### ⚠️ MANDATORY: bump the cache version on every change

**Any time `index.html` or `sw.js` is modified, `CACHE_NAME` on line 1 of `sw.js` MUST be bumped** (e.g. `pp-screener-v64` → `pp-screener-v65`). This is not optional, and CI enforces it — `scripts/check-cache-bump.js` fails the build if either file changed without the version moving. The service worker precaches the app shell (`SHELL_FILES`) under this version key and only purges old caches when the key changes (`activate` handler in `sw.js`). Skip the bump and users' browsers keep serving the stale cached shell indefinitely instead of picking up the new code — this is the exact failure mode the README warns about for GitHub Pages deploys.

## Code organization inside `index.html`

This is still **one physical file** — `index.html` is the only source file, there are no separate `.js` files anywhere in the repo (see Repo structure above). The `<script>` block is just internally divided into numbered sections via large comment banners, and each banner happens to be labeled like a filename (a leftover convention from how the author organizes the code mentally). Search for these exact strings to jump around the ~5,300-line file — they are text labels inside comments, not real files to open:

| Banner (comment text, not a file) | Covers |
|---|---|
| `01-storage-alerts.js` | Config constants (`FAPI`, TV bridge URL), `safeFetch` w/ rate-limit backoff, all `localStorage` read/write (watchlist, journal, score history, price alerts, Telegram config), alarm (beep/vibrate/banner), position-size calculator |
| `02-binance-api.js` | Raw Binance REST calls (exchangeInfo, 24hr ticker, premiumIndex/funding, open interest hist, long/short ratio), quick momentum score, the WebSocket connection for true real-time ticker/mark-price updates |
| `03-market-structure.js` | Deep Scan (RSI 1H + EMA trend 4H), swing high/low (fractal) detection, HH/HL vs LH/LL classification, BOS/CHoCH, RSI divergence, OI trend classification |
| `04-scanner-engine.js` | Klines dedup/caching, API request log (for the Data Center view), lazy per-row ADX/direction scan triggered on scroll |
| `05-advanced-scan-events.js` | Mode Trading (scan for entries matching a trading style), watchlist alert checks, canonical EMA-trend helper, DOM event wiring |
| `06-router-detail-setup.js` | The 5-workspace router (`showWorkspace`), sidebar/drawer behavior, export/import, multi-timeframe confluence, detail modal setup (VWAP, Fibonacci) |
| `07-confluence-score-render.js` | **AI Confluence Score** (the one official scoring system) and its render/detail-modal logic |
| `08-entry-plan-init.js` | Entry plan (Entry/SL/TP/RR) generation, break & retest, point-based SOP scoring, "Copy Summary for AI" text builder, TradingView bridge integration, app init/bootstrap sequence |

Comments in these banners also reference external docs like `02_System_Architecture.md`, `03_Binance_Integration.md`, etc. — those files are **not** in this repo (private author notes); treat the banners themselves as the available documentation.

The Markov Screener is a separate, clearly-delimited block (search `MARKOV SCREENER MODULE`) — it's statistically independent from the scoring systems above (Markov chain over historical 4H-candle states, Laplace smoothing + Wilson lower bound for confidence), used for monitoring only, never entry decisions.

## Scoring systems — do not conflate these

The app deliberately has **two separate, non-interchangeable scores**; keep them distinct in any change:

1. **AI Confluence Score** (`computeConfluenceCategories`, under the `07-confluence-score-render.js` comment banner in `index.html`) — the *only* official score used for entry decisions, shown in the Analysis/Validation/Decision workspace. 12 weighted categories summing to 100 (weights are hardcoded and documented inline above `computeConfluenceCategories`: Market Structure 17, Multi Timeframe 15, Momentum 11, Volume 8, Funding 8, Open Interest 8, Orderflow 8, Liquidity 7, Divergence RSI 5, Pattern 5, Risk 5, News 3). `News` has no real data source and is always neutral (50) — this is intentional and documented, not a bug.
2. **Momentum / Quick Score** (`computeMomentumScore`) — a cheap heuristic (`|24h % change| + volatility`) used only to sort the 400+ pair list in Scanner Market. It is explicitly *not* an official signal — UI copy always labels it "skor cepat, bukan AI Confluence Score".

`ADX_TREND_THRESHOLD` (currently 25) is the single canonical ADX cutoff used everywhere (criteria scoring, UI labels, AI summary text) — a past bug was two different thresholds in different places going out of sync. If you touch ADX logic, keep every usage referencing this one constant.

## Key architectural conventions

- **Canonical indicator functions**: `ema()`, `rsiSeries()` etc. are defined once and reused everywhere (Deep Scan, confluence, Markov Screener) specifically so the same pair never shows two different RSI/EMA readings in different parts of the UI. When adding a new feature that needs an indicator, reuse the existing function rather than rolling a new calculation — this has been a recurring source of bugs when violated (see the comment above `mkComputeFeaturesAt` describing a past ~3% directional-accuracy bug from a duplicate cold-start EMA implementation).
- **Global mutable state** lives in top-level `let`s near the top of the script: `tickerData` (merged 24hr REST + WS data), `deepData` (per-symbol RSI/trend cache), `allSymbols`, `lastDetailFull` (last rendered detail modal's full computed data, used by "Copy Summary for AI"), `currentWorkspace`.
- **REST + WebSocket hybrid**: initial load is REST (`refreshAll()`), then `connectBinanceWS()` layers on true real-time ticker/mark-price streams, merged into the same `tickerData` array. If WS fails, the app keeps working via REST polling every 45s — don't make new features hard-depend on the WS path being connected.
- **Rate-limit handling**: all Binance calls go through `safeFetch`, which backs off exponentially on HTTP 429/418 and resets on success (`rateLimitCooldownUntil`, `rateLimitBackoffMs`). Any new API call should go through `safeFetch`, not raw `fetch`.
- **The service worker never caches live data**: any URL containing `fapi.binance.com` or `fstream.binance.com` bypasses the cache entirely (`sw.js`). Only the app shell files are cached, and `index.html`/`manifest.json` are network-first. Don't add Binance endpoints to `SHELL_FILES`.
- **No secrets anywhere**: this app has no API keys by design (public Binance endpoints only). The optional Telegram integration and TradingView bridge store their config (bot token, chat ID, bridge URL) in `localStorage` only, set by the user via UI — never hardcode credentials or bridge URLs into the source.
- **This repo is PUBLIC on GitHub.** Before every commit, double-check the diff for any Telegram bot token, chat ID, or bridge URL (e.g. LAN IPs like `192.168.x.x:8787`) that may have been pasted in for local testing — none of that may ever be committed.
- **`pushAlert(msg, symbol, isAlarm, telegramMsg)`** (under the `01-storage-alerts.js` comment banner in `index.html`) is the single, sole pathway for all alerts (log entry, vibrate, beep, on-screen banner, browser Notification, Telegram). Telegram is only sent when `isAlarm=true`. `pushAlert` itself does not dedupe — callers are responsible for their own cooldown before invoking it (e.g. Deep Scan uses `pp_deepscan_alerted` in `localStorage` with a 30-minute cooldown keyed by `symbol+'_'+bias`; the general alert log also has a separate per-session dedupe set, `alertFiredThisSession`, keyed `"SYMBOL|type"`). Any new alert-producing feature should go through `pushAlert` and add its own appropriately-keyed cooldown rather than inventing a parallel notification path.
