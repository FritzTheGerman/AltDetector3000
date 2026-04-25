require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType
} = require("discord.js");

const axios = require("axios");
const Database = require("better-sqlite3");

const BOT_NAME = "AltDetector3000";
const BOT_COLOR = 0xff0000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY;
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID || "0";

const STAFF_ALERT_USER_IDS = (process.env.STAFF_ALERT_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const ERLC_BASE_URL = "https://api.policeroleplay.community/v1";

const db = new Database("alt_tracker.db");

db.exec(`
CREATE TABLE IF NOT EXISTS discord_users (
  discord_id TEXT PRIMARY KEY,
  username TEXT,
  display_name TEXT,
  created_at TEXT,
  joined_at TEXT,
  left_at TEXT,
  flags TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS roblox_users (
  roblox_id TEXT PRIMARY KEY,
  username TEXT,
  first_seen TEXT,
  last_seen TEXT,
  flags TEXT DEFAULT ''
);

CREATE TABLE IF NOT EXISTS linked_accounts (
  discord_id TEXT,
  roblox_id TEXT,
  roblox_username TEXT,
  PRIMARY KEY(discord_id, roblox_id)
);
`);

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

async function sendStaffAlert(title, description) {
  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} Alert`)
    .setDescription(`**${title}**\n\n${description}`)
    .setColor(BOT_COLOR)
    .setTimestamp()
    .setFooter({ text: "AltDetector3000 • ER:LC + Discord Monitoring" });

  if (STAFF_LOG_CHANNEL_ID && STAFF_LOG_CHANNEL_ID !== "0") {
    const channel = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
    if (channel) {
      await channel.send({ embeds: [embed] }).catch(() => {});
    }
  }

  for (const id of STAFF_ALERT_USER_IDS) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) {
      await user.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

function discordRisk(member) {
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

  const oldUsers = db.prepare(`
    SELECT username, display_name 
    FROM discord_users
    WHERE discord_id != ?
  `).all(member.id);

  for (const old of oldUsers) {
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

function robloxRisk(player) {
  let score = 0;
  const reasons = [];

  const username = String(player.Player || "Unknown");
  const robloxId = String(player.RobloxId || "");

  const oldUsers = db.prepare(`
    SELECT username 
    FROM roblox_users
    WHERE roblox_id != ?
  `).all(robloxId);

  for (const old of oldUsers) {
    if (similarity(username, old.username) >= 0.85) {
      score += 20;
      reasons.push(`Similar Roblox username to previous player: ${old.username}`);
      break;
    }
  }

  const linked = db.prepare(`
    SELECT discord_id 
    FROM linked_accounts
    WHERE roblox_id = ?
  `).get(robloxId);

  if (!linked) {
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

    const existing = db.prepare(`
      SELECT first_seen 
      FROM roblox_users 
      WHERE roblox_id = ?
    `).get(robloxId);

    db.prepare(`
      INSERT INTO roblox_users
      (roblox_id, username, first_seen, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(roblox_id) DO UPDATE SET
      username = excluded.username,
      last_seen = excluded.last_seen
    `).run(
      robloxId,
      username,
      existing?.first_seen || nowISO(),
      nowISO()
    );

    const { score, reasons } = robloxRisk(player);

    if (score >= 30) {
      await sendStaffAlert(
        "Suspected Roblox Alt Detected",
        `
Username: \`${username}\`
Roblox UserId: \`${robloxId}\`

Risk Score: \`${score}\`

Reasons:
${reasons.map(r => `- ${r}`).join("\n") || "- No listed reasons"}

Recommended Action:
Manual review.
`
      );
    }
  }
}

client.once("ready", () => {
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
  const { score, reasons } = discordRisk(member);

  db.prepare(`
    INSERT OR REPLACE INTO discord_users
    (discord_id, username, display_name, created_at, joined_at, left_at, flags)
    VALUES (?, ?, ?, ?, ?, NULL, '')
  `).run(
    member.id,
    member.user.username,
    member.displayName,
    member.user.createdAt.toISOString(),
    nowISO()
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
  }
});

client.on("guildMemberRemove", member => {
  db.prepare(`
    UPDATE discord_users
    SET left_at = ?
    WHERE discord_id = ?
  `).run(nowISO(), member.id);
});

