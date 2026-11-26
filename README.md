# Token Launch Radar — make.fun token-radar-01 (v11)

[![make.fun](https://img.shields.io/badge/make.fun-token--radar--01-0e7a5f)](https://make.fun/c/token-radar-01)

Which pre-token protocol is worth farming next — ranked by what its launch would be worth if its record stayed as it is.

## The model (fixed weights, no runtime fitting)

`implied = 1.2845 × TVL^0.85 × growth × age × odds`

- **growth** = 1 + 7-day TVL change (clamped to ±30%; no report → 1.00)
- **age** = (1 + years tracked)^0.22, from `listed_at` to the snapshot date (pool median when unlisted)
- **odds** = 0.55 flat — the snapshot-wide share of protocols recording a token symbol (416 of 758 = 54.9%)

Board: 198 rows — the 40 watchlist protocols plus the 158 highest-TVL other eligible pre-token protocols. Rank 1: Sentora Curator ($90.2M). Rank 2: Steakhouse Financial ($89.2M).

## What v11 adds over v10

- An honest out-of-sample evidence section: the fixed model is measured, not refit, on the 128 protocols that record a token with a positive market cap (typical miss ×5.36 — worse than a flat 0.21× TVL multiple; shown as-is).
- Pinned comparisons (up to 4), a command palette (Ctrl+K), CSV + JSON export, pre-token / already-trading tabs, and a model sandbox with locked weights.
- KPI strip, protocol accounting for all 758 protocols, verdict + tier tabs, drop-share and horizon sliders, search and category/chain filters.
- Detail equations that reconcile on all 198 rows (checked programmatically at build time).

## Run

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /path/to/snapshot.json
```

Node 22+ (stdlib only). Writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and `dossier.json` into the output directory. Two runs write byte-identical outputs.
