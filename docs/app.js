// Power Rankings front end: loads weekly JSON, blends factor scores with slider weights.
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k) { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let INDEX, LG, DATA, PREV, weights, ranked = [];
let league = "cfb";
let beforeSolo = null; // weights to restore after cycling through a column header
let reverse = false;    // true = showing the bottom of the list first

const PRESETS = {
  "Default": null,
  "Who'd you beat": { resume: 60, sos: 25, cupcake: 15 },
  "Who'd win": { power: 45, efficiency: 40, recent: 15 },
  "Hot right now": { power: 15, resume: 10, efficiency: 15, sos: 5, recent: 55 },
  "Equal": { power: 15, resume: 15, efficiency: 15, sos: 15, recent: 15, cupcake: 15, luck: 10 },
};
const SHORT = { power: "PWR", resume: "RES", efficiency: "EFF", sos: "SOS", recent: "FORM", cupcake: "CUP", luck: "LUCK" };
const LEAGUE_NAME = { cfb: "CFB", nfl: "NFL" };

async function getJSON(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(url + " " + r.status);
  return r.json();
}

function hashParams() {
  const h = new URLSearchParams(location.hash.slice(1));
  return { league: h.get("league"), team: h.get("team") };
}

async function init() {
  try {
    INDEX = await getJSON("data/index.json");
  } catch (e) {
    $(".board").innerHTML = `<div class="card">No rankings yet. Run <code>python src/run_weekly.py</code> first.</div>`;
    return;
  }
  const leagues = Object.keys(INDEX.leagues);
  const want = hashParams().league || store.get("league");
  league = leagues.includes(want) ? want : leagues[0];
  $("#league").innerHTML = leagues.map((l) => `<button data-league="${esc(l)}">${esc(LEAGUE_NAME[l] || l)}</button>`).join("");
  $("#league").onclick = (e) => { const l = e.target.dataset.league; if (l && l !== league) switchLeague(l); };

  $("#updated").textContent = "Updated " + new Date(INDEX.updated).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" }) + ".";
  $("#presets").onclick = (e) => {
    const p = e.target.dataset.preset;
    if (p) setWeights(PRESETS[p] || LG.default_weights);
  };
  $("#reset").onclick = () => setWeights(LG.default_weights);
  $("#clear").onclick = () => setWeights({});
  document.querySelector("th.factors-col").onclick = (e) => { const k = e.target.dataset.only; if (k) solo(k); };
  $("#rankby").onchange = (e) => {
    const [k, dir] = e.target.value.split(":");
    if (!k) return restoreBlend();
    if (soloKey() !== k) beforeSolo = beforeSolo || { ...weights };
    setWeights({ [k]: 100 }, dir === "asc");
  };

  $("#season").onchange = () => { fillWeeks(); loadWeek(); };
  $("#week").onchange = loadWeek;
  ["#search", "#conf", "#top25"].forEach((s) => $(s).addEventListener("input", render));
  document.querySelectorAll(".tab").forEach((t) => (t.onclick = () => {
    document.querySelectorAll(".tab").forEach((x) => x.classList.toggle("active", x === t));
    document.querySelectorAll(".tabpanel").forEach((p) => p.classList.toggle("hidden", p.id !== "tab-" + t.dataset.tab));
  }));
  const closeDrawer = () => { $("#drawer").classList.add("hidden"); history.replaceState(null, "", location.pathname + "#league=" + league); };
  $("#drawer").onclick = (e) => { if ("close" in e.target.dataset) closeDrawer(); };
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer(); });
  $("#table tbody").onclick = (e) => {
    const tr = e.target.closest("tr[data-team]");
    if (tr) openTeam(tr.dataset.team);
  };
  await switchLeague(league, true);
}

