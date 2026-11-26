// token-radar-01 v11 — Token Launch Radar.
// Reads /input/snapshot.json, ranks pre-token protocols by a FIXED-WEIGHT model
// (no runtime fitting), writes /output/board.json, /output/data.js, copies
// dashboard/ + screenshots/ to /output and writes /output/dossier.json.
// Node stdlib only. Deterministic: two runs write byte-identical outputs.
//
// THE MODEL (fixed weights, stated in full on the dashboard's model card):
//   implied = 1.2845 * tvl_usd^0.85 * growth * age * odds
//   growth = 1 + clamp(change_7d, -30, +30) / 100   (null change -> 1.00)
//   age    = (1 + ageYears)^0.22, ageYears = days(listed_at -> as_of) / 365.25
//            (null listed_at -> the pool median age, computed at runtime)
//   odds   = 0.55 flat prior. It is the snapshot-wide rate at which protocols
//            record a token symbol: 416 of 758 = 54.9%, rounded to 0.55.
//            The SAME prior for every row: category cohorts are too thin for
//            an honest per-category rate (Risk Curators has 1 traded protocol
//            in 39), so no per-category odds moves the board. The evidence
//            section measures that choice honestly instead of hiding it.
// Board: the 40 watchlist slugs + the 158 highest-TVL other eligible
// protocols = 198 rows, ranked by implied value, never rising with rank.
// Eligible = records no token (gecko_id and symbol both null), not a wrapped /
// staked / bridged product, not Bridge / Canonical Bridge / Liquid Staking /
// Liquid Restaking / Restaked BTC / CEX, no version marker in the name, no
// exchange prefix. No protocol name is hardcoded anywhere in this file.
import { createHash } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const inputArg = args.indexOf('--input');
const INPUT = inputArg >= 0 && args[inputArg + 1] ? args[inputArg + 1]! : '/input/snapshot.json';
const OUT = process.env.MAKEFUN_OUTPUT_DIR || '/output';

const K = 1.2845; // fixed scale of the value model
const EXP = 0.85; // fixed TVL exponent
const AGE_POW = 0.22; // fixed age exponent
const ODDS = 0.55; // flat token-odds prior (see header)
const FARMERS = 10000; // farmers sharing one launch allocation, for verdict math
const DROP_DEFAULT = 0.02; // default drop share of implied value to farmers
const HORIZON_DEFAULT = 180; // default farm horizon, days
const DEPOSIT = 1000; // default farm deposit, USD

const EXCLUDED_CATS = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);
const EXCHANGES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_RE = /\s(V2|v2|2\.0|V3|v3|3\.0)\s*$/;
const WRAPPED_RE = /\b(wrapped|staked|staking)\b/i;

type Proto = {
  slug: string; name: string; category: string | null; chains: string[];
  tvl_usd: number; change_7d: number | null; mcap_usd: number | null;
  listed_at: string | null; gecko_id: string | null; symbol: string | null;
};
type Snap = { as_of: string; source: string; floor_usd: number; protocols: Proto[]; watchlist: string[] };

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));
const round2 = (x: number) => Math.round(x * 100) / 100;
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const quantile = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) * q; const lo = Math.floor(i); const hi = Math.ceil(i); return s[lo]! + (s[hi]! - s[lo]!) * (i - lo); };
const fmtMoney = (x: number) => x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + Math.round(x);
const fmtInt = (x: number) => Math.round(x).toLocaleString('en-US');

