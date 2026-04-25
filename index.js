require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType
} = require("discord.js");

const axios = require("axios");
const { Pool } = require("pg");

const BOT_NAME = "AltDetector3000";
const BOT_COLOR = 0xff0000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY;
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID || "0";
const DATABASE_URL = process.env.DATABASE_URL;

const STAFF_ALERT_USER_IDS = (process.env.STAFF_ALERT_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const ERLC_BASE_URL = "https://api.policeroleplay.community/v1";

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

function isAlertStaff(userId) {
  return STAFF_ALERT_USER_IDS.includes(String(userId));
}

function nowISO() {
  return new Date().toISOString();
}

function daysOld(date) {
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function similarity(a = "", b = "") {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();

  if (!a || !b) return 0;

  let matches = 0;
  const len = Math.min(a.length, b.length);

  for (let i = 0; i < len; i++) {
    if (a[i] === b[i]) matches++;
  }

  return matches / Math.max(a.length, b.length);
}

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

async function sendStaffAlert(title, description) {
  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} Alert`)
    .setDescription(`**${title}**\n\n${description}`)
    .setColor(BOT_COLOR)
    .setTimestamp()
    .setFooter({ text: "AltDetector3000 • ER:LC + Discord Monitoring" });

  if (STAFF_LOG_CHANNEL_ID && STAFF_LOG_CHANNEL_ID !== "0") {
    const channel = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
  }

  for (const id of STAFF_ALERT_USER_IDS) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) await user.send({ embeds: [embed] }).catch(() => {});
  }
}

async function sendAlertToOneUser(userId, title, description) {
  const user = await client.users.fetch(userId).catch(() => null);

  if (!user) {
    return false;
  }

  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} Alert`)
    .setDescription(`**${title}**\n\n${description}`)
    .setColor(BOT_COLOR)
    .setTimestamp()
    .setFooter({ text: "AltDetector3000 • Direct Test Alert" });

  await user.send({ embeds: [embed] }).catch(() => null);
  return true;
}

async function getRobloxUserInfo(robloxId) {
  try {
    const response = await axios.get(`https://users.roblox.com/v1/users/${robloxId}`);
    return response.data;
  } catch {
    return null;
  }
}

async function discordRisk(member) {
  let score = 0;
  const reasons = [];

  const accountAge = daysOld(member.user.createdAt);

  if (accountAge <= 7) {
    score += 35;
    reasons.push("Discord account is under 7 days old");
  } else if (accountAge <= 30) {
    score += 20;
    reasons.push("Discord account is under 30 days old");
  }

  const oldUsers = await pool.query(
    `SELECT username, display_name FROM discord_users WHERE discord_id != $1`,
    [member.id]
  );

  for (const old of oldUsers.rows) {
    const nameMatch = Math.max(
      similarity(member.user.username, old.username),
      similarity(member.displayName, old.display_name)
    );

    if (nameMatch >= 0.85) {
      score += 20;
      reasons.push(`Similar name to previous member: ${old.username}`);
      break;
    }
  }

  return { score, reasons };
}

async function robloxRisk(player, robloxInfo) {
  let score = 0;
  const reasons = [];

  const username = String(player.Player || "Unknown");
  const robloxId = String(player.RobloxId || "");

  if (robloxInfo?.created) {
    const robloxAge = daysOld(robloxInfo.created);

    if (robloxAge <= 7) {
      score += 40;
      reasons.push("Roblox account is under 7 days old");
    } else if (robloxAge <= 30) {
      score += 25;
      reasons.push("Roblox account is under 30 days old");
    }
  }

  const oldUsers = await pool.query(
    `SELECT username FROM roblox_users WHERE roblox_id != $1`,
    [robloxId]
  );

  for (const old of oldUsers.rows) {
    if (similarity(username, old.username) >= 0.85) {
      score += 20;
      reasons.push(`Similar Roblox username to previous player: ${old.username}`);
      break;
    }
  }

  const linked = await pool.query(
    `SELECT discord_id FROM linked_accounts WHERE roblox_id = $1`,
    [robloxId]
  );

  if (linked.rows.length === 0) {
    score += 15;
    reasons.push("Roblox account is not linked to a Discord member");
  }

  return { score, reasons };
}

async function fetchERLCPlayers() {
  if (!ERLC_SERVER_KEY) return [];

  try {
    const response = await axios.get(`${ERLC_BASE_URL}/server/players`, {
      headers: {
        "Server-Key": ERLC_SERVER_KEY
      }
    });

    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.log("ERLC API error:", error.response?.status || error.message);
    return [];
  }
}

