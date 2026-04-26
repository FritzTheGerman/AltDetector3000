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
}

async function syncDatabaseToGoogleSheets() {
  if (!SYNC_GOOGLE_SHEETS) return;

  if (!GOOGLE_SHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
    console.log("Google Sheets sync skipped: missing env variables.");
    return;
  }

  try {
    const sheets = await getSheetsClient();

    await writeTableToSheet(sheets, "discord_users", [
      "discord_id",
      "username",
      "display_name",
      "created_at",
      "joined_at",
      "left_at",
      "flags",
      "last_alerted_at"
    ]);

    await writeTableToSheet(sheets, "roblox_users", [
      "roblox_id",
      "username",
      "display_name",
      "roblox_created_at",
      "first_seen",
      "last_seen",
      "flags",
      "last_alerted_at"
    ]);

    await writeTableToSheet(sheets, "linked_accounts", [
      "discord_id",
      "roblox_id",
      "roblox_username"
    ]);

    console.log("Google Sheets sync complete.");
  } catch (error) {
    console.log("Google Sheets sync failed:", error.message);
  }
}

module.exports = { syncDatabaseToGoogleSheets };
