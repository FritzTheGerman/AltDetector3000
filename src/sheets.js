const { google } = require("googleapis");
const { pool } = require("./database");

const GOOGLE_SHEET_ID = process.env.GOOGLE_SHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n");
const SYNC_GOOGLE_SHEETS = process.env.SYNC_GOOGLE_SHEETS === "true";

async function getSheetsClient() {
  const auth = new google.auth.JWT({
    email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: GOOGLE_PRIVATE_KEY,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"]
  });

  return google.sheets({ version: "v4", auth });
}

async function getLastSheetsSyncTime() {
  const result = await pool.query(
    `SELECT last_synced_at FROM sync_meta WHERE sync_name = 'google_sheets'`
  );

  return result.rows[0]?.last_synced_at || null;
}

async function setLastSheetsSyncTime(time) {
  await pool.query(
    `
    INSERT INTO sync_meta (sync_name, last_synced_at)
    VALUES ('google_sheets', $1)
    ON CONFLICT (sync_name) DO UPDATE SET
      last_synced_at = EXCLUDED.last_synced_at
    `,
    [time]
  );
}

async function writeTableToSheet(sheets, tableName, columns) {
  const result = await pool.query(
    `SELECT ${columns.join(", ")} FROM ${tableName} ORDER BY 1`
  );

  const values = [
    columns,
    ...result.rows.map(row =>
      columns.map(col => {
        const value = row[col];
        if (value instanceof Date) return value.toISOString();
        if (value === null || value === undefined) return "";
        return String(value);
      })
    )
  ];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tableName}!A:Z`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `${tableName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values }
  });

  return result.rows.length;
}

async function getSyncStats(previousSync) {
  const discordTotal = Number((await pool.query(`SELECT COUNT(*) FROM discord_users`)).rows[0].count);
  const robloxTotal = Number((await pool.query(`SELECT COUNT(*) FROM roblox_users`)).rows[0].count);
  const linkedTotal = Number((await pool.query(`SELECT COUNT(*) FROM linked_accounts`)).rows[0].count);
  const commandTotal = Number((await pool.query(`SELECT COUNT(*) FROM command_logs`)).rows[0].count);

  const discordToday = Number((await pool.query(
    `SELECT COUNT(*) FROM discord_users WHERE joined_at >= NOW() - INTERVAL '24 hours'`
  )).rows[0].count);

  const robloxToday = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE first_seen >= NOW() - INTERVAL '24 hours'`
  )).rows[0].count);

  const commandsToday = Number((await pool.query(
    `SELECT COUNT(*) FROM command_logs WHERE ran_at >= NOW() - INTERVAL '24 hours'`
  )).rows[0].count);

  const flaggedDiscord = Number((await pool.query(
    `SELECT COUNT(*) FROM discord_users WHERE flags IS NOT NULL AND flags != ''`
  )).rows[0].count);

  const flaggedRoblox = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE flags IS NOT NULL AND flags != ''`
  )).rows[0].count);

  const robloxUnder30Days = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE roblox_created_at >= NOW() - INTERVAL '30 days'`
  )).rows[0].count);

  const robloxUnder1Year = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE roblox_created_at >= NOW() - INTERVAL '365 days'`
  )).rows[0].count);

  const unlinkedRoblox = Number((await pool.query(
    `
    SELECT COUNT(*)
    FROM roblox_users r
    LEFT JOIN linked_accounts l ON r.roblox_id = l.roblox_id
    WHERE l.roblox_id IS NULL
    `
  )).rows[0].count);

  let discordNew = discordTotal;
  let robloxNew = robloxTotal;
  let commandNew = commandTotal;
  let discordUpdated = discordTotal;
  let robloxUpdated = robloxTotal;

  if (previousSync) {
    discordNew = Number((await pool.query(
      `SELECT COUNT(*) FROM discord_users WHERE joined_at > $1`,
      [previousSync]
    )).rows[0].count);

    robloxNew = Number((await pool.query(
      `SELECT COUNT(*) FROM roblox_users WHERE first_seen > $1`,
      [previousSync]
    )).rows[0].count);

    commandNew = Number((await pool.query(
      `SELECT COUNT(*) FROM command_logs WHERE ran_at > $1`,
      [previousSync]
    )).rows[0].count);

    discordUpdated = Number((await pool.query(
      `SELECT COUNT(*) FROM discord_users WHERE joined_at > $1 OR left_at > $1 OR last_alerted_at > $1`,
      [previousSync]
    )).rows[0].count);

    robloxUpdated = Number((await pool.query(
      `SELECT COUNT(*) FROM roblox_users WHERE first_seen > $1 OR last_seen > $1 OR last_alerted_at > $1`,
      [previousSync]
    )).rows[0].count);
  }

  return {
    discordTotal,
    robloxTotal,
    linkedTotal,
    commandTotal,
    discordToday,
    robloxToday,
    commandsToday,
    flaggedDiscord,
    flaggedRoblox,
    robloxUnder30Days,
    robloxUnder1Year,
    unlinkedRoblox,
    discordNew,
    robloxNew,
    commandNew,
    discordUpdated,
    robloxUpdated
  };
}

