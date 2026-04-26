const axios = require("axios");
const { pool } = require("./database");
const {
  ERLC_SERVER_KEY,
  ERLC_BASE_URL,
  ERLC_V2_BASE_URL
} = require("./config");
const { sendStaffAlert } = require("./alerts");
const { robloxRisk } = require("./risk");
const { syncDatabaseToGoogleSheets } = require("./sheets");

const lockedPlayers = new Map();

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function nowISO() {
  return new Date().toISOString();
}

function daysOld(date) {
  if (!date) return 9999;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function formatRemainingTime(expiresAt) {
  const remainingMs = Math.max(0, expiresAt - Date.now());
  const remainingMinutes = Math.ceil(remainingMs / 60000);
  return `${remainingMinutes} minute(s)`;
}

function lockPlayer(username, refreshSeconds, durationMinutes, lockedBy = "Staff") {
  const key = String(username).toLowerCase();

  const intervalMs = Math.max(3000, refreshSeconds * 1000);
  const durationMs = Math.max(60000, durationMinutes * 60000);
  const expiresAt = Date.now() + durationMs;

  if (lockedPlayers.has(key)) {
    clearInterval(lockedPlayers.get(key).interval);
  }

  async function runCycle() {
    const timeRemaining = formatRemainingTime(expiresAt);

    await runERLCCommand(`:jail ${username}`).catch(() => {});
    await sleep(1200);

    await runERLCCommand(
      `:pm ${username} "You have been locked by ${lockedBy}. You will be unlocked in ${timeRemaining}."`
    ).catch(() => {});
  }

  runCycle();

  const interval = setInterval(async () => {
    if (!lockedPlayers.has(key)) {
      clearInterval(interval);
      return;
    }

    if (Date.now() >= expiresAt) {
      clearInterval(interval);
      lockedPlayers.delete(key);

      await runERLCCommand(`:unjail ${username}`).catch(() => {});
      await sleep(1200);
      await runERLCCommand(`:pm ${username} "You have been unlocked."`).catch(() => {});
      return;
    }

    await runCycle();
  }, intervalMs);

  lockedPlayers.set(key, {
    username,
    refreshSeconds,
    durationMinutes,
    lockedBy,
    expiresAt,
    interval
  });
}

function unlockPlayer(username) {
  const key = String(username).toLowerCase();

  if (lockedPlayers.has(key)) {
    clearInterval(lockedPlayers.get(key).interval);
    lockedPlayers.delete(key);
    return true;
  }

  return false;
}

function getLockedPlayers() {
  return Array.from(lockedPlayers.values()).map(lock => ({
    username: lock.username,
    refreshSeconds: lock.refreshSeconds,
    durationMinutes: lock.durationMinutes,
    lockedBy: lock.lockedBy,
    remainingMinutes: Math.max(0, Math.ceil((lock.expiresAt - Date.now()) / 60000))
  }));
}

function startRefreshLoop() {
  console.log("Lock jail system ready.");
}

function parseERLCPlayer(player) {
  const rawPlayer = String(player.Player || "");
  const split = rawPlayer.split(":");

  const username =
    player.Username ||
    player.PlayerName ||
    player.Name ||
    split[0] ||
    "Unknown";

  const robloxId =
    player.RobloxId ||
    player.RobloxID ||
    player.UserId ||
    player.UserID ||
    player.Id ||
    player.ID ||
    split[1] ||
    "";

  return {
    username: String(username).trim(),
    robloxId: String(robloxId).trim()
  };
}

function getServerNameFromData(data) {
  if (!data) return "Unknown";

  return (
    data.Name ||
    data.name ||
    data.ServerName ||
    data.serverName ||
    data.server_name ||
    data.Server?.Name ||
    data.server?.name ||
    "Unknown"
  );
}

function getPlayerCountFromServerData(data) {
  if (!data) return "Unknown";

  return (
    data.CurrentPlayers ||
    data.currentPlayers ||
    data.current_players ||
    data.PlayerCount ||
    data.playerCount ||
    data.players?.length ||
    data.Players?.length ||
    "Unknown"
  );
}

async function getRobloxUserInfo(robloxId) {
  try {
    const response = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
    return response.data;
  } catch {
    return null;
  }
}

async function runERLCCommand(commandText) {
  if (!ERLC_SERVER_KEY) {
    return { ok: false, status: "NO_KEY", error: "Missing ERLC_SERVER_KEY" };
  }

  try {
    const response = await axios.post(
      `${ERLC_BASE_URL}/server/command`,
      { command: commandText },
      {
        headers: {
          "Server-Key": ERLC_SERVER_KEY,
          "Content-Type": "application/json"
        }
      }
    );

    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      status: error.response?.status || "ERROR",
      error: error.response?.data || error.message
    };
  }
}