async function trackERLCPlayers() {
  const players = await fetchERLCPlayers();

  for (const player of players) {
    const username = String(player.Player || "Unknown");
    const robloxId = String(player.RobloxId || "");

    if (!robloxId || robloxId === "undefined") continue;

    const robloxInfo = await getRobloxUserInfo(robloxId);

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
        nowISO(),
        nowISO()
      ]
    );

    const { score, reasons } = await robloxRisk(player, robloxInfo);

    const existing = await pool.query(
      `SELECT last_alerted_at FROM roblox_users WHERE roblox_id = $1`,
      [robloxId]
    );

    const lastAlerted = existing.rows[0]?.last_alerted_at;
    const canAlertAgain = !lastAlerted || daysOld(lastAlerted) >= 1;

    if (score >= 45 && canAlertAgain) {
      await sendStaffAlert(
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
    }
  }
}

client.once("ready", async () => {
  await setupDatabase();

  console.log(`${BOT_NAME} logged in as ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      {
        name: "ER:LC + Discord for alts",
        type: ActivityType.Watching
      }
    ],
    status: "online"
  });

  trackERLCPlayers();
  setInterval(trackERLCPlayers, 60000);
});

client.on("guildMemberAdd", async member => {
  const { score, reasons } = await discordRisk(member);

  await pool.query(
    `
    INSERT INTO discord_users
    (discord_id, username, display_name, created_at, joined_at, left_at, flags)
    VALUES ($1, $2, $3, $4, $5, NULL, '')
    ON CONFLICT (discord_id) DO UPDATE SET
      username = EXCLUDED.username,
      display_name = EXCLUDED.display_name,
      joined_at = EXCLUDED.joined_at,
      left_at = NULL
    `,
    [
      member.id,
      member.user.username,
      member.displayName,
      member.user.createdAt.toISOString(),
      nowISO()
    ]
  );

  if (score >= 40) {
    await sendStaffAlert(
      "Suspected Discord Alt Detected",
      `
User: ${member}
Discord ID: \`${member.id}\`
Username: \`${member.user.username}\`
Display Name: \`${member.displayName}\`
Account Created: \`${member.user.createdAt.toISOString()}\`

Risk Score: \`${score}\`

Reasons:
${reasons.map(r => `- ${r}`).join("\n") || "- No listed reasons"}

Recommended Action:
Manual review.
`
    );

    await pool.query(
      `UPDATE discord_users SET last_alerted_at = $1 WHERE discord_id = $2`,
      [nowISO(), member.id]
    );
  }
});

client.on("guildMemberRemove", async member => {
  await pool.query(
    `UPDATE discord_users SET left_at = $1 WHERE discord_id = $2`,
    [nowISO(), member.id]
  );
});