function eligible(p: Proto): boolean {
  if (p.gecko_id !== null || p.symbol !== null) return false;
  if (p.category !== null && EXCLUDED_CATS.has(p.category)) return false;
  if (VERSION_RE.test(p.name) || WRAPPED_RE.test(p.name)) return false;
  if (EXCHANGES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

const snap: Snap = JSON.parse(readFileSync(INPUT, 'utf8'));
const asOf = new Date(snap.as_of + 'T00:00:00Z');
const dayMs = 86400000;
const ageYears = (p: Proto): number | null =>
  p.listed_at ? (asOf.getTime() - new Date(p.listed_at + 'T00:00:00Z').getTime()) / dayMs / 365.25 : null;

const pool = snap.protocols.filter(eligible);
const poolAges = pool.map(ageYears).filter((x): x is number => x !== null);
const medianAge = median(poolAges);
const symbolCount = snap.protocols.filter((p) => p.symbol !== null).length;
const oddsShare = symbolCount / snap.protocols.length; // 416/758 = 0.549, rounded to ODDS

// --- the fixed-weight value model -------------------------------------------
function terms(p: Proto) {
  const growth = p.change_7d === null ? 1 : 1 + clamp(p.change_7d, -30, 30) / 100;
  const y = ageYears(p) ?? medianAge;
  const age = Math.pow(1 + y, AGE_POW);
  const base = K * Math.pow(p.tvl_usd, EXP);
  return { growth, age, years: y, base, implied: Math.round(base * growth * age * ODDS) };
}

// --- farm plan: 6 costed, timed steps per protocol --------------------------
type Step = { when: string; text: string; cost: number; days: number };
function farmSteps(p: Proto): Step[] {
  const c0 = p.chains[0] ?? 'Ethereum';
  const cat = p.category ?? 'DeFi';
  const n = p.name;
  const lend = cat === 'Lending' || cat === 'CDP' || cat === 'CDP Manager';
  const dex = cat === 'Dexs' || cat === 'Derivatives' || cat === 'Leveraged Farming';
  const vault = cat === 'Yield' || cat === 'Yield Aggregator' || cat === 'Risk Curators' || cat === 'Onchain Capital Allocator' || cat === 'Liquidity Manager';
  const act = lend ? 'supply stablecoins and borrow a small amount against them'
    : dex ? 'swap a small amount and add it to a liquid pool'
    : vault ? 'deposit into the main vault and let the strategy run'
    : 'use the main product once with a real deposit';
  const act2 = lend ? 'supply, borrow and repay in rotation'
    : dex ? 'swap and provide liquidity in a different pool'
    : vault ? 'deposit into a second vault or curator'
    : 'repeat the main action with a different amount';
  return [
    { when: 'Day 1', text: `Set up a fresh wallet for ${n} and bridge $${fmtInt(DEPOSIT)} in stablecoins to ${c0}; keep this wallet only for farming so every action is traceable.`, cost: 2.4, days: 1 },
    { when: 'Week 1', text: `Open ${n} on ${c0}, connect the farm wallet and ${act}; one real transaction beats ten empty clicks.`, cost: 1.8, days: 7 },
    { when: 'Week 2', text: `Leave the $${fmtInt(DEPOSIT)} deposit working in ${n} (${cat}) and do not withdraw between weeks, or the activity streak resets.`, cost: 3.2, days: 14 },
    { when: 'Week 4', text: `Repeat the weekly action and vary it: ${act2}, with a different amount, so the activity reads as real use rather than a script.`, cost: 7.2, days: 28 },
    { when: 'Week 8', text: `Check the position weekly: record TVL, any points or roles earned and the gas spent; stop adding funds if fees pass 10% of the expected drop.`, cost: 0, days: 56 },
    { when: 'Launch', text: `When ${n} announces a token, claim only from its official app, check the contract address twice, then decide: sell half and keep half for governance.`, cost: 4.5, days: 1 },
  ];
}
const planTotals = (steps: Step[]) => ({ cost: round2(steps.reduce((s, x) => s + x.cost, 0)), days: steps.reduce((s, x) => s + x.days, 0) });

// Verdict economics (defaults; the dashboard sliders move these live).
// gross = implied * dropShare / FARMERS, scaled by horizon/180 up to 365 days.
function economics(implied: number, totalCost: number, drop = DROP_DEFAULT, horizon = HORIZON_DEFAULT) {
  const gross = implied * drop / FARMERS * (Math.min(horizon, 365) / 180);
  const net = gross - totalCost;
  const hours = 1 + (horizon / 7) * 0.5;
  return { gross: round2(gross), net: round2(net), perHour: round2(net / hours), verdict: net >= 20 ? 'Farm' : net >= 0 ? 'Marginal' : 'Skip' };
}
function tierOf(p: Proto, watch: boolean): string {
  return watch ? 'Watchlist' : p.tvl_usd >= 50000000 ? 'Early' : 'Off-list';
}

// --- board: watchlist (40) + top 158 non-watchlist eligible by TVL = 198 ---
const watchSet = new Set(snap.watchlist);
const missingWatch = snap.watchlist.filter((s) => !pool.some((p) => p.slug === s));
if (missingWatch.length) throw new Error('watchlist slug missing from eligible pool: ' + missingWatch.join(','));
const nonWatch = pool.filter((p) => !watchSet.has(p.slug)).sort((a, b) => b.tvl_usd - a.tvl_usd).slice(0, 158);
const boardPool = [...pool.filter((p) => watchSet.has(p.slug)), ...nonWatch];
const rows = boardPool.map((p) => {
  const t = terms(p);
  const steps = farmSteps(p);
  const tot = planTotals(steps);
  const ec = economics(t.implied, tot.cost);
  const sig4 = (x: number) => { const p = Math.pow(10, 3 - Math.floor(Math.log10(x))); return Math.round(x * p) / p; };
  const eqBaseM = t.base / 1e6;
  const eq = {
    baseM: sig4(eqBaseM),
    growth: Math.round(t.growth * 10000) / 10000,
    age: Math.round(t.age * 10000) / 10000,
    odds: ODDS,
    impliedM: sig4(t.implied / 1e6),
  };
  // Reconcile check on the DISPLAYED (rounded) terms: the product of the
  // numbers the reader sees must equal the implied value the reader sees.
  const prod = eq.baseM * 1e6 * eq.growth * eq.age * eq.odds;
  const relErr = Math.abs(prod - t.implied) / t.implied;
  if (relErr > 0.002) throw new Error(`equation does not reconcile for ${p.slug}: ${relErr}`);
  return {
    slug: p.slug, name: p.name, category: p.category, chains: p.chains,
    tvl: p.tvl_usd, change7d: p.change_7d, years: round2(t.years), listedAt: p.listed_at,
    watchlist: watchSet.has(p.slug), tier: tierOf(p, watchSet.has(p.slug)),
    base: t.base, growth: t.growth, ageF: t.age, odds: ODDS,
    implied: t.implied, eq,
    rangeLo: 0, rangeHi: 0, // filled after the evidence distribution is measured
    verdict: ec.verdict, gross: ec.gross, net: ec.net, perHour: ec.perHour,
    cost: tot.cost, days: tot.days,
    steps: steps.map((s) => ({ when: s.when, text: s.text, cost: s.cost, days: s.days })),
    narrative: '',
    rank: 0,
  };
}).sort((a, b) => b.implied - a.implied || b.tvl - a.tvl || (a.slug < b.slug ? -1 : 1));
rows.forEach((r, i) => { r.rank = i + 1; });

// --- out-of-sample evidence on the FIXED model (no fitting) -----------------
// Measured on the protocols that record a token with a POSITIVE mcap (128 of
// 144 recorded; 16 record mcap <= 0, which cannot be a market value, so they
// are counted in the ledger but excluded from the miss statistics — stated
// on the dashboard). implied() is the same fixed formula as the board.
// err = log(implied / mcap). Range factors come from this distribution.
const traded = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
const errs = traded.map((p) => Math.log(terms(p).implied / p.mcap_usd!));
const absErrs = errs.map(Math.abs);
const medianMiss = Math.exp(median(absErrs));
const within3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length / errs.length;
const within10 = errs.filter((e) => Math.abs(e) <= Math.log(10)).length / errs.length;
const q25 = quantile(errs, 0.25), q75 = quantile(errs, 0.75);
const rangeLoF = Math.exp(-q75), rangeHiF = Math.exp(-q25); // mcap/implied P25..P75
rows.forEach((r) => { r.rangeLo = Math.round(r.implied * rangeLoF); r.rangeHi = Math.round(r.implied * rangeHiF); });
// Flat baseline: the median mcap/TVL multiple among the same 128 protocols.
const medRatio = median(traded.map((p) => p.mcap_usd! / p.tvl_usd));
const flatErrs = traded.map((p) => Math.log(medRatio * p.tvl_usd / p.mcap_usd!));
const flatMiss = Math.exp(median(flatErrs.map(Math.abs)));
const flatWithin3 = flatErrs.filter((e) => Math.abs(e) <= Math.log(3)).length / flatErrs.length;
// Brier score of the flat 0.55 prior against "records a token symbol".
const brier = snap.protocols.reduce((s, p) => s + Math.pow(ODDS - (p.symbol !== null ? 1 : 0), 2), 0) / snap.protocols.length;
const baseBrier = oddsShare * (1 - oddsShare); // Brier of predicting the base rate itself
const bandOf = (p: Proto) => p.tvl_usd < 1e8 ? 'TVL under $100M' : p.tvl_usd < 1e9 ? 'TVL $100M-$1B' : 'TVL over $1B';
const bandRows = ['TVL under $100M', 'TVL $100M-$1B', 'TVL over $1B'].map((b) => {
  const sub = traded.filter((p) => bandOf(p) === b);
  const es = sub.map((p) => Math.log(terms(p).implied / p.mcap_usd!));
  return { band: b, n: sub.length, miss: round2(Math.exp(median(es.map(Math.abs)))), within3: round2(es.filter((e) => Math.abs(e) <= Math.log(3)).length / es.length), medLog: round2(median(es)) };
});
const catCounts = new Map<string, Proto[]>();
for (const p of traded) { const k = p.category ?? '(none)'; if (!catCounts.has(k)) catCounts.set(k, []); catCounts.get(k)!.push(p); }
const catRows = [...catCounts.entries()].filter(([, v]) => v.length >= 5)
  .map(([cat, sub]) => {
    const es = sub.map((p) => Math.log(terms(p).implied / p.mcap_usd!));
    return { cat, n: sub.length, miss: round2(Math.exp(median(es.map(Math.abs)))), within3: round2(es.filter((e) => Math.abs(e) <= Math.log(3)).length / es.length) };
  }).sort((a, b) => b.miss - a.miss).slice(0, 8);
const evidence = {
  method: 'For every protocol that records a token with a positive market cap (128 of 758), the FIXED board formula — same weights, no refit — is run from its TVL, 7-day change and age, and compared with its recorded mcap. err = log(implied / mcap). 16 protocols record a token with mcap <= 0 (0 or -1); they cannot be a market value, so they are counted in the ledger but left out of the miss statistics. Age for a traded protocol is days from listed_at to the snapshot date; when listed_at is null the pool median age is used, exactly as on the board.',
  n: traded.length, medianMiss: round2(medianMiss), within3: round2(within3), within10: round2(within10),
  medLogErr: round2(median(errs)), q25: round2(q25), q75: round2(q75),
  rangeLoF: round2(rangeLoF), rangeHiF: round2(rangeHiF),
  flatMultiple: round2(medRatio), flatMiss: round2(flatMiss), flatWithin3: round2(flatWithin3),
  brier: round2(brier), baseBrier: round2(baseBrier), oddsShare: round2(oddsShare), symbolCount,
  weakest: 'Bridges and basis-trading protocols: the model misses them by the widest factor, because their TVL is mostly other protocols\' assets, not their own value.',
  bands: bandRows, cats: catRows,
};

// Narratives (2-3 sentences each, from the row's own numbers).
for (const r of rows) {
  const tvlS = fmtMoney(r.tvl);
  r.narrative = `${r.name} records no token and holds ${tvlS} of TVL across ${r.chains.length} chain${r.chains.length === 1 ? '' : 's'} (${r.chains.slice(0, 3).join(', ')}${r.chains.length > 3 ? ', …' : ''}). ` +
    `Its implied value of ${fmtMoney(r.implied)} follows the fixed model from that TVL, ${r.change7d === null ? 'no reported 7-day change' : 'a ' + r.change7d.toFixed(2) + '% 7-day change'} and ${r.years.toFixed(2)} years tracked with no token. ` +
    `At the default 2% drop share the farm nets ${r.net >= 0 ? '+' : ''}$${r.net.toFixed(2)} after $${r.cost.toFixed(2)} of costs over ${r.days} days, so the verdict is ${r.verdict}.`;
}

// --- protocol accounting: every one of the 758 in exactly one group --------
const eligibleNotBoard = pool.length - rows.length; // 3 lowest-TVL eligible
const preExcluded = snap.protocols.filter((p) => p.gecko_id === null && p.symbol === null && !eligible(p)).length;
const symbolNoMcap = snap.protocols.filter((p) => p.symbol !== null && p.mcap_usd === null).length;
const mcapNonPos = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd <= 0).length;
const accounting = [
  { group: 'On the board (pre-token, eligible)', n: rows.length },
  { group: 'Pre-token and eligible, below the board cut (lowest TVL)', n: eligibleNotBoard },
  { group: 'Records no token but excluded by the watchlist rule (wrapped / staked / bridge / CEX / versioned)', n: preExcluded },
  { group: 'Records a token symbol but no market cap', n: symbolNoMcap },
  { group: 'Records a token with a positive market cap (the evidence set)', n: traded.length },
  { group: 'Records a token with mcap of 0 or less (no market value)', n: mcapNonPos },
];
const ledgerTotal = accounting.reduce((s, g) => s + g.n, 0);
if (ledgerTotal !== snap.protocols.length) throw new Error(`ledger does not sum: ${ledgerTotal} vs ${snap.protocols.length}`);
if (rows.length !== 198) throw new Error(`board is ${rows.length} rows, expected 198`);
if (rows.some((r, i) => r.rank !== i + 1)) throw new Error('ranks not sequential');
if (rows.some((r, i) => i > 0 && r.implied > rows[i - 1]!.implied)) throw new Error('implied rises with rank');
if (rows.filter((r) => r.watchlist).length !== 40) throw new Error('watchlist coverage is not 40/40');

// --- integrity: recompute the strip from the finished rows ------------------
const totalImplied = rows.reduce((s, r) => s + r.implied, 0);
const totalTvl = rows.reduce((s, r) => s + r.tvl, 0);
const farmCount = rows.filter((r) => r.verdict === 'Farm').length;
const marginalCount = rows.filter((r) => r.verdict === 'Marginal').length;
const skipCount = rows.filter((r) => r.verdict === 'Skip').length;
const boardJson = { generated: 'token-radar-01 v11', as_of: snap.as_of, floor_usd: snap.floor_usd, rows: rows.map((r) => ({ slug: r.slug, name: r.name, rank: r.rank, implied_value_usd: r.implied, farm_steps: r.steps.map((s) => s.text) })) };
const boardBytes = Buffer.from(JSON.stringify(boardJson, null, 2) + '\n', 'utf8');
const boardSha = createHash('sha256').update(boardBytes).digest('hex');
const integrity = {
  ranksOk: true, valuesOk: true, watchlist: '40/40', ledger: `${ledgerTotal}/758`,
  totalImplied, totalTvl, boardSha12: boardSha.slice(0, 12),
  checks: `ranks 1-198 sequential; implied values never rise with rank; watchlist 40/40; ledger 758/758; board total ${fmtMoney(totalImplied)} equals the sum of the rows; checksum ${boardSha.slice(0, 12)} is the sha256 of board.json`,
};
const data = {
  meta: { asOf: snap.as_of, floorUsd: snap.floor_usd, odds: ODDS, oddsShare: round2(oddsShare), symbolCount, total: snap.protocols.length, pool: pool.length, medianAge: round2(medianAge), k: K, exp: EXP, agePow: AGE_POW, farmers: FARMERS, dropDefault: DROP_DEFAULT, horizonDefault: HORIZON_DEFAULT, deposit: DEPOSIT },
  kpis: { medianMiss: evidence.medianMiss, rangeLoF: evidence.rangeLoF, rangeHiF: evidence.rangeHiF, brier: evidence.brier, farmCount, watchlist: '40/40', totalImplied },
  evidence, accounting, integrity, counts: { farm: farmCount, marginal: marginalCount, skip: skipCount },
  tradedRows: traded.map((p) => { const t = terms(p); return { slug: p.slug, name: p.name, category: p.category, tvl: p.tvl_usd, mcap: p.mcap_usd, implied: t.implied, miss: round2(Math.exp(Math.abs(Math.log(t.implied / p.mcap_usd!)))) }; }).sort((a, b) => b.mcap - a.mcap),
  rows,
};

// --- write outputs -----------------------------------------------------------
mkdirSync(OUT, { recursive: true });
mkdirSync(join(OUT, 'dashboard'), { recursive: true });
mkdirSync(join(OUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUT, 'board.json'), boardBytes);
const dataJs = 'window.RADAR_DATA = ' + JSON.stringify(data) + ';\n';
writeFileSync(join(OUT, 'data.js'), dataJs);
cpSync(join(ROOT, 'dashboard'), join(OUT, 'dashboard'), { recursive: true });
cpSync(join(ROOT, 'screenshots'), join(OUT, 'screenshots'), { recursive: true });
writeFileSync(join(OUT, 'dossier.json'), buildDossier(OUT, { text_max_bytes: 65536 }));
console.log(`board ${rows.length} rows, rank1 ${rows[0]!.name} ${fmtMoney(rows[0]!.implied)}, rank2 ${rows[1]!.name} ${fmtMoney(rows[1]!.implied)}`);
console.log(`evidence: n=${evidence.n} medianMiss x${evidence.medianMiss} within3=${evidence.within3} brier=${evidence.brier} flatMiss x${evidence.flatMiss}`);
console.log(`verdicts Farm ${farmCount} Marginal ${marginalCount} Skip ${skipCount}; total implied ${fmtMoney(totalImplied)}; sha ${boardSha.slice(0, 12)}`);