async function getDashboardData() {
  const recentCommands = (await pool.query(`
    SELECT command_name, username, status, ran_at
    FROM command_logs
    ORDER BY ran_at DESC
    LIMIT 10
  `)).rows;

  const recentRoblox = (await pool.query(`
    SELECT username, roblox_id, roblox_created_at, first_seen, last_seen
    FROM roblox_users
    ORDER BY last_seen DESC NULLS LAST
    LIMIT 10
  `)).rows;

  const recentDiscord = (await pool.query(`
    SELECT username, display_name, discord_id, created_at, joined_at
    FROM discord_users
    ORDER BY joined_at DESC NULLS LAST
    LIMIT 10
  `)).rows;

  const flaggedDiscordUsers = (await pool.query(`
    SELECT username, display_name, discord_id, flags
    FROM discord_users
    WHERE flags IS NOT NULL AND flags != ''
    ORDER BY joined_at DESC NULLS LAST
    LIMIT 10
  `)).rows;

  const flaggedRobloxUsers = (await pool.query(`
    SELECT username, roblox_id, flags
    FROM roblox_users
    WHERE flags IS NOT NULL AND flags != ''
    ORDER BY last_seen DESC NULLS LAST
    LIMIT 10
  `)).rows;

  const mostUsedCommands = (await pool.query(`
    SELECT command_name, COUNT(*) AS uses
    FROM command_logs
    GROUP BY command_name
    ORDER BY uses DESC
    LIMIT 10
  `)).rows;

  const topStaff = (await pool.query(`
    SELECT username, COUNT(*) AS commands
    FROM command_logs
    GROUP BY username
    ORDER BY commands DESC
    LIMIT 10
  `)).rows;

  let onlinePlayers = [];
  let lockedPlayers = [];

  try {
    const erlc = require("./erlc");
    onlinePlayers = await erlc.fetchERLCPlayers().catch(() => []);
    lockedPlayers = erlc.getLockedPlayers();
  } catch (error) {
    console.log("Dashboard ER:LC data skipped:", error.message);
  }

  return {
    recentCommands,
    recentRoblox,
    recentDiscord,
    flaggedDiscordUsers,
    flaggedRobloxUsers,
    mostUsedCommands,
    topStaff,
    onlinePlayers,
    lockedPlayers
  };
}

function fmt(value) {
  if (value instanceof Date) return value.toISOString();
  if (value === null || value === undefined) return "";
  return String(value);
}

function makeDashboardValues(stats, dashboardData, currentSync) {
  const rows = [];

  rows.push(["AltDetector3000 Dashboard", "", "", "", "", "", "", "", "", ""]);
  rows.push(["Last Sync", currentSync.toISOString(), "", "", "", "", "", "", "", ""]);
  rows.push(["", "", "", "", "", "", "", "", "", ""]);

  rows.push(["MAIN STATS", "", "", "RECENT COMMANDS", "", "", "RISK STATS", "", "", ""]);
  rows.push(["Metric", "Value", "", "Command", "User", "Status", "Metric", "Value", "", ""]);

  rows.push(["Discord Users", stats.discordTotal, "", "", "", "", "Flagged Discord Users", stats.flaggedDiscord, "", ""]);
  rows.push(["Roblox Users", stats.robloxTotal, "", "", "", "", "Flagged Roblox Users", stats.flaggedRoblox, "", ""]);
  rows.push(["Linked Accounts", stats.linkedTotal, "", "", "", "", "Roblox Under 30 Days", stats.robloxUnder30Days, "", ""]);
  rows.push(["Commands Logged", stats.commandTotal, "", "", "", "", "Roblox Under 1 Year", stats.robloxUnder1Year, "", ""]);
  rows.push(["New Discord Today", stats.discordToday, "", "", "", "", "Unlinked Roblox Users", stats.unlinkedRoblox, "", ""]);
  rows.push(["New Roblox Today", stats.robloxToday, "", "", "", "", "Active Locked Players", dashboardData.lockedPlayers.length, "", ""]);
  rows.push(["Commands Today", stats.commandsToday, "", "", "", "", "ER:LC Players Online", dashboardData.onlinePlayers.length, "", ""]);

  for (let i = 0; i < 7; i++) {
    const cmd = dashboardData.recentCommands[i];
    rows[5 + i][3] = cmd?.command_name || "";
    rows[5 + i][4] = cmd?.username || "";
    rows[5 + i][5] = cmd?.status || "";
  }

  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["RECENT ROBLOX PLAYERS", "", "", "RECENT DISCORD JOINS", "", "", "MOST USED COMMANDS", "", "", ""]);
  rows.push(["Username", "Roblox ID", "Last Seen", "Username", "Discord ID", "Joined At", "Command", "Uses", "", ""]);

  for (let i = 0; i < 10; i++) {
    const rbx = dashboardData.recentRoblox[i];
    const dis = dashboardData.recentDiscord[i];
    const cmd = dashboardData.mostUsedCommands[i];

    rows.push([
      rbx?.username || "",
      rbx?.roblox_id || "",
      fmt(rbx?.last_seen),
      dis?.username || "",
      dis?.discord_id || "",
      fmt(dis?.joined_at),
      cmd?.command_name || "",
      cmd?.uses || "",
      "",
      ""
    ]);
  }

  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["FLAGGED ROBLOX USERS", "", "", "FLAGGED DISCORD USERS", "", "", "TOP STAFF COMMAND USERS", "", "", ""]);
  rows.push(["Username", "Roblox ID", "Flags", "Username", "Discord ID", "Flags", "Staff", "Commands", "", ""]);

  for (let i = 0; i < 10; i++) {
    const rbx = dashboardData.flaggedRobloxUsers[i];
    const dis = dashboardData.flaggedDiscordUsers[i];
    const staff = dashboardData.topStaff[i];

    rows.push([
      rbx?.username || "",
      rbx?.roblox_id || "",
      rbx?.flags || "",
      dis?.username || "",
      dis?.discord_id || "",
      dis?.flags || "",
      staff?.username || "",
      staff?.commands || "",
      "",
      ""
    ]);
  }

  rows.push(["", "", "", "", "", "", "", "", "", ""]);
  rows.push(["CURRENT LOCKED PLAYERS", "", "", "ER:LC PLAYERS ONLINE", "", "", "", "", "", ""]);
  rows.push(["Username", "Refresh Seconds", "Minutes Left", "Raw Player Data", "", "", "", "", "", ""]);

  const maxLockRows = Math.max(dashboardData.lockedPlayers.length, dashboardData.onlinePlayers.length, 1);

  for (let i = 0; i < maxLockRows; i++) {
    const lock = dashboardData.lockedPlayers[i];
    const online = dashboardData.onlinePlayers[i];

    rows.push([
      lock?.username || "",
      lock?.refreshSeconds || "",
      lock?.remainingMinutes || "",
      online ? JSON.stringify(online) : "",
      "",
      "",
      "",
      "",
      "",
      ""
    ]);
  }

  return rows;
}

