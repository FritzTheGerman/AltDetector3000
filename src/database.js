const { Pool } = require("pg");
const { DATABASE_URL } = require("./config");

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function setupDatabase() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS discord_users (
      discord_id TEXT PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      created_at TIMESTAMPTZ,
      joined_at TIMESTAMPTZ,
      left_at TIMESTAMPTZ,
      flags TEXT DEFAULT '',
      last_alerted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS roblox_users (
      roblox_id TEXT PRIMARY KEY,
      username TEXT,
      display_name TEXT,
      roblox_created_at TIMESTAMPTZ,
      first_seen TIMESTAMPTZ,
      last_seen TIMESTAMPTZ,
      flags TEXT DEFAULT '',
      last_alerted_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS linked_accounts (
      discord_id TEXT,
      roblox_id TEXT,
      roblox_username TEXT,
      PRIMARY KEY(discord_id, roblox_id)
    );
  `);
}

module.exports = { pool, setupDatabase };