async function fetchERLCServerInfo() {
  if (!ERLC_SERVER_KEY) {
    return { ok: false, status: "NO_KEY", error: "Missing ERLC_SERVER_KEY", data: null };
  }

  try {
    const response = await axios.get(`${ERLC_V2_BASE_URL}/server?Players=true`, {
      headers: { "Server-Key": ERLC_SERVER_KEY }
    });

    return { ok: true, status: response.status, version: "v2", data: response.data };
  } catch (v2Error) {
    try {
      const response = await axios.get(`${ERLC_BASE_URL}/server`, {
        headers: { "Server-Key": ERLC_SERVER_KEY }
      });

      return { ok: true, status: response.status, version: "v1", data: response.data };
    } catch (v1Error) {
      return {
        ok: false,
        status: v1Error.response?.status || v2Error.response?.status || "ERROR",
        error: v1Error.response?.data || v2Error.response?.data || v1Error.message || v2Error.message,
        data: null
      };
    }
  }
}

async function fetchERLCPlayers() {
  if (!ERLC_SERVER_KEY) return [];

  try {
    const response = await axios.get(`${ERLC_BASE_URL}/server/players`, {
      headers: { "Server-Key": ERLC_SERVER_KEY }
    });

    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.log("ERLC API error:", error.response?.status || error.message, error.response?.data || "");
    return [];
  }
}

async function trackERLCPlayers(client) {
  let didUpdate = false;
  const players = await fetchERLCPlayers();

  for (const player of players) {
    const { username, robloxId } = parseERLCPlayer(player);

    if (!robloxId || robloxId === "undefined") {
      console.log("Skipped ERLC player, no Roblox ID found:", JSON.stringify(player));
      continue;
    }

    const robloxInfo = await getRobloxUserInfo(robloxId);

    const existing = await pool.query(
      `SELECT first_seen, last_alerted_at FROM roblox_users WHERE roblox_id = $1`,
      [robloxId]
    );

    await pool.query(
      `
      INSERT INTO roblox_users
      (roblox_id, username, display_name, roblox_created_at, first_seen, last_seen)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (roblox_id) DO UPDATE SET
        username = EXCLUDED.username,
        display_name = EXCLUDED.display_name,
        roblox_created_at = EXCLUDED.roblox_created_at,
        last_seen = EXCLUDED.last_seen
      `,
      [
        robloxId,
        username,
        robloxInfo?.displayName || null,
        robloxInfo?.created || null,
        existing.rows[0]?.first_seen || nowISO(),
        nowISO()
      ]
    );

    didUpdate = true;

    const { score, reasons } = await robloxRisk(player, robloxInfo);

    const lastAlerted = existing.rows[0]?.last_alerted_at;
    const canAlertAgain = !lastAlerted || daysOld(lastAlerted) >= 1;

    if (score >= 60 && canAlertAgain) {
      await sendStaffAlert(
        client,
        "Suspected Roblox Alt Detected",
        `
Username: \`${username}\`
Roblox UserId: \`${robloxId}\`
Roblox Created: \`${robloxInfo?.created || "Unknown"}\`

Risk Score: \`${score}\`

Reasons:
${reasons.map(r => `- ${r}`).join("\n") || "- No listed reasons"}

Recommended Action:
Manual review.
`
      );

      await pool.query(
        `UPDATE roblox_users SET last_alerted_at = $1 WHERE roblox_id = $2`,
        [nowISO(), robloxId]
      );

      didUpdate = true;
    }
  }

  if (didUpdate) {
    try {
      await syncDatabaseToGoogleSheets();
    } catch (error) {
      console.log("Auto ERLC sheet sync failed:", error.message);
    }
  }
}

module.exports = {
  parseERLCPlayer,
  getServerNameFromData,
  getPlayerCountFromServerData,
  getRobloxUserInfo,
  runERLCCommand,
  fetchERLCServerInfo,
  fetchERLCPlayers,
  trackERLCPlayers,
  lockPlayer,
  unlockPlayer,
  getLockedPlayers,
  startRefreshLoop,
  sleep,
  daysOld,
  nowISO
};