client.on("messageCreate", async message => {
  if (message.author.bot || !message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  const allowed = isAlertStaff(message.author.id);

  if (!allowed) {
    return message.reply("You are not authorized to use AltDetector3000 commands.");
  }

  if (command === "ping") {
    return message.reply(`🏓 ${BOT_NAME} online. Ping: \`${client.ws.ping}ms\``);
  }

  if (command === "help") {
    return message.reply(`
**${BOT_NAME} Commands**

\`!ping\` - Check if the bot is online
\`!help\` - Show this command list
\`!testalert\` - DM all staff a test alert
\`!testalert @user\` - DM one specific user a test alert
\`!alerts list\` - Show who receives alerts
\`!altcheck @user\` - Check a Discord member
\`!robloxcheck ROBLOX_USER_ID\` - Check Roblox history
\`!link @user ROBLOX_USER_ID ROBLOX_USERNAME\` - Link Discord to Roblox
\`!flagdiscord @user reason\` - Add a flag to Discord user
\`!flagroblox ROBLOX_USER_ID reason\` - Add a flag to Roblox user
`);
  }

  if (command === "testalert") {
    const target = message.mentions.users.first();

    if (target) {
      const sent = await sendAlertToOneUser(
        target.id,
        "Single User Test Alert",
        `
This is a direct test alert from AltDetector3000.

Triggered by: ${message.author}
Sent to: ${target}
Time: ${new Date().toISOString()}

If this DM was received, direct test alerts are working.
`
      );

      if (!sent) {
        return message.reply("❌ Could not send the test alert to that user.");
      }

      return message.reply(`✅ Test alert sent to ${target}.`);
    }

    await sendStaffAlert(
      "Staff Test Alert",
      `
This is a test alert from AltDetector3000.

Triggered by: ${message.author}
Time: ${new Date().toISOString()}

If you see this, staff DM alerts are working correctly.
`
    );

    return message.reply("✅ Test alert sent to all staff.");
  }

  if (command === "alerts") {
    const subcommand = args[0]?.toLowerCase();

    if (subcommand !== "list") {
      return message.reply("Use: `!alerts list`");
    }

    if (STAFF_ALERT_USER_IDS.length === 0) {
      return message.reply("No staff alert users are set in `STAFF_ALERT_USER_IDS`.");
    }

    const lines = [];

    for (const id of STAFF_ALERT_USER_IDS) {
      const user = await client.users.fetch(id).catch(() => null);

      if (user) {
        lines.push(`- ${user.tag} / \`${id}\``);
      } else {
        lines.push(`- Unknown User / \`${id}\``);
      }
    }

    return message.reply(`
**AltDetector3000 Alert Staff**

${lines.join("\n")}
`);
  }

  if (command === "altcheck") {
    const target = message.mentions.members.first();
    if (!target) return message.reply("Use: `!altcheck @user`");

    const { score, reasons } = await discordRisk(target);

    return message.reply(`
**Alt Check for ${target}**

Risk Score: \`${score}\`

Reasons:
${reasons.length ? reasons.map(r => `- ${r}`).join("\n") : "- No major risk found"}
`);
  }

  if (command === "robloxcheck") {
    const robloxId = args[0];
    if (!robloxId) return message.reply("Use: `!robloxcheck ROBLOX_USER_ID`");

    const robloxInfo = await getRobloxUserInfo(robloxId);

    const row = await pool.query(
      `
      SELECT username, display_name, roblox_created_at, first_seen, last_seen, flags
      FROM roblox_users
      WHERE roblox_id = $1
      `,
      [robloxId]
    );

    if (row.rows.length === 0 && !robloxInfo) {
      return message.reply("No Roblox history found and Roblox API lookup failed.");
    }

    const dbUser = row.rows[0];

    return message.reply(`
**Roblox Check**

Username: \`${dbUser?.username || robloxInfo?.name || "Unknown"}\`
Display Name: \`${dbUser?.display_name || robloxInfo?.displayName || "Unknown"}\`
Roblox UserId: \`${robloxId}\`
Roblox Created: \`${dbUser?.roblox_created_at || robloxInfo?.created || "Unknown"}\`
Roblox Age: \`${robloxInfo?.created ? daysOld(robloxInfo.created) + " days" : "Unknown"}\`
First Seen In ER:LC: \`${dbUser?.first_seen || "Not seen yet"}\`
Last Seen In ER:LC: \`${dbUser?.last_seen || "Not seen yet"}\`
Flags: \`${dbUser?.flags || "None"}\`
`);
  }

  if (command === "link") {
    const target = message.mentions.members.first();
    const robloxId = args[1];
    const robloxUsername = args[2];

    if (!target || !robloxId || !robloxUsername) {
      return message.reply("Use: `!link @user ROBLOX_USER_ID ROBLOX_USERNAME`");
    }

    await pool.query(
      `
      INSERT INTO linked_accounts
      (discord_id, roblox_id, roblox_username)
      VALUES ($1, $2, $3)
      ON CONFLICT (discord_id, roblox_id) DO UPDATE SET
        roblox_username = EXCLUDED.roblox_username
      `,
      [target.id, robloxId, robloxUsername]
    );

    return message.reply(`Linked ${target} to Roblox \`${robloxUsername}\` / \`${robloxId}\`.`);
  }

  if (command === "flagdiscord") {
    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");

    if (!target || !reason) {
      return message.reply("Use: `!flagdiscord @user reason`");
    }

    await pool.query(
      `
      INSERT INTO discord_users
      (discord_id, username, display_name, created_at, joined_at, left_at, flags)
      VALUES ($1, $2, $3, $4, $5, NULL, '')
      ON CONFLICT (discord_id) DO NOTHING
      `,
      [
        target.id,
        target.user.username,
        target.displayName,
        target.user.createdAt.toISOString(),
        nowISO()
      ]
    );

    await pool.query(
      `
      UPDATE discord_users
      SET flags = COALESCE(flags, '') || $1
      WHERE discord_id = $2
      `,
      [`\n${reason}`, target.id]
    );

    return message.reply(`Flagged ${target}: \`${reason}\``);
  }

  if (command === "flagroblox") {
    const robloxId = args[0];
    const reason = args.slice(1).join(" ");

    if (!robloxId || !reason) {
      return message.reply("Use: `!flagroblox ROBLOX_USER_ID reason`");
    }

    const robloxInfo = await getRobloxUserInfo(robloxId);

    await pool.query(
      `
      INSERT INTO roblox_users
      (roblox_id, username, display_name, roblox_created_at, first_seen, last_seen, flags)
      VALUES ($1, $2, $3, $4, $5, $6, '')
      ON CONFLICT (roblox_id) DO NOTHING
      `,
      [
        robloxId,
        robloxInfo?.name || "Unknown",
        robloxInfo?.displayName || null,
        robloxInfo?.created || null,
        nowISO(),
        nowISO()
      ]
    );

    await pool.query(
      `
      UPDATE roblox_users
      SET flags = COALESCE(flags, '') || $1
      WHERE roblox_id = $2
      `,
      [`\n${reason}`, robloxId]
    );

    return message.reply(`Flagged Roblox \`${robloxId}\`: \`${reason}\``);
  }
});

client.login(DISCORD_TOKEN);