async function getSheetIdByTitle(sheets, title) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId: GOOGLE_SHEET_ID
  });

  const sheet = response.data.sheets.find(s => s.properties.title === title);
  if (!sheet) throw new Error(`Missing sheet tab: ${title}`);

  return sheet.properties.sheetId;
}

async function updateDashboard(sheets, stats, currentSync) {
  const dashboardData = await getDashboardData();
  const values = makeDashboardValues(stats, dashboardData, currentSync);

  await sheets.spreadsheets.values.clear({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `dashboard!A:Z`
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: GOOGLE_SHEET_ID,
    range: `dashboard!A1`,
    valueInputOption: "RAW",
    requestBody: { values }
  });

  const dashboardSheetId = await getSheetIdByTitle(sheets, "dashboard");

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: GOOGLE_SHEET_ID,
    requestBody: {
      requests: [
        {
          autoResizeDimensions: {
            dimensions: {
              sheetId: dashboardSheetId,
              dimension: "COLUMNS",
              startIndex: 0,
              endIndex: 10
            }
          }
        },
        {
          updateSheetProperties: {
            properties: {
              sheetId: dashboardSheetId,
              gridProperties: { frozenRowCount: 1 }
            },
            fields: "gridProperties.frozenRowCount"
          }
        }
      ]
    }
  });
}

async function syncDatabaseToGoogleSheets() {
  if (!SYNC_GOOGLE_SHEETS) {
    return {
      ok: false,
      skipped: true,
      message: "Google Sheets sync is disabled. Set SYNC_GOOGLE_SHEETS=true."
    };
  }

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    return {
      ok: false,
      skipped: true,
      message: "Google Sheets sync skipped: missing env variables."
    };
  }

  const previousSync = await getLastSheetsSyncTime();
  const currentSync = new Date();
  const sheets = await getSheetsClient();

  const discordRows = await writeTableToSheet(sheets, "discord_users", [
    "discord_id",
    "username",
    "display_name",
    "created_at",
    "joined_at",
    "left_at",
    "flags",
    "last_alerted_at"
  ]);

  const robloxRows = await writeTableToSheet(sheets, "roblox_users", [
    "roblox_id",
    "username",
    "display_name",
    "roblox_created_at",
    "first_seen",
    "last_seen",
    "flags",
    "last_alerted_at"
  ]);

  const linkedRows = await writeTableToSheet(sheets, "linked_accounts", [
    "discord_id",
    "roblox_id",
    "roblox_username"
  ]);

  const commandRows = await writeTableToSheet(sheets, "command_logs", [
    "id",
    "command_name",
    "user_id",
    "username",
    "guild_id",
    "channel_id",
    "options_json",
    "status",
    "error_message",
    "ran_at"
  ]);

  const stats = await getSyncStats(previousSync);

  await updateDashboard(sheets, stats, currentSync);
  await setLastSheetsSyncTime(currentSync);

  console.log("Google Sheets sync complete.");

  return {
    ok: true,
    previousSync,
    currentSync,
    rows: {
      discordRows,
      robloxRows,
      linkedRows,
      commandRows
    },
    stats
  };
}

module.exports = {
  syncDatabaseToGoogleSheets,
  getLastSheetsSyncTime
};
