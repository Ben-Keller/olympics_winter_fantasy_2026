/**
 * Family Draft Frontend (Static GitHub Pages)
 *
 * 1) Set API_URL to your Apps Script Web App URL:
 *    https://script.google.com/macros/s/XXXXX/exec
 */
const API_URL = "https://script.google.com/macros/s/AKfycbyv84H4pq292JE0eayjafeO2rXul484Vazwilfx1g_zOXrUsebZUvq1Et_DXgmHSdDN/exec";

let STATE = null;
let SORT = { key: "projected_points", dir: "desc" };
let FILTERS = { sport: "", search: "", showChosen: false };

const el = (id) => document.getElementById(id);

function badgeAvailable(isTaken) {
  return isTaken ? `<span class="badge no">Taken</span>` : `<span class="badge ok">Available</span>`;
}
function fmt(v, digits = 1) {
  if (v === null || v === undefined || v === "") return "—";
  const n = Number(v);
  if (!isFinite(n)) return String(v);
  return n.toFixed(digits);
}
function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
  }[m]));
}

async function apiGetState() {
  const r = await fetch(`${API_URL}?route=state`, { cache: "no-store" });
  return r.json();
}
async function apiPost(route, payload) {
  const r = await fetch(`${API_URL}?route=${encodeURIComponent(route)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload || {})
  });
  return r.json();
}

function computeTakenSet() {
  return new Set((STATE && STATE.taken_pair_ids) ? STATE.taken_pair_ids : []);
}

function renderTop() {
  const st = STATE.config?.draft_status || "—";
  el("statusPill").textContent = st === "OPEN" ? "Draft: OPEN" : "Draft: CLOSED";
  el("draftOpen").textContent = st;
  el("pickNum").textContent = STATE.current?.pick_number ?? "—";
  el("direction").textContent = (Number(STATE.current?.direction) === 1) ? "→" : "←";
  el("clock").textContent = STATE.current?.on_the_clock_name || "—";
}

function renderLeaderboard() {
  const rows = STATE.leaderboard || [];
  el("leaderboard").innerHTML = `
    <table>
      <thead>
        <tr><th>Rank</th><th>Player</th><th>Projected</th><th>Picks</th></tr>
      </thead>
      <tbody>
        ${rows.map((r,i)=>`
          <tr>
            <td class="mono">#${i+1}</td>
            <td>${escapeHtml(r.display_name)}</td>
            <td class="mono">${fmt(r.total_projected_points,1)}</td>
            <td class="mono">${r.picks_made}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;
}

function hydrateFilters() {
  const sports = Array.from(new Set((STATE.projections || []).map(p => p.sport)))
    .sort((a,b)=>a.localeCompare(b));
  const sel = el("sportFilter");
  const current = FILTERS.sport;
  sel.innerHTML = `<option value="">All sports</option>` + sports.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join("");
  sel.value = current || "";

  const psel = el("playerSelect");
  const old = psel.value;
  const players = STATE.players || [];
  psel.innerHTML = players.map(p => `<option value="${escapeHtml(p.player_id)}">${escapeHtml(p.display_name)}</option>`).join("");
  if (old) psel.value = old;
}

function renderPairsTable() {
  const taken = computeTakenSet();
  let rows = (STATE.projections || []).map(p => ({...p, isTaken: taken.has(p.pair_id)}));

  if (!FILTERS.showChosen) rows = rows.filter(r => !r.isTaken);
  if (FILTERS.sport) rows = rows.filter(r => r.sport === FILTERS.sport);
  if (FILTERS.search) {
    const q = FILTERS.search.toLowerCase();
    rows = rows.filter(r => (r.country||"").toLowerCase().includes(q) || (r.sport||"").toLowerCase().includes(q));
  }

  const key = SORT.key;
  const dir = SORT.dir === "asc" ? 1 : -1;

  if (key === "sport" || key === "country") {
    rows.sort((a,b)=>{
      const av = String(a[key]||"");
      const bv = String(b[key]||"");
      const c = av.localeCompare(bv);
      if (c !== 0) return c*dir;
      return (Number(b.projected_points||0) - Number(a.projected_points||0));
    });
  } else {
    rows.sort((a,b)=>{
      const av = Number(a[key]); const bv = Number(b[key]);
      const aN = isFinite(av) ? av : -Infinity;
      const bN = isFinite(bv) ? bv : -Infinity;
      if (aN === bN) {
        const s = String(a.sport).localeCompare(String(b.sport));
        if (s !== 0) return s;
        return String(a.country).localeCompare(String(b.country));
      }
      return (aN - bN)*dir;
    });
  }

  const arrow = (k)=> SORT.key===k ? (SORT.dir==="asc"?" ▲":" ▼") : "";

  el("pairsTable").innerHTML = `
    <table>
      <thead>
        <tr>
          <th data-sort="sport">Sport${arrow("sport")}</th>
          <th data-sort="country">Country${arrow("country")}</th>
          <th data-sort="power_rank">Power rank${arrow("power_rank")}</th>
          <th data-sort="projected_points">Projected pts${arrow("projected_points")}</th>
          <th data-sort="num_medals">Medals${arrow("num_medals")}</th>
          <th data-sort="last_year_score">Last year${arrow("last_year_score")}</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map(r=>`
          <tr class="pairRow" data-pair="${escapeHtml(r.pair_id)}">
            <td>${escapeHtml(r.sport)}</td>
            <td>${escapeHtml(r.country)}</td>
            <td class="mono">${fmt(r.power_rank,0)}</td>
            <td class="mono">${fmt(r.projected_points,1)}</td>
            <td class="mono">${fmt(r.num_medals,0)}</td>
            <td class="mono">${fmt(r.last_year_score,1)}</td>
            <td>${badgeAvailable(r.isTaken)}</td>
          </tr>`).join("")}
      </tbody>
    </table>`;

  document.querySelectorAll(".pairRow").forEach(tr=>{
    tr.addEventListener("click", ()=>{
      const pid = tr.getAttribute("data-pair");
      const p = (STATE.projections||[]).find(x=>x.pair_id===pid);
      if (!p) return;
      el("sportInput").value = p.sport;
      el("countryInput").value = p.country;
      el("pickMsg").textContent = `Selected: ${p.sport} — ${p.country}`;
      el("pickMsg").className = "msg";
    });
  });

  el("pairsTable").querySelectorAll("th[data-sort]").forEach(th=>{
    th.addEventListener("click", ()=>{
      const k = th.getAttribute("data-sort");
      if (SORT.key === k) SORT.dir = (SORT.dir==="asc"?"desc":"asc");
      else {
        SORT.key = k;
        SORT.dir = (k === "power_rank") ? "asc" : "desc";
        if (k === "sport" || k === "country") SORT.dir = "asc";
      }
      renderPairsTable();
    });
  });
}

function renderTeams() {
  const teams = STATE.teams || {};
  const leaderboard = STATE.leaderboard || [];
  const totalsById = {};
  leaderboard.forEach(r => totalsById[r.player_id] = r.total_projected_points);

  const players = STATE.players || [];
  el("teams").innerHTML = players.map(p=>{
    const roster = teams[p.player_id] || [];
    const total = totalsById[p.player_id] ?? 0;
    return `
      <div class="teamCard">
        <div class="teamCardHeader">
          <div class="teamName">${escapeHtml(p.display_name)}</div>
          <div class="teamTotal">${fmt(total,1)} pts</div>
        </div>
        <div class="teamList">
          ${roster.length ? roster.map(it=>`
            <div class="teamItem">
              <div class="left">
                <div class="sport">${escapeHtml(it.sport)}</div>
                <div class="country">${escapeHtml(it.country)}</div>
              </div>
              <div class="pts">${fmt(it.projected_points,1)}</div>
            </div>`).join("") : `<div class="hint">No picks yet</div>`}
        </div>
      </div>`;
  }).join("");
}

async function loadState() {
  if (!API_URL || API_URL.startsWith("PASTE_")) {
    el("statusPill").textContent = "Set API_URL in app.js";
    return;
  }
  const data = await apiGetState();
  if (!data.ok) {
    el("statusPill").textContent = "Error loading state";
    console.error(data);
    return;
  }
  STATE = data;
  renderTop();
  hydrateFilters();
  renderLeaderboard();
  renderPairsTable();
  renderTeams();
}

async function submitPick() {
  const player_id = el("playerSelect").value;
  const pin = el("pinInput").value.trim();
  const sport = el("sportInput").value.trim();
  const country = el("countryInput").value.trim();

  el("pickMsg").textContent = "Submitting…";
  el("pickMsg").className = "msg";

  const res = await apiPost("pick", { player_id, pin, sport, country });
  if (!res.ok) {
    el("pickMsg").textContent = res.error || "Pick rejected.";
    el("pickMsg").className = "msg err";
    return;
  }
  STATE = res.state;
  el("pickMsg").textContent = "Pick accepted ✅";
  el("pickMsg").className = "msg ok";
  el("pinInput").value = "";
  renderTop(); renderLeaderboard(); renderPairsTable(); renderTeams();
}

function openAdmin(on) {
  el("modalBackdrop").classList.toggle("hidden", !on);
  el("adminModal").classList.toggle("hidden", !on);
  el("adminMsg").textContent = "";
  el("adminMsg").className = "msg";
}
function showAdminMsg(res) {
  if (!res.ok) {
    el("adminMsg").textContent = res.error || "Admin action failed.";
    el("adminMsg").className = "msg err";
    return;
  }
  STATE = res.state;
  el("adminMsg").textContent = "Done ✅";
  el("adminMsg").className = "msg ok";
  renderTop(); renderLeaderboard(); renderPairsTable(); renderTeams();
}

function wireUI() {
  el("refreshBtn").addEventListener("click", () => loadState());
  el("showChosenToggle").addEventListener("change", (e) => { FILTERS.showChosen = !!e.target.checked; renderPairsTable(); });
  el("sportFilter").addEventListener("change", (e) => { FILTERS.sport = e.target.value || ""; renderPairsTable(); });
  el("searchBox").addEventListener("input", (e) => { FILTERS.search = e.target.value || ""; renderPairsTable(); });
  el("clearFilters").addEventListener("click", () => {
    FILTERS = { sport: "", search: "", showChosen: el("showChosenToggle").checked };
    el("sportFilter").value = ""; el("searchBox").value = "";
    renderPairsTable();
  });
  el("submitPick").addEventListener("click", submitPick);

  el("adminBtn").addEventListener("click", () => openAdmin(true));
  el("closeAdmin").addEventListener("click", () => openAdmin(false));
  el("modalBackdrop").addEventListener("click", () => openAdmin(false));

  el("undoBtn").addEventListener("click", async () => showAdminMsg(await apiPost("undo", { pin: el("adminPin").value.trim() })));
  el("resetBtn").addEventListener("click", async () => showAdminMsg(await apiPost("reset", { pin: el("adminPin").value.trim() })));
  el("openBtn").addEventListener("click", async () => showAdminMsg(await apiPost("set_status", { pin: el("adminPin").value.trim(), draft_status: "OPEN" })));
  el("closeBtn").addEventListener("click", async () => showAdminMsg(await apiPost("set_status", { pin: el("adminPin").value.trim(), draft_status: "CLOSED" })));
}

async function start() {
  wireUI();
  await loadState();
  setInterval(() => loadState().catch(()=>{}), 4000);
}
start();
