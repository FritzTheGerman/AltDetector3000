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

  if (!previousSync) {
    return {
      discordTotal,
      robloxTotal,
      linkedTotal,
      commandTotal,
      discordNew: discordTotal,
      robloxNew: robloxTotal,
      commandNew: commandTotal,
      discordUpdated: discordTotal,
      robloxUpdated: robloxTotal
    };
  }

  const discordNew = Number((await pool.query(
    `SELECT COUNT(*) FROM discord_users WHERE joined_at > $1`,
    [previousSync]
  )).rows[0].count);

  const robloxNew = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE first_seen > $1`,
    [previousSync]
  )).rows[0].count);

  const commandNew = Number((await pool.query(
    `SELECT COUNT(*) FROM command_logs WHERE ran_at > $1`,
    [previousSync]
  )).rows[0].count);

  const discordUpdated = Number((await pool.query(
    `SELECT COUNT(*) FROM discord_users WHERE joined_at > $1 OR left_at > $1 OR last_alerted_at > $1`,
    [previousSync]
  )).rows[0].count);

  const robloxUpdated = Number((await pool.query(
    `SELECT COUNT(*) FROM roblox_users WHERE first_seen > $1 OR last_seen > $1 OR last_alerted_at > $1`,
    [previousSync]
  )).rows[0].count);

  return {
    discordTotal,
    robloxTotal,
    linkedTotal,
    commandTotal,
    discordNew,
    robloxNew,
    commandNew,
    discordUpdated,
    robloxUpdated
  };
}

async function updateDashboard(sheets, stats, currentSync) {
  const values = [
    ["Metric", "Value"],
    ["Discord Users", stats.discordTotal],
    ["Roblox Users", stats.robloxTotal],
    ["Linked Accounts", stats.linkedTotal],
    ["Commands Logged", stats.commandTotal],
    ["New Discord Users Since Last Sync", stats.discordNew],
    ["New Roblox Users Since Last Sync", stats.robloxNew],
    ["New Commands Since Last Sync", stats.commandNew],
    ["Updated Discord Users Since Last Sync", stats.discordUpdated],
    ["Updated Roblox Users Since Last Sync", stats.robloxUpdated],
    ["Last Sync", currentSync.toISOString()]
  ];

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
