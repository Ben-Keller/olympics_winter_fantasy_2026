/**
 * Family Winter Olympics Draft API (Google Apps Script Web App)
 *
 * Endpoints:
 *  GET  ?route=state
 *  POST ?route=pick        {player_id, pin, sport, country}  OR {player_id, pin, pair_id}
 *  POST ?route=undo        {pin} (commissioner only)
 *  POST ?route=reset       {pin} (commissioner only)
 *  POST ?route=set_status  {pin, draft_status: "OPEN"|"CLOSED"} (commissioner only)
 *
 * Required sheets:
 *  - Config (key,value)
 *  - Players (player_id, display_name, pin, turn_order)
 *  - Projections (pair_id,sport,country,power_rank,projected_points,num_medals,last_year_score)
 *  - Picks (timestamp_iso,pick_number,player_id,player_name,sport,country,pair_id,status,reason)
 */

const SHEET_CONFIG = "Config";
const SHEET_PLAYERS = "Players";
const SHEET_PROJECTIONS = "Projections";
const SHEET_PICKS = "Picks";

function doGet(e) {
  const route = (e && e.parameter && e.parameter.route) ? String(e.parameter.route) : "state";
  if (route === "state") return json_(getState_());
  return json_({ ok: false, error: "Unknown route" }, 404);
}

function doPost(e) {
  const route = (e && e.parameter && e.parameter.route) ? String(e.parameter.route) : "";
  const body = parseBody_(e);

  try {
    if (route === "pick") return json_(handlePick_(body));
    if (route === "undo") return json_(handleUndo_(body));
    if (route === "reset") return json_(handleReset_(body));
    if (route === "set_status") return json_(handleSetStatus_(body));
    return json_({ ok: false, error: "Unknown route" }, 404);
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) }, 500);
  }
}

/* -------------------- Core handlers -------------------- */

function handlePick_(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    const ss = SpreadsheetApp.getActive();
    const cfg = readConfig_(ss);
    if (String(cfg.draft_status).toUpperCase() !== "OPEN") {
      return { ok: false, error: "Draft is CLOSED." };
    }

    const players = readPlayers_(ss);
    const player = players.byId[body.player_id];
    if (!player) return { ok: false, error: "Unknown player_id." };

    const isCommissioner = (String(body.pin) === String(cfg.commissioner_pin));
    const pinOk = isCommissioner || (String(body.pin) === String(player.pin));
    if (!pinOk) return { ok: false, error: "Invalid PIN." };

    // Enforce turn unless commissioner or allow_out_of_turn
    const allowOutOfTurn = (String(cfg.allow_out_of_turn).toUpperCase() === "TRUE");
    const currentPlayerId = players.byTurn[Number(cfg.turn_index)]?.player_id;
    if (!allowOutOfTurn && !isCommissioner && currentPlayerId !== player.player_id) {
      return { ok: false, error: `Not your turn. Currently on the clock: ${players.byId[currentPlayerId].display_name}` };
    }

    const projections = readProjections_(ss);
    let pickPair = null;

    if (body.pair_id) {
      pickPair = projections.byPairId[String(body.pair_id)];
      if (!pickPair) return { ok: false, error: "Invalid pair_id." };
    } else {
      const sport = String(body.sport || "").trim();
      const country = String(body.country || "").trim();
      if (!sport || !country) return { ok: false, error: "sport and country are required (or pair_id)." };
      pickPair = projections.bySportCountry[`${sport}||${country}`];
      if (!pickPair) return { ok: false, error: "That sport/country pair is not found in Projections." };
    }

    // Validate availability
    const picks = readPicks_(ss);
    const pairTaken = !!picks.takenPairIds[pickPair.pair_id];
    if (pairTaken) return { ok: false, error: "That sport/country pairing has already been taken." };

    // Validate one sport per player
    const hasSport = !!picks.playerSportTaken[`${player.player_id}||${pickPair.sport}`];
    if (hasSport) return { ok: false, error: `You already picked a country for ${pickPair.sport}.` };

    // Append pick
    const pickNumber = Number(cfg.pick_number);
    const nowIso = new Date().toISOString();
    appendPick_(ss, {
      timestamp_iso: nowIso,
      pick_number: pickNumber,
      player_id: player.player_id,
      player_name: player.display_name,
      sport: pickPair.sport,
      country: pickPair.country,
      pair_id: pickPair.pair_id,
      status: "OK",
      reason: ""
    });

    // Advance snake draft state
    advanceDraft_(ss, cfg, players);

    return { ok: true, state: getState_() };
  } finally {
    lock.releaseLock();
  }
}

function handleUndo_(body) {
  const ss = SpreadsheetApp.getActive();
  const cfg = readConfig_(ss);
  if (String(body.pin) !== String(cfg.commissioner_pin)) return { ok: false, error: "Commissioner PIN required." };

  const sh = ss.getSheetByName(SHEET_PICKS);
  const lastRow = sh.getLastRow();
  if (lastRow <= 1) return { ok: false, error: "No picks to undo." };

  sh.deleteRow(lastRow);
  recomputeDraftPositionFromPicks_(ss);

  return { ok: true, state: getState_() };
}

