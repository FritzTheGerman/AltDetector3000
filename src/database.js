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

    CREATE TABLE IF NOT EXISTS sync_meta (
      sync_name TEXT PRIMARY KEY,
      last_synced_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS command_logs (
      id SERIAL PRIMARY KEY,
      command_name TEXT,
      user_id TEXT,
      username TEXT,
      guild_id TEXT,
      channel_id TEXT,
      options_json TEXT,
      status TEXT,
      error_message TEXT,
      ran_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

module.exports = { pool, setupDatabase };
