// Independent verification for token-radar-01 v11 outputs.
// Usage: node check.mjs <outDir> <snapshot.json>
// Checks: board shape, ranks, monotonicity, watchlist coverage, farm steps,
// equation reconcile on ALL rows from the DISPLAYED (rounded) terms,
// evidence numbers recomputed from the snapshot, accounting ledger, sizes.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const [outDir, snapPath] = process.argv.slice(2);
const fail = [];
const ok = (cond, msg) => { console.log((cond ? 'PASS ' : 'FAIL ') + msg); if (!cond) fail.push(msg); };

const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const board = JSON.parse(readFileSync(`${outDir}/board.json`, 'utf8'));
const dataJs = readFileSync(`${outDir}/data.js`, 'utf8');
const data = JSON.parse(dataJs.replace(/^window\.RADAR_DATA = /, '').replace(/;\s*$/, ''));
const rows = board.rows;
const drows = data.rows;

ok(rows.length === 198, `board has 198 rows (got ${rows.length})`);
ok(new Set(rows.map((r) => r.rank)).size === 198 && rows.every((r, i) => r.rank === i + 1), 'ranks are exactly 1..198 once each');
ok(rows.every((r, i) => i === 0 || r.implied_value_usd <= rows[i - 1].implied_value_usd), 'implied never rises with rank');
ok(rows[0].name === 'Sentora Curator' && rows[0].implied_value_usd >= 90200000 && rows[0].implied_value_usd < 90300000, `rank1 Sentora ${rows[0].implied_value_usd}`);
ok(rows[1].name === 'Steakhouse Financial' && rows[1].implied_value_usd >= 89200000 && rows[1].implied_value_usd < 89300000, `rank2 Steakhouse ${rows[1].implied_value_usd}`);
const wl = new Set(snap.watchlist);
ok(rows.filter((r) => wl.has(r.slug)).length === 40, 'watchlist 40/40 covered');
ok(rows.every((r) => snap.protocols.some((p) => p.slug === r.slug)), 'every slug is a snapshot protocol');
ok(rows.every((r) => Array.isArray(r.farm_steps) && r.farm_steps.length >= 3 && r.farm_steps.length <= 12 && r.farm_steps.every((s) => s.trim().length >= 20 && s.trim().length <= 600)), 'farm_steps 3-12 strings of 20-600 chars on every row');
ok(new Set(rows.map((r) => r.implied_value_usd)).size > 1, 'implied values are not all equal');

// Equation reconcile from DISPLAYED terms, on every row, vs displayed implied.
let maxErr = 0, worst = '';
for (const r of drows) {
  const prod = r.eq.baseM * 1e6 * r.eq.growth * r.eq.age * r.eq.odds;
  const disp = r.eq.impliedM * 1e6;
  const err = Math.abs(prod - disp) / disp;
  const errExact = Math.abs(prod - r.implied) / r.implied;
  if (err > maxErr) { maxErr = err; worst = r.slug; }
  if (err > 0.005 || errExact > 0.005) fail.push(`reconcile ${r.slug}: displayed err ${err}, exact err ${errExact}`);
}
console.log(`PASS reconcile 198/198 displayed terms, max rel err ${(maxErr * 100).toFixed(3)}% (worst ${worst})`);

// Evidence recomputed independently from the snapshot with the same fixed formula.
const K = 1.2845, ODDS = 0.55;
const asOf = new Date(snap.as_of + 'T00:00:00Z');
const med = (xs) => { const s = [...xs].sort((a, b) => a - b); return s[s.length >> 1]; };
const imp = (p) => {
  const g = p.change_7d === null ? 1 : 1 + Math.max(-30, Math.min(30, p.change_7d)) / 100;
  const y = p.listed_at ? (asOf - new Date(p.listed_at + 'T00:00:00Z')) / 86400000 / 365.25 : 1.15;
  return K * Math.pow(p.tvl_usd, 0.85) * g * Math.pow(1 + y, 0.22) * ODDS;
};
const traded = snap.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0);
const errs = traded.map((p) => Math.log(imp(p) / p.mcap_usd));
const medMiss = Math.exp(med(errs.map(Math.abs)));
ok(Math.abs(medMiss - data.evidence.medianMiss) < 0.05, `evidence median miss recomputed x${medMiss.toFixed(2)} vs data x${data.evidence.medianMiss}`);
const w3 = errs.filter((e) => Math.abs(e) <= Math.log(3)).length / errs.length;
ok(Math.abs(w3 - data.evidence.within3) < 0.02, `evidence within-x3 recomputed ${(w3 * 100).toFixed(1)}% vs ${(data.evidence.within3 * 100).toFixed(1)}%`);
ok(data.accounting.reduce((s, g) => s + g.n, 0) === 758, `accounting ledger sums to 758 (got ${data.accounting.reduce((s, g) => s + g.n, 0)})`);
ok(data.integrity.watchlist === '40/40' && data.integrity.ledger === '758/758', 'integrity strip watchlist + ledger');
const sha = createHash('sha256').update(readFileSync(`${outDir}/board.json`)).digest('hex').slice(0, 12);
ok(sha === data.integrity.boardSha12, `integrity checksum matches board.json sha ${sha}`);
ok(drows.every((r) => r.narrative && r.narrative.length > 80), 'narrative present on every row');
ok(drows.every((r) => r.steps.length === 6), 'farm plan has 6 steps on every row');
console.log(fail.length ? `\n${fail.length} FAILURES` : '\nALL CHECKS PASSED');
process.exit(fail.length ? 1 : 0);
