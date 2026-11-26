// Token Launch Radar — dashboard logic. All data comes from ../data.js
// (window.RADAR_DATA), written by main.ts from the sealed snapshot. No network.
const D = window.RADAR_DATA;
const $ = (id) => document.getElementById(id);
const money = (x) => x >= 1e9 ? '$' + (x / 1e9).toFixed(2) + 'B' : x >= 1e6 ? '$' + (x / 1e6).toFixed(1) + 'M' : x >= 1e3 ? '$' + (x / 1e3).toFixed(1) + 'K' : '$' + Math.round(x);
const money2 = (x) => '$' + x.toLocaleString('en-US', { maximumFractionDigits: 0 });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const S = { verdict: 'All', tier: 'All', q: '', cat: '', chain: '', sort: 'rank', dir: 1, pins: new Set(), detail: null, drop: D.meta.dropDefault, horizon: D.meta.horizonDefault };
const econ = (r) => {
  const gross = r.implied * S.drop / D.meta.farmers * (Math.min(S.horizon, 365) / 180);
  const net = gross - r.cost;
  return { gross, net, verdict: net >= 20 ? 'Farm' : net >= 0 ? 'Marginal' : 'Skip', perHour: net / (1 + (S.horizon / 7) * 0.5) };
};
const vcls = (v) => v === 'Farm' ? 'v-farm' : v === 'Marginal' ? 'v-marg' : 'v-skip';
const tierBadge = (r) => r.tier === 'Watchlist' ? '<span class="badge b-watch">Watchlist</span>' : r.tier === 'Early' ? '<span class="badge b-early">Early</span>' : '<span class="badge b-off">Off-list</span>';