function handleReset_(body) {
  const ss = SpreadsheetApp.getActive();
  const cfg = readConfig_(ss);
  if (String(body.pin) !== String(cfg.commissioner_pin)) return { ok: false, error: "Commissioner PIN required." };

  const sh = ss.getSheetByName(SHEET_PICKS);
  const lastRow = sh.getLastRow();
  if (lastRow > 1) sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();

  writeConfig_(ss, { pick_number: 1, direction: 1, turn_index: 1 });
  return { ok: true, state: getState_() };
}

function handleSetStatus_(body) {
  const ss = SpreadsheetApp.getActive();
  const cfg = readConfig_(ss);
  if (String(body.pin) !== String(cfg.commissioner_pin)) return { ok: false, error: "Commissioner PIN required." };

  const st = String(body.draft_status || "").toUpperCase();
  if (st !== "OPEN" && st !== "CLOSED") return { ok: false, error: "draft_status must be OPEN or CLOSED." };
  writeConfig_(ss, { draft_status: st });
  return { ok: true, state: getState_() };
}

/* -------------------- State -------------------- */

function getState_() {
  const ss = SpreadsheetApp.getActive();
  const cfg = readConfig_(ss);
  const players = readPlayers_(ss);
  const projections = readProjections_(ss);
  const picks = readPicks_(ss);

  // Totals using projected_points
  const totals = {};
  const teams = {};
  for (const pid of Object.keys(players.byId)) { totals[pid] = 0; teams[pid] = []; }

  for (const pick of picks.rows) {
    if (pick.status !== "OK") continue;
    const pair = projections.byPairId[pick.pair_id];
    const pts = pair ? Number(pair.projected_points || 0) : 0;
    totals[pick.player_id] = (totals[pick.player_id] || 0) + pts;

    teams[pick.player_id].push({
      sport: pick.sport,
      country: pick.country,
      pair_id: pick.pair_id,
      power_rank: pair ? pair.power_rank : null,
      projected_points: pair ? pair.projected_points : null,
      num_medals: pair ? pair.num_medals : null,
      last_year_score: pair ? pair.last_year_score : null
    });
  }

  for (const pid of Object.keys(teams)) {
    teams[pid].sort((a, b) => String(a.sport).localeCompare(String(b.sport)));
  }

  const leaderboard = Object.keys(players.byId).map(pid => ({
    player_id: pid,
    display_name: players.byId[pid].display_name,
    total_projected_points: round1_(totals[pid] || 0),
    picks_made: teams[pid].length
  })).sort((a, b) => b.total_projected_points - a.total_projected_points);

  const takenPairIds = Object.keys(picks.takenPairIds);
  const currentPlayerId = players.byTurn[Number(cfg.turn_index)]?.player_id || null;

  return {
    ok: true,
    config: cfg,
    players: Object.values(players.byId).sort((a, b) => a.turn_order - b.turn_order),
    current: {
      pick_number: Number(cfg.pick_number),
      direction: Number(cfg.direction),
      turn_index: Number(cfg.turn_index),
      on_the_clock_player_id: currentPlayerId,
      on_the_clock_name: currentPlayerId ? players.byId[currentPlayerId].display_name : null
    },
    projections: projections.rows,
    picks: picks.rows,
    taken_pair_ids: takenPairIds,
    teams,
    leaderboard
  };
}

function advanceDraft_(ss, cfg, players) {
  const nPlayers = players.count;
  let turnIndex = Number(cfg.turn_index);
  let direction = Number(cfg.direction);
  let pickNumber = Number(cfg.pick_number);

  if (direction === 1) {
    if (turnIndex === nPlayers) {
      direction = -1;
      turnIndex = Math.max(1, nPlayers - 1);
    } else {
      turnIndex += 1;
    }
  } else {
    if (turnIndex === 1) {
      direction = 1;
      turnIndex = Math.min(nPlayers, 2);
    } else {
      turnIndex -= 1;
    }
  }

  pickNumber += 1;
  writeConfig_(ss, { pick_number: pickNumber, direction: direction, turn_index: turnIndex });
}

function recomputeDraftPositionFromPicks_(ss) {
  const players = readPlayers_(ss);
  const picks = readPicks_(ss);
  const nPlayers = players.count;

  let pickNumber = 1, direction = 1, turnIndex = 1;

  for (const p of picks.rows) {
    if (p.status !== "OK") continue;
    if (direction === 1) {
      if (turnIndex === nPlayers) {
        direction = -1;
        turnIndex = Math.max(1, nPlayers - 1);
      } else {
        turnIndex += 1;
      }
    } else {
      if (turnIndex === 1) {
        direction = 1;
        turnIndex = Math.min(nPlayers, 2);
      } else {
        turnIndex -= 1;
      }
    }
    pickNumber += 1;
  }
  writeConfig_(ss, { pick_number: pickNumber, direction, turn_index: turnIndex });
}