async function switchLeague(l, first = false) {
  league = l;
  LG = INDEX.leagues[l];
  store.set("league", l);
  document.querySelectorAll("#league button").forEach((b) => b.classList.toggle("active", b.dataset.league === l));
  document.body.dataset.league = l;
  $("#league-tag").textContent = LEAGUE_NAME[l] || l;
  const keys = LG.factors.map((f) => f.key);
  const saved = store.get("weights_" + l);
  weights = Object.fromEntries(keys.map((k) => [k, (saved && k in saved ? saved : LG.default_weights)[k] ?? 0]));

  const seasons = Object.keys(LG.seasons).sort((a, b) => b - a);
  $("#season").innerHTML = seasons.map((s) => `<option>${esc(s)}</option>`).join("");
  $("#season").value = LG.latest.season;
  fillWeeks();
  $("#presets").innerHTML = Object.keys(PRESETS).map((p) => `<button data-preset="${esc(p)}">${esc(p)}</button>`).join("");
  $("#factor-help").innerHTML = LG.factors.map((f) => `<li><b>${esc(f.label)}:</b> ${esc(f.help)}</li>`).join("");
  $("#search").placeholder = l === "nfl" ? "Search team…" : "Search team…";
  $("#conf").options[0].textContent = l === "nfl" ? "All divisions" : "All conferences";
  beforeSolo = null;
  $("#rankby").innerHTML = `<option value="">Blend (sliders)</option>` + LG.factors.map((f) =>
    `<option value="${esc(f.key)}:desc">${esc(f.label)}: best first</option><option value="${esc(f.key)}:asc">${esc(f.label)}: worst first</option>`).join("");
  buildSliders();
  if (!first) history.replaceState(null, "", location.pathname + "#league=" + l);
  await loadWeek();
}

function fillWeeks() {
  const s = LG.seasons[$("#season").value];
  $("#week").innerHTML = s.weeks.slice().reverse().map((w) => `<option value="${w}">${w === 0 ? "Preseason" : "Week " + w}</option>`).join("");
}

async function loadWeek() {
  const season = $("#season").value, week = +$("#week").value;
  const base = `data/${league}/${season}/week_`;
  try {
    DATA = await getJSON(base + week + ".json");
  } catch (e) {
    $("#table tbody").innerHTML = `<tr><td colspan="7" class="muted">Couldn't load this week. Try refreshing.</td></tr>`;
    return;
  }
  PREV = LG.seasons[season].weeks.includes(week - 1) ? await getJSON(base + (week - 1) + ".json").catch(() => null) : null;
  const confs = [...new Set(DATA.teams.map((t) => t.conference).filter(Boolean))].sort();
  const cur = $("#conf").value;
  $("#conf").innerHTML = `<option value="">${league === "nfl" ? "All divisions" : "All conferences"}</option>` + confs.map((c) => `<option>${esc(c)}</option>`).join("");
  $("#conf").value = confs.includes(cur) ? cur : "";
  const hasAP = DATA.teams.some((t) => t.ap_rank);
  document.body.classList.toggle("no-ap", !hasAP);
  $("#top25-label").lastChild.textContent = hasAP ? " AP Poll top 25 only" : league === "nfl" ? " Top 10 only" : " Top 25 only";
  $("#prior-note").textContent = DATA.prior_weight > 0
    ? `Early season: the preseason expectation still counts like ${DATA.prior_weight} game(s) in the Power rating. It fades to zero in a few weeks.`
    : "";
  render();
  renderPicks();
  const { team } = hashParams();
  if (team) openTeam(team);
}

function buildSliders() {
  $("#sliders").innerHTML = LG.factors.map((f) => `
    <div class="slider">
      <div class="slider-top"><span>${esc(f.label)}</span><span id="v-${esc(f.key)}"></span></div>
      <input type="range" min="0" max="100" step="5" id="w-${esc(f.key)}" aria-label="${esc(f.label)} weight">
      <p>${esc(f.help)}</p>
    </div>`).join("");
  LG.factors.forEach((f) => {
    const el = $("#w-" + f.key);
    el.value = weights[f.key] ?? 0;
    el.oninput = () => { reverse = false; weights[f.key] = +el.value; store.set("weights_" + league, weights); showWeights(); render(); };
  });
  showWeights();
}