function renderKpis() {
  const farm = D.rows.filter((r) => econ(r).verdict === 'Farm').length;
  const k = [
    ['×' + D.kpis.medianMiss, 'typical miss — median |log(implied/mcap)| on 128 traded protocols'],
    [D.kpis.rangeLoF + '×–' + D.kpis.rangeHiF + '×', 'P25–P75 range of mcap/implied — 50% of traded mcaps fall inside it, by construction'],
    [D.kpis.brier.toFixed(3), 'token-odds Brier (flat 0.55 prior vs records-a-symbol; base rate scores the same)'],
    [farm + ' / 198', 'worth farming at the current drop share and horizon'],
    ['40 / 40', 'watchlist covered'],
    [money(D.kpis.totalImplied), 'total implied value of the 198-row board'],
  ];
  $('kpis').innerHTML = k.map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
  $('integrity').textContent = '✓ Integrity — ' + D.integrity.checks + '.';
}
const ACCT_COLORS = ['#0e7a5f', '#3aa88f', '#8fbf9f', '#d9a441', '#5b7fa6', '#b0563a'];
function renderAccounting() {
  const tot = D.accounting.reduce((s, g) => s + g.n, 0);
  $('accounting').innerHTML = D.accounting.map((g, i) => `<div style="width:${(g.n / tot * 100).toFixed(2)}%;background:${ACCT_COLORS[i]}" title="${esc(g.group)}: ${g.n}"></div>`).join('');
  $('acctLegend').innerHTML = D.accounting.map((g, i) => `<span><i class="dot" style="background:${ACCT_COLORS[i]}"></i>${esc(g.group)} — <b>${g.n}</b></span>`).join('');
}
function renderEvidence() {
  const e = D.evidence;
  $('evidenceMethod').textContent = e.method;
  $('evidenceKpis').innerHTML = [
    ['×' + e.medianMiss, 'typical miss (median factor) — flat 0.21× TVL multiple misses by ×' + e.flatMiss],
    [(e.within3 * 100).toFixed(0) + '%', 'of traded mcaps within ×3 of implied (flat multiple: ' + (e.flatWithin3 * 100).toFixed(0) + '%)'],
    [(e.within10 * 100).toFixed(0) + '%', 'of traded mcaps within ×10 of implied'],
  ].map(([b, s]) => `<div class="kpi"><b>${b}</b><span>${s}</span></div>`).join('');
  $('bandBody').innerHTML = e.bands.map((b) => `<tr><td>${b.band}</td><td class="num">${b.n}</td><td class="num">×${b.miss}</td><td class="num">${(b.within3 * 100).toFixed(0)}%</td><td class="num">${b.medLog}</td></tr>`).join('');
  $('catBody').innerHTML = e.cats.map((c) => `<tr><td>${esc(c.cat)}</td><td class="num">${c.n}</td><td class="num">×${c.miss}</td><td class="num">${(c.within3 * 100).toFixed(0)}%</td></tr>`).join('');
  $('evidenceHonest').innerHTML = `<b>Where the model is weakest.</b> ${esc(e.weakest)} The fixed model under-predicts traded market caps: the median log error is ${e.medLogErr}, so a typical implied value is about ${Math.round(Math.exp(e.medLogErr) * 100)}% of the traded mcap — worse than a flat ${e.flatMultiple}× TVL multiple (×${e.flatMiss} miss). The P25–P75 range on every row is therefore wide (${e.rangeLoF}×–${e.rangeHiF}×): it is the measured spread, not a fitted confidence band. The flat 0.55 odds prior carries no per-protocol signal — its Brier score ${e.brier} equals the base-rate Brier ${e.baseBrier}.`;
}
function renderTabs() {
  const counts = { All: D.rows.length, Farm: 0, Marginal: 0, Skip: 0 };
  D.rows.forEach((r) => { counts[econ(r).verdict]++; });
  $('verdictTabs').innerHTML = ['All', 'Farm', 'Marginal', 'Skip'].map((v) =>
    `<button type="button" data-v="${v}" class="${S.verdict === v ? 'on' : ''}">${v} (${counts[v]})</button>`).join('');
  const tiers = { All: D.rows.length, Watchlist: 0, Early: 0, 'Off-list': 0 };
  D.rows.forEach((r) => { tiers[r.tier]++; });
  $('tierTabs').innerHTML = ['All', 'Watchlist', 'Early', 'Off-list'].map((t) =>
    `<button type="button" data-t="${t}" class="${S.tier === t ? 'on' : ''}">${t} (${tiers[t]})</button>`).join('');
  $('verdictTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { S.verdict = b.dataset.v; renderBoard(); renderTabs(); });
  $('tierTabs').querySelectorAll('button').forEach((b) => b.onclick = () => { S.tier = b.dataset.t; renderBoard(); renderTabs(); });
}
function filtered() {
  let rs = D.rows.filter((r) => {
    const e = econ(r);
    if (S.verdict !== 'All' && e.verdict !== S.verdict) return false;
    if (S.tier !== 'All' && r.tier !== S.tier) return false;
    if (S.q && !(r.name.toLowerCase().includes(S.q) || r.slug.includes(S.q))) return false;
    if (S.cat && r.category !== S.cat) return false;
    if (S.chain && !r.chains.includes(S.chain)) return false;
    return true;
  });
  const key = S.sort, dir = S.dir;
  rs = [...rs].sort((a, b) => {
    const av = key === 'net' ? econ(a).net : a[key], bv = key === 'net' ? econ(b).net : b[key];
    return (av - bv) * dir || (a.rank - b.rank);
  });
  return rs;
}
function rowHtml(r) {
  const e = econ(r);
  const pinned = S.pins.has(r.slug);
  return `<tr><td><input type="checkbox" data-pin="${esc(r.slug)}" ${pinned ? 'checked' : ''} aria-label="Pin ${esc(r.name)}"></td>` +
    `<td class="num">${r.rank}</td><td><a href="javascript:void(0)" data-open="${esc(r.slug)}"><b>${esc(r.name)}</b></a>${tierBadge(r)}<div class="risk">${esc(r.category || 'No category')} · ${esc(r.chains.join(', '))} · ${r.years.toFixed(2)}y tracked</div></td>` +
    `<td class="num">${money(r.tvl)}</td><td class="num">${r.change7d === null ? '—' : r.change7d.toFixed(2) + '%'}</td>` +
    `<td class="num">${r.years.toFixed(2)}y</td><td><div class="bar"><i style="width:${Math.round(r.odds * 100)}%"></i></div><span class="num">${r.odds.toFixed(2)}</span></td>` +
    `<td class="num"><b>${money(r.implied)}</b><div class="risk">${money(r.rangeLo)}–${money(r.rangeHi)}</div></td>` +
    `<td class="num"><span class="${vcls(e.verdict)}">${e.verdict}</span><div class="risk">net ${e.net >= 0 ? '+' : ''}$${e.net.toFixed(2)} · $${e.perHour.toFixed(2)}/h</div></td>` +
    `<td><button type="button" data-open="${esc(r.slug)}">Plan</button></td></tr>`;
}
function renderBoard() {
  const rs = filtered();
  $('boardBody').innerHTML = rs.map(rowHtml).join('') || '<tr><td colspan="10">No rows match these filters. Use Reset.</td></tr>';
  const tvl = rs.reduce((s, r) => s + r.tvl, 0), imp = rs.reduce((s, r) => s + r.implied, 0);
  $('countLine').textContent = `${rs.length} of 198 rows · ${money(tvl)} TVL · ${money(imp)} implied`;
  $('boardBody').querySelectorAll('[data-pin]').forEach((c) => c.onchange = () => {
    if (c.checked && S.pins.size >= 4) { c.checked = false; alert('Pinned comparisons hold at most 4 protocols — unpin one first.'); return; }
    c.checked ? S.pins.add(c.dataset.pin) : S.pins.delete(c.dataset.pin);
    renderPinned();
  });
  $('boardBody').querySelectorAll('[data-open]').forEach((el) => el.onclick = () => openDetail(el.dataset.open));
  renderPinned();
}
function renderPinned() {
  const wrap = $('pinnedWrap');
  if (!S.pins.size) { wrap.hidden = true; return; }
  wrap.hidden = false;
  $('pinnedBody').innerHTML = [...S.pins].map((slug) => {
    const r = D.rows.find((x) => x.slug === slug); const e = econ(r);
    return `<tr><td><b>${esc(r.name)}</b> <button type="button" data-unpin="${esc(slug)}">✕</button></td><td class="num">${money(r.tvl)}</td><td class="num">${r.change7d === null ? '—' : r.change7d.toFixed(2) + '%'}</td><td class="num">${r.years.toFixed(2)}y</td><td class="num">${r.odds.toFixed(2)}</td><td class="num"><b>${money(r.implied)}</b></td><td class="${vcls(e.verdict)}">${e.verdict}</td><td class="num">$${r.cost.toFixed(2)}</td></tr>`;
  }).join('');
  $('pinnedBody').querySelectorAll('[data-unpin]').forEach((b) => b.onclick = () => { S.pins.delete(b.dataset.unpin); renderBoard(); });
}
function openDetail(slug) {
  const r = D.rows.find((x) => x.slug === slug); if (!r) return;
  S.detail = slug;
  const e = econ(r);
  const eq = r.eq;
  const sig = (x) => parseFloat(x.toPrecision(4)).toString();
  $('detail').innerHTML = `<div class="detail"><h3>${esc(r.name)} — detail</h3>
  <p class="eq">implied = 1.2845 × TVL<sup>0.85</sup> × growth × age × odds = $${sig(eq.baseM)}M × ${eq.growth.toFixed(4)} × ${eq.age.toFixed(4)} × ${eq.odds.toFixed(2)} = $${sig(eq.impliedM)}M</p>
  <p>${esc(r.narrative)}</p>
  <table class="mini"><thead><tr><th>When</th><th>Step</th><th>Cost</th><th>Time</th></tr></thead><tbody>
  ${r.steps.map((s) => `<tr><td>${esc(s.when)}</td><td>${esc(s.text)}</td><td class="num">$${s.cost.toFixed(2)}</td><td class="num">${s.days}d</td></tr>`).join('')}
  </tbody></table>
  <p>Budget: $${r.cost.toFixed(2)} of costs over ${r.days} days · expected gross $${e.gross.toFixed(2)} at the current drop share and horizon.</p>
  <p class="allin">All in: 6 steps over ${r.days} days, cost $${r.cost.toFixed(2)}, gross $${e.gross.toFixed(2)}, net ${e.net >= 0 ? '+' : ''}$${e.net.toFixed(2)} ($${e.perHour.toFixed(2)} an hour) — verdict ${e.verdict}.</p>
  <p><button type="button" id="closeDetail">Close detail</button></p></div>`;
  $('closeDetail').onclick = () => { S.detail = null; $('detail').innerHTML = ''; };
  $('detail').scrollIntoView({ behavior: 'auto', block: 'start' });
}
function renderLive() {
  $('liveBody').innerHTML = D.tradedRows.map((t) => `<tr><td><b>${esc(t.name)}</b><div class="risk">${esc(t.slug)}</div></td><td>${esc(t.category || '—')}</td><td class="num">${money(t.tvl)}</td><td class="num">${money(t.mcap)}</td><td class="num">${money(t.implied)}</td><td class="num">×${t.miss}</td></tr>`).join('');
}
function download(name, text, type) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type })); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
function exportCSV() {
  const head = 'rank,slug,name,category,chains,tvl_usd,change_7d,age_years,odds,implied_usd,range_lo_usd,range_hi_usd,verdict,net_usd,net_per_hour_usd,farm_cost_usd,farm_days\n';
  const lines = filtered().map((r) => { const e = econ(r); return [r.rank, r.slug, '"' + r.name.replace(/"/g, '""') + '"', '"' + (r.category || '') + '"', '"' + r.chains.join(';') + '"', r.tvl, r.change7d === null ? '' : r.change7d, r.years, r.odds, r.implied, r.rangeLo, r.rangeHi, e.verdict, e.net.toFixed(2), e.perHour.toFixed(2), r.cost, r.days].join(','); });
  download('token-radar-board.csv', head + lines.join('\n') + '\n', 'text/csv');
}
function exportJSON() { download('token-radar-board.json', JSON.stringify(filtered().map((r) => ({ ...r, ...econ(r) })), null, 2), 'application/json'); }
// --- command palette ---------------------------------------------------------
const ACTIONS = [
  { label: 'Export board as CSV', run: exportCSV }, { label: 'Export board as JSON', run: exportJSON },
  { label: 'Reset filters', run: resetFilters }, { label: 'Show pre-token board', run: () => switchTab('pre') },
  { label: 'Show already-trading table', run: () => switchTab('live') }, { label: 'Clear pinned comparisons', run: () => { S.pins.clear(); renderBoard(); } },
];
let palSel = 0, palItems = [];
function palMatches(q) {
  q = q.toLowerCase();
  const prots = D.rows.filter((r) => r.name.toLowerCase().includes(q) || r.slug.includes(q)).slice(0, 8)
    .map((r) => ({ label: r.rank + '. ' + r.name + ' — ' + money(r.implied), run: () => { openDetail(r.slug); } }));
  const acts = ACTIONS.filter((a) => a.label.toLowerCase().includes(q)).map((a) => ({ label: 'Action: ' + a.label, run: a.run }));
  return [...prots, ...acts];
}
function openPalette() { $('palette').hidden = false; $('palInput').value = ''; renderPal(''); $('palInput').focus(); }
function closePalette() { $('palette').hidden = true; }
function renderPal(q) {
  palItems = palMatches(q); palSel = 0;
  $('palList').innerHTML = palItems.map((it, i) => `<li class="${i === palSel ? 'sel' : ''}" data-i="${i}">${esc(it.label)}</li>`).join('') || '<li>No match.</li>';
  $('palList').querySelectorAll('li[data-i]').forEach((li) => li.onclick = () => { closePalette(); palItems[+li.dataset.i].run(); });
}
function resetFilters() {
  S.verdict = 'All'; S.tier = 'All'; S.q = ''; S.cat = ''; S.chain = '';
  $('search').value = ''; $('catSel').value = ''; $('chainSel').value = '';
  renderTabs(); renderBoard();
}
function switchTab(which) {
  $('tabPre').classList.toggle('on', which === 'pre'); $('tabLive').classList.toggle('on', which === 'live');
  $('preView').hidden = which !== 'pre'; $('liveView').hidden = which !== 'live';
  if (which === 'live') renderLive();
}
function sandbox() {
  const tvl = Math.pow(10, +$('sbTvl').value);
  const g = 1 + (+$('sbGrow').value) / 100, y = +$('sbAge').value, o = +$('sbOdds').value;
  const imp = 1.2845 * Math.pow(tvl, 0.85) * g * Math.pow(1 + y, 0.22) * o;
  $('sbTvlOut').textContent = money(tvl); $('sbGrowOut').textContent = (+$('sbGrow').value).toFixed(1) + '%';
  $('sbAgeOut').textContent = y.toFixed(1) + 'y'; $('sbOddsOut').textContent = o.toFixed(2);
  $('sbOut').textContent = 'implied = 1.2845 × ' + money(tvl) + '^0.85 × ' + g.toFixed(3) + ' × ' + Math.pow(1 + y, 0.22).toFixed(4) + ' × ' + o.toFixed(2) + ' = ' + money(imp) + '  (weights 1.2845 / 0.85 locked)';
}
function init() {
  renderKpis(); renderAccounting(); renderEvidence(); renderTabs(); renderBoard(); renderLive();
  const cats = [...new Set(D.rows.map((r) => r.category).filter(Boolean))].sort();
  const chains = [...new Set(D.rows.flatMap((r) => r.chains))].sort();
  $('catSel').innerHTML += cats.map((c) => `<option>${esc(c)}</option>`).join('');
  $('chainSel').innerHTML += chains.map((c) => `<option>${esc(c)}</option>`).join('');
  $('search').oninput = (e) => { S.q = e.target.value.trim().toLowerCase(); renderBoard(); };
  $('catSel').onchange = (e) => { S.cat = e.target.value; renderBoard(); };
  $('chainSel').onchange = (e) => { S.chain = e.target.value; renderBoard(); };
  $('resetBtn').onclick = resetFilters; $('csvBtn').onclick = exportCSV; $('jsonBtn').onclick = exportJSON;
  $('tabPre').onclick = () => switchTab('pre'); $('tabLive').onclick = () => switchTab('live');
  $('paletteBtn').onclick = openPalette;
  $('palInput').oninput = (e) => renderPal(e.target.value.trim());
  $('palInput').onkeydown = (e) => {
    if (e.key === 'ArrowDown') { palSel = Math.min(palSel + 1, palItems.length - 1); renderPalSel(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { palSel = Math.max(palSel - 1, 0); renderPalSel(); e.preventDefault(); }
    else if (e.key === 'Enter' && palItems[palSel]) { closePalette(); palItems[palSel].run(); }
    else if (e.key === 'Escape') closePalette();
  };
  $('palette').onclick = (e) => { if (e.target === $('palette')) closePalette(); };
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); $('palette').hidden ? openPalette() : closePalette(); }
    else if (e.key === 'Escape') closePalette();
  });
  document.querySelectorAll('th[data-sort]').forEach((th) => th.onclick = () => {
    const k = th.dataset.sort;
    S.dir = S.sort === k ? -S.dir : (k === 'rank' ? 1 : -1); S.sort = k; renderBoard();
  });
  const updEcon = () => {
    S.drop = +$('dropShare').value; S.horizon = +$('horizon').value;
    $('dropOut').textContent = (S.drop * 100).toFixed(1) + '%'; $('horOut').textContent = S.horizon + 'd';
    $('econLine').textContent = 'At ' + (S.drop * 100).toFixed(1) + '% over ' + S.horizon + ' days, ' + D.rows.filter((r) => econ(r).verdict === 'Farm').length + ' of 198 rows are worth farming.';
    renderKpis(); renderTabs(); renderBoard(); if (S.detail) openDetail(S.detail);
  };
  $('dropShare').oninput = updEcon; $('horizon').oninput = updEcon;
  ['sbTvl', 'sbGrow', 'sbAge', 'sbOdds'].forEach((id) => $(id).oninput = sandbox);
  $('dropOut').textContent = '2.0%'; $('horOut').textContent = '180d';
  $('econLine').textContent = 'At 2.0% over 180 days, ' + D.rows.filter((r) => econ(r).verdict === 'Farm').length + ' of 198 rows are worth farming.';
  sandbox();
  // Deep links for deterministic screenshots: #detail=<slug>, #palette, #verdict=Farm, #q=<text>, #tab=live
  const h = new URLSearchParams(location.hash.slice(1));
  if (h.get('verdict')) { S.verdict = h.get('verdict'); renderTabs(); renderBoard(); }
  if (h.get('q')) { S.q = h.get('q'); $('search').value = h.get('q'); renderBoard(); }
  if (h.get('tab') === 'live') switchTab('live');
  if (h.get('detail')) openDetail(h.get('detail'));
  if (h.has('palette')) openPalette();
}
function renderPalSel() { $('palList').querySelectorAll('li').forEach((li, i) => li.classList.toggle('sel', i === palSel)); }
init();