/* -------------------- Data access -------------------- */

function readConfig_(ss) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const values = sh.getDataRange().getValues();
  const cfg = {};
  for (let i = 0; i < values.length; i++) {
    const k = values[i][0];
    const v = values[i][1];
    if (!k) continue;
    cfg[String(k).trim()] = v;
  }
  if (!cfg.draft_status) cfg.draft_status = "OPEN";
  if (!cfg.pick_number) cfg.pick_number = 1;
  if (!cfg.direction) cfg.direction = 1;
  if (!cfg.turn_index) cfg.turn_index = 1;
  return cfg;
}

function writeConfig_(ss, patch) {
  const sh = ss.getSheetByName(SHEET_CONFIG);
  const values = sh.getDataRange().getValues();
  const rowByKey = {};
  for (let i = 0; i < values.length; i++) {
    const k = values[i][0];
    if (k) rowByKey[String(k).trim()] = i + 1;
  }
  for (const k of Object.keys(patch)) {
    const row = rowByKey[k];
    if (row) {
      sh.getRange(row, 2).setValue(patch[k]);
    } else {
      const last = sh.getLastRow() + 1;
      sh.getRange(last, 1).setValue(k);
      sh.getRange(last, 2).setValue(patch[k]);
    }
  }
}

function readPlayers_(ss) {
  const sh = ss.getSheetByName(SHEET_PLAYERS);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = indexMap_(headers);

  const byId = {}, byTurn = {};
  let count = 0;

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const player_id = String(row[idx.player_id] || "").trim();
    if (!player_id) continue;
    const display_name = String(row[idx.display_name] || "").trim();
    const pin = String(row[idx.pin] || "").trim();
    const turn_order = Number(row[idx.turn_order] || 0);
    const obj = { player_id, display_name, pin, turn_order };
    byId[player_id] = obj;
    if (turn_order) byTurn[turn_order] = obj;
    count++;
  }
  return { byId, byTurn, count };
}

function readProjections_(ss) {
  const sh = ss.getSheetByName(SHEET_PROJECTIONS);
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  const idx = indexMap_(headers);

  const rows = [];
  const byPairId = {};
  const bySportCountry = {};

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const pair_id = String(row[idx.pair_id] || "").trim();
    const sport = String(row[idx.sport] || "").trim();
    const country = String(row[idx.country] || "").trim();
    if (!pair_id || !sport || !country) continue;

    const obj = {
      pair_id,
      sport,
      country,
      power_rank: num_(row[idx.power_rank]),
      projected_points: num_(row[idx.projected_points]),
      num_medals: num_(row[idx.num_medals]),
      last_year_score: num_(row[idx.last_year_score]),
    };

    rows.push(obj);
    byPairId[pair_id] = obj;
    bySportCountry[`${sport}||${country}`] = obj;
  }
  return { rows, byPairId, bySportCountry };
}

function readPicks_(ss) {
  const sh = ss.getSheetByName(SHEET_PICKS);
  const values = sh.getDataRange().getValues();
  if (values.length <= 1) return { rows: [], takenPairIds: {}, playerSportTaken: {} };

  const headers = values[0].map(String);
  const idx = indexMap_(headers);

  const rows = [];
  const takenPairIds = {};
  const playerSportTaken = {};

  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const status = String(row[idx.status] || "").trim() || "OK";
    const pick = {
      timestamp_iso: String(row[idx.timestamp_iso] || ""),
      pick_number: Number(row[idx.pick_number] || 0),
      player_id: String(row[idx.player_id] || "").trim(),
      player_name: String(row[idx.player_name] || "").trim(),
      sport: String(row[idx.sport] || "").trim(),
      country: String(row[idx.country] || "").trim(),
      pair_id: String(row[idx.pair_id] || "").trim(),
      status,
      reason: String(row[idx.reason] || "").trim()
    };
    if (!pick.player_id || !pick.pair_id) continue;
    rows.push(pick);
    if (status === "OK") {
      takenPairIds[pick.pair_id] = true;
      playerSportTaken[`${pick.player_id}||${pick.sport}`] = true;
    }
  }
  rows.sort((a, b) => a.pick_number - b.pick_number);
  return { rows, takenPairIds, playerSportTaken };
}

function appendPick_(ss, pick) {
  const sh = ss.getSheetByName(SHEET_PICKS);
  sh.appendRow([
    pick.timestamp_iso,
    pick.pick_number,
    pick.player_id,
    pick.player_name,
    pick.sport,
    pick.country,
    pick.pair_id,
    pick.status,
    pick.reason
  ]);
}

/* -------------------- Utilities -------------------- */

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try { return JSON.parse(e.postData.contents); } catch (_) { return {}; }
}

function json_(obj, code) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function indexMap_(headers) {
  const map = {};
  for (let i = 0; i < headers.length; i++) map[String(headers[i]).trim()] = i;
  return map;
}
function num_(v) {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
function round1_(v) {
  return Math.round(Number(v) * 10) / 10;
}