function setWeights(w, rev = false) {
  reverse = rev;
  weights = Object.fromEntries(LG.factors.map((f) => [f.key, (w || {})[f.key] ?? 0]));
  store.set("weights_" + league, weights);
  LG.factors.forEach((f) => ($("#w-" + f.key).value = weights[f.key]));
  showWeights();
  render();
}

// Header clicks cycle: best first -> worst first -> back to the previous blend
function solo(key) {
  if (soloKey() === key && !reverse) return setWeights({ [key]: 100 }, true);
  if (soloKey() === key) return restoreBlend();
  if (!soloKey()) beforeSolo = { ...weights };
  setWeights({ [key]: 100 });
}

function restoreBlend() {
  setWeights(beforeSolo || LG.default_weights);
  beforeSolo = null;
}

function soloKey() {
  const on = Object.entries(weights).filter(([, w]) => w > 0);
  return on.length === 1 ? on[0][0] : null;
}

function showWeights() {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  const only = soloKey();
  LG.factors.forEach((f) => {
    $("#v-" + f.key).textContent = total ? Math.round((100 * (weights[f.key] || 0)) / total) + "%" : "0%";
  });
  $("#rankby").value = only ? `${only}:${reverse ? "asc" : "desc"}` : "";
  $("#weights-note").textContent = !total ? "All weights are 0. Showing teams ordered by Power rating. Move a slider or click Only."
    : only ? `Ranking by ${LG.factors.find((f) => f.key === only).label} only, ${reverse ? "worst first. Click the header again to go back to your blend." : "best first. Click the header again for worst first."}` : "";
}

function composite(teams) {
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return teams
    .map((t) => ({ ...t, comp: total ? Object.entries(weights).reduce((s, [k, w]) => s + w * (t.scores[k] ?? 50), 0) / total : t.scores.power }))
    .sort((a, b) => b.comp - a.comp || b.rating - a.rating)
    .map((t, i) => ({ ...t, rank: i + 1 }));
}