client.on("messageCreate", async message => {
  if (message.author.bot || !message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  const allowed = isAlertStaff(message.author.id);

  if (command === "ping") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");
    return message.reply(`🏓 ${BOT_NAME} online. Ping: \`${client.ws.ping}ms\``);
  }

  if (command === "help") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    return message.reply(`
**${BOT_NAME} Commands**

\`!ping\` - Check if the bot is online
\`!help\` - Show this command list
\`!altcheck @user\` - Check a Discord member
\`!robloxcheck ROBLOX_USER_ID\` - Check Roblox history
\`!link @user ROBLOX_USER_ID ROBLOX_USERNAME\` - Link Discord to Roblox
\`!flagdiscord @user reason\` - Add a flag to Discord user
\`!flagroblox ROBLOX_USER_ID reason\` - Add a flag to Roblox user
`);
  }

  if (command === "altcheck") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    const target = message.mentions.members.first();
    if (!target) return message.reply("Use: `!altcheck @user`");

    const { score, reasons } = discordRisk(target);

    return message.reply(`
**Alt Check for ${target}**

Risk Score: \`${score}\`

Reasons:
${reasons.length ? reasons.map(r => `- ${r}`).join("\n") : "- No major risk found"}
`);
  }

  if (command === "robloxcheck") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    const robloxId = args[0];
    if (!robloxId) return message.reply("Use: `!robloxcheck ROBLOX_USER_ID`");

    const row = db.prepare(`
      SELECT username, first_seen, last_seen, flags
      FROM roblox_users
      WHERE roblox_id = ?
    `).get(robloxId);

    if (!row) return message.reply("No Roblox history found for that UserId.");

    return message.reply(`
**Roblox Check**

Username: \`${row.username}\`
Roblox UserId: \`${robloxId}\`
First Seen: \`${row.first_seen}\`
Last Seen: \`${row.last_seen}\`
Flags: \`${row.flags || "None"}\`
`);
  }

  if (command === "link") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    const target = message.mentions.members.first();
    const robloxId = args[1];
    const robloxUsername = args[2];

    if (!target || !robloxId || !robloxUsername) {
      return message.reply("Use: `!link @user ROBLOX_USER_ID ROBLOX_USERNAME`");
    }

    db.prepare(`
      INSERT OR REPLACE INTO linked_accounts
      (discord_id, roblox_id, roblox_username)
      VALUES (?, ?, ?)
    `).run(target.id, robloxId, robloxUsername);

    return message.reply(`Linked ${target} to Roblox \`${robloxUsername}\` / \`${robloxId}\`.`);
  }

  if (command === "flagdiscord") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    const target = message.mentions.members.first();
    const reason = args.slice(1).join(" ");

    if (!target || !reason) {
      return message.reply("Use: `!flagdiscord @user reason`");
    }

    db.prepare(`
      INSERT OR IGNORE INTO discord_users
      (discord_id, username, display_name, created_at, joined_at, left_at, flags)
      VALUES (?, ?, ?, ?, ?, NULL, '')
    `).run(
      target.id,
      target.user.username,
      target.displayName,
      target.user.createdAt.toISOString(),
      nowISO()
    );

    db.prepare(`
      UPDATE discord_users
      SET flags = flags || ?
      WHERE discord_id = ?
    `).run(`\n${reason}`, target.id);

    return message.reply(`Flagged ${target}: \`${reason}\``);
  }

  if (command === "flagroblox") {
    if (!allowed) return message.reply("You are not authorized to use AltDetector3000 commands.");

    const robloxId = args[0];
    const reason = args.slice(1).join(" ");

    if (!robloxId || !reason) {
      return message.reply("Use: `!flagroblox ROBLOX_USER_ID reason`");
    }

    db.prepare(`
      INSERT OR IGNORE INTO roblox_users
      (roblox_id, username, first_seen, last_seen, flags)
      VALUES (?, 'Unknown', ?, ?, '')
    `).run(robloxId, nowISO(), nowISO());

    db.prepare(`
      UPDATE roblox_users
      SET flags = flags || ?
      WHERE roblox_id = ?
    `).run(`\n${reason}`, robloxId);

    return message.reply(`Flagged Roblox \`${robloxId}\`: \`${reason}\``);
  }
});

client.login(DISCORD_TOKEN);