const heat = (v) => `background:hsla(${Math.round(v * 1.3)},65%,45%,.18)`;
const safeUrl = (u) => (/^https:\/\//.test(u || "") ? u : "");
const logo = (t, cls = "") => safeUrl(t.logo) ? `<img src="${esc(t.logo)}" alt="" loading="lazy" class="${cls}">` : `<span class="logo-ph ${cls}"></span>`;
// CFB: show only teams in the AP Top 25 (at wherever the model ranks them). NFL has no poll: model top 10.
const inTopFilter = (t) => (document.body.classList.contains("no-ap") ? t.rank <= (league === "nfl" ? 10 : 25) : !!t.ap_rank);

function apTag(t) {
  if (t.ap_rank && t.rank - t.ap_rank >= 10) return `<span class="pill over" title="AP has them ${t.rank - t.ap_rank} spots higher">Overrated</span>`;
  if ((t.ap_rank && t.ap_rank - t.rank >= 10) || (!t.ap_rank && t.rank <= 15 && !document.body.classList.contains("no-ap"))) return `<span class="pill under" title="Model ranks them well above the AP poll">Underrated</span>`;
  return "";
}

function render() {
  ranked = composite(DATA.teams);
  const prevRank = PREV ? Object.fromEntries(composite(PREV.teams).map((t) => [t.team, t.rank])) : {};
  const q = $("#search").value.trim().toLowerCase(), conf = $("#conf").value, top = $("#top25").checked;
  const rows = (reverse ? [...ranked].reverse() : ranked).filter((t) => (!q || t.team.toLowerCase().includes(q)) && (!conf || t.conference === conf) && (!top || inTopFilter(t)));
  const only = soloKey();
  $("#table tbody").innerHTML = rows.map((t) => {
    const p = prevRank[t.team], d = p ? p - t.rank : 0;
    const mv = !p ? "" : d > 0 ? `<span class="up">▲${d}</span>` : d < 0 ? `<span class="down">▼${-d}</span>` : `<span class="muted">–</span>`;
    const chips = LG.factors.map((f) => `<span class="chip${only === f.key ? " sel" : ""}" style="${heat(t.scores[f.key])}" title="${esc(f.label)}: ${esc(t.scores[f.key])}">${Math.round(t.scores[f.key])}</span>`).join("");
    return `<tr data-team="${esc(t.team)}">
      <td class="num rank">${t.rank}</td><td class="mv">${mv}</td>
      <td><div class="team">${logo(t)}<div><b>${esc(t.team)}${apTag(t)}</b><small>${esc(t.conference || "")}</small></div></div></td>
      <td class="num">${esc(t.record)}</td>
      <td class="num ap">${t.ap_rank ? esc(t.ap_rank) : '<span class="muted">–</span>'}</td>
      <td><div class="score">${t.comp.toFixed(1)}<span class="bar"><i style="width:${+t.comp || 0}%"></i></span></div></td>
      <td class="factors"><div class="chips">${chips}</div></td></tr>`;
  }).join("");
  const labels = LG.factors.map((f) => `<button class="chip head${only === f.key ? " sel" : ""}" data-only="${esc(f.key)}" title="Click: rank by ${esc(f.label)} only. Again: worst first. Again: back to your blend. ${esc(f.help)}">${SHORT[f.key] || esc(f.label.slice(0, 4))}${only === f.key ? (reverse ? " ▲" : " ▼") : ""}</button>`).join("");
  document.querySelector("th.factors-col").innerHTML = `<div class="chips">${labels}</div>`;
}

function whyBullets(t) {
  const f = LG.factors.map((x) => ({ ...x, v: t.scores[x.key] })).sort((a, b) => b.v - a.v);
  const out = [];
  if (t.next_qb && t.usual_qb && t.next_qb !== t.usual_qb) out.push(`QB change: ${t.next_qb} is listed to start next, not ${t.usual_qb}, who started most games so far. The rating doesn't account for this.`);
  const strong = f.filter((x) => x.v >= 65).slice(0, 2);
  if (strong.length) out.push("Strengths: " + strong.map((x) => `${x.label.toLowerCase()} (${Math.round(x.v)})`).join(", ") + ".");
  const weak = f.filter((x) => x.v < 40).slice(-2).reverse();
  if (weak.length) out.push("Weaknesses: " + weak.map((x) => `${x.label.toLowerCase()} (${Math.round(x.v)})`).join(", ") + ".");
  const games = t.wins + t.losses, cups = t.fcs_games + t.weak_games;
  if (league === "cfb" && cups >= 2) out.push(`${cups} of ${games} games were cupcakes (${t.fcs_games} FCS, ${t.weak_games} bottom-tier FBS). Those wins barely count.`);
  if (t.luck_wins >= 1) out.push(`Lucky: about ${t.luck_wins.toFixed(1)} more wins than their play deserved (${t.one_score} in one-score games).`);
  if (t.luck_wins <= -1) out.push(`Unlucky: about ${(-t.luck_wins).toFixed(1)} fewer wins than their play deserved (${t.one_score} in one-score games).`);
  if (t.ap_rank && t.rank - t.ap_rank >= 10) out.push(`AP has them #${t.ap_rank}; the numbers say #${t.rank}.`);
  if (league === "cfb" && !t.ap_rank && t.rank <= 25) out.push("Unranked in the AP poll despite the numbers.");
  return out;
}

function openTeam(name) {
  const t = ranked.find((x) => x.team === name);
  if (!t) return;
  const sosRank = [...DATA.teams].sort((a, b) => b.raw.sos - a.raw.sos).findIndex((x) => x.team === name) + 1;
  const why = whyBullets(t);
  const nfl = league === "nfl";
  const sched = t.schedule.map((g) => {
    const opp = `${g.loc === "A" ? "@ " : g.loc === "N" ? "vs " : ""}${g.opp_rank && !g.fcs ? `<span class="muted">#${esc(g.opp_rank)}</span> ` : ""}${esc(g.opp)}${g.fcs ? ' <span class="pill over">FCS</span>' : g.cupcake ? ' <span class="pill over">cupcake</span>' : ""}`
      + (g.qb ? `<small class="muted">QB ${esc(g.qb)}${g.qb !== t.usual_qb && t.usual_qb ? " ⚠" : ""}${g.rest_diff ? ` · ${g.rest_diff > 0 ? "+" : ""}${esc(g.rest_diff)} days rest vs. opp` : ""}</small>` : "");
    if (g.upcoming) return `<tr><td>${esc(g.week)}</td><td>${opp}</td><td colspan="2" class="muted">Model: ${g.spread > 0 ? "favored by " + esc(g.spread) : "underdog by " + esc(-g.spread)} (${Math.round(g.win_prob * 100)}%)</td></tr>`;
    return `<tr><td>${esc(g.week)}</td><td>${opp}</td><td><span class="${g.result === "W" ? "W" : "L"}">${esc(g.result)}</span> ${esc(g.score)}</td>
      <td class="num" title="A benchmark team wins this game ${Math.round((1 - g.difficulty) * 100)}% of the time">${Math.round(g.difficulty * 100)}%</td></tr>`;
  }).join("");
  const bench = nfl ? "top-8 NFL team" : "top-25 team";
  $("#drawer-body").innerHTML = `
    <div class="d-head">${logo(t)}<div><h2>#${t.rank} ${esc(t.team)}</h2><span class="muted">${esc(t.conference || "")} · ${esc(t.record)}${t.ap_rank ? " · AP #" + esc(t.ap_rank) : ""}</span></div></div>
    ${why.length ? `<div class="why"><b>Why they're here</b><ul>${why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul></div>` : ""}
    <div class="stats">
      <div class="stat"><small>Power rating</small><b>${t.rating > 0 ? "+" : ""}${t.rating.toFixed(1)}</b></div>
      <div class="stat"><small>Schedule rank</small><b>#${sosRank}</b></div>
      <div class="stat"><small>One-score games</small><b>${esc(t.one_score)}</b></div>
      <div class="stat"><small>Wins vs. deserved</small><b>${t.luck_wins > 0 ? "+" : ""}${t.luck_wins.toFixed(1)}</b></div>
      ${nfl ? `<div class="stat"><small>Main starting QB</small><b>${esc(t.usual_qb || "—")}</b></div>`
            : `<div class="stat"><small>FCS games</small><b>${esc(t.fcs_games)}</b></div><div class="stat"><small>Bottom-tier FBS</small><b>${esc(t.weak_games)}</b></div>`}
    </div>
    <h3>Factor scores</h3>
    ${LG.factors.map((f) => `<div class="frow" title="${esc(f.help)}"><span>${esc(f.label)}</span><span class="bar"><i style="width:${+t.scores[f.key] || 0}%"></i></span><b class="num">${Math.round(t.scores[f.key])}</b></div>`).join("")}
    <p class="note">Power rating = points better than an average ${nfl ? "NFL" : "FBS"} team on a neutral field.</p>
    <h3>Schedule</h3>
    <table class="sched"><thead><tr><th>Wk</th><th>Opponent</th><th>Result</th><th class="num" title="How hard it is for a ${bench} to win this game">Difficulty</th></tr></thead><tbody>${sched}</tbody></table>
    <p class="note">Difficulty is the chance a typical ${bench} would lose this game.${nfl ? " ⚠ = a different QB than the team's usual starter." : " Beating FCS teams is close to 0%."}</p>`;
  $("#drawer").classList.remove("hidden");
  history.replaceState(null, "", `#league=${league}&team=${encodeURIComponent(name)}`);
}

const BOOK_ABBR = { DraftKings: "DK", Bovada: "Bovada", "ESPN Bet": "ESPN", FanDuel: "FD", BetMGM: "MGM", Caesars: "CZR", Consensus: "Consensus" };
const signed = (n) => (n > 0 ? "+" : n < 0 ? "−" : "") + Math.abs(n);
// Home-perspective margin (positive = home favored) -> "Team -7.5"
const lineText = (g, margin) => margin === 0 ? "Pick'em" : `${esc(margin > 0 ? g.home : g.away)} −${Math.abs(margin).toFixed(1)}`;
const rec = (r) => r && r.games ? `${r.correct}-${r.games - r.correct} (${((100 * r.correct) / r.games).toFixed(1)}%)` : "—";

function qbNote(g) {
  if (!g.home_qb && !g.away_qb) return "";
  const usual = Object.fromEntries(DATA.teams.map((t) => [t.team, t.usual_qb]));
  const one = (team, qb) => qb ? `${esc(qb)}${usual[team] && usual[team] !== qb ? ' <b class="hot" title="Not the usual starter">⚠</b>' : ""}` : "?";
  return `<small class="muted">QBs: ${one(g.away, g.away_qb)} vs. ${one(g.home, g.home_qb)}</small>`;
}

function renderPicks() {
  const p = DATA.predictions || [];
  $("#picks-title").textContent = `Week ${DATA.week + 1} picks vs. the sportsbooks (made after week ${DATA.week})`;
  const a = LG.seasons[$("#season").value].accuracy;
  $("#acc").innerHTML = a.games ? `
    <b>Season record.</b> Straight up: model ${rec(a.model_su_lined || a)} vs. books' favorite ${rec(a.vegas_su)}.
    Against the spread: ${rec(a.ats)}, and on 3+ point disagreements, ${rec(a.ats_strong)}. You need 52.4% to break even on a bet at standard −110 odds.
    <br>The books usually know more (injuries, weather, sharp money). Where the model disagrees, treat it as a conversation starter, not a bet.`
    : "Picks are graded once the games are played.";
  const edgeKey = (g) => (g.edge == null ? -1 : Math.abs(g.edge));
  const rows = [...p].sort((x, y) => edgeKey(y) - edgeKey(x) || Math.abs(x.spread) - Math.abs(y.spread));
  $("#picks tbody").innerHTML = rows.length ? rows.map((g) => {
    const books = g.books ? g.books.map((b) => {
      // Book lines are home-side; show them from the same favorite as the median line
      const favHome = g.vegas >= 0, bookFavHome = b.spread <= 0;
      const txt = b.spread === 0 ? "PK" : (bookFavHome === favHome ? "" : esc(bookFavHome ? g.home : g.away) + " ") + "−" + Math.abs(b.spread);
      const tip = `${b.book}${b.total ? " · O/U " + b.total : ""}${b.open != null ? ` · opened ${g.home} ${signed(b.open)}` : ""}`;
      return `<span class="book" title="${esc(tip)}">${esc(BOOK_ABBR[b.book] || b.book)} ${txt}</span>`;
    }).join("") : '<span class="muted">No line yet</span>';
    const edge = g.edge == null ? '<span class="muted">—</span>'
      : `<b class="${Math.abs(g.edge) >= 3 ? "hot" : ""}">${esc(g.ats_pick)} ${signed(g.best_line)}</b><small class="muted">edge ${Math.abs(g.edge).toFixed(1)} · best at ${esc(BOOK_ABBR[g.best_book] || g.best_book)}</small>`;
    let res = '<span class="muted">—</span>';
    if (g.actual !== undefined) {
      const mark = (ok) => ok == null ? '<span class="muted">push</span>' : `<span class="${ok ? "W" : "L"}">${ok ? "✓" : "✗"}</span>`;
      res = `${esc(g.actual > 0 ? g.home : g.away)} by ${Math.abs(g.actual)}<small class="muted">SU ${mark(g.correct)}${g.edge != null ? " · ATS " + mark(g.ats_correct) : ""}</small>`;
    }
    const wp = g.pick === g.home ? g.home_win_prob : 1 - g.home_win_prob;
    return `<tr><td>${esc(g.away)} <span class="muted">@</span> ${esc(g.home)}${qbNote(g)}</td>
      <td>${lineText(g, g.spread)}<small class="muted">${esc(g.pick)} wins ${Math.round(wp * 100)}%</small></td>
      <td>${g.vegas != null ? lineText(g, g.vegas) : '<span class="muted">—</span>'}<div class="books">${books}</div></td>
      <td>${edge}</td><td>${res}</td></tr>`;
  }).join("") : `<tr><td colspan="5" class="muted">No games scheduled.</td></tr>`;
}

init();
