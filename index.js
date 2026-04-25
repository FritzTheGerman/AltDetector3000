require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  PermissionsBitField,
  ActivityType
} = require("discord.js");

const axios = require("axios");
const Database = require("better-sqlite3");

const BOT_NAME = "AltDetector3000";
const BOT_COLOR = 0xff0000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY;
const STAFF_ALERT_USER_IDS = (process.env.STAFF_ALERT_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID;

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

function nowISO() {
  return new Date().toISOString();
}

function daysOld(date) {
  const diff = Date.now() - new Date(date).getTime();
  return Math.floor(diff / 86400000);
}

function similarity(a = "", b = "") {
  a = a.toLowerCase();
  b = b.toLowerCase();

  const matrix = [];

  for (let i = 0; i <= b.length; i++) matrix[i] = [i];
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  const distance = matrix[b.length][a.length];
  const maxLength = Math.max(a.length, b.length);
  return maxLength === 0 ? 1 : 1 - distance / maxLength;
}

async function sendStaffAlert(title, description) {
  const embed = new EmbedBuilder()
    .setTitle(`${BOT_NAME} Alert`)
    .setDescription(`**${title}**\n\n${description}`)
    .setColor(BOT_COLOR)
    .setTimestamp()
    .setFooter({ text: "AltDetector3000 • ER:LC + Discord Monitoring" });

  const channel = await client.channels.fetch(STAFF_LOG_CHANNEL_ID).catch(() => null);
  if (channel) await channel.send({ embeds: [embed] });

  for (const id of STAFF_ALERT_USER_IDS) {
    const user = await client.users.fetch(id).catch(() => null);
    if (user) {
      await user.send({ embeds: [embed] }).catch(() => {});
    }
  }
}

function discordRiskScore(member) {
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

  const oldUsers = db.prepare("SELECT username, display_name FROM discord_users").all();

  for (const old of oldUsers) {
    const nameMatch = Math.max(
      similarity(member.user.username, old.username || ""),
      similarity(member.displayName, old.display_name || "")
    );

    if (nameMatch >= 0.82) {
      score += 20;
      reasons.push(`Similar name to previous member: ${old.username}`);
      break;
    }
  }

  return { score, reasons };
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

  setInterval(trackERLCPlayers, 60000);
});

client.on("guildMemberAdd", async member => {
  const { score, reasons } = discordRiskScore(member);

  db.prepare(`
    INSERT OR REPLACE INTO discord_users
    (discord_id, username, display_name, created_at, joined_at, left_at)
    VALUES (?, ?, ?, ?, ?, NULL)
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
${reasons.map(r => `- ${r}`).join("\n")}

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

async function fetchERLCPlayers() {
  try {
    const response = await axios.get(`${ERLC_BASE_URL}/server/players`, {
      headers: {
        "Server-Key": ERLC_SERVER_KEY
      }
    });

    return response.data || [];
  } catch (error) {
    console.error("ERLC API Error:", error.response?.status, error.response?.data || error.message);
    return [];
  }
}

function robloxRiskScore(player) {
  let score = 0;
  const reasons = [];

  const username = String(player.Player || "Unknown");
  const robloxId = String(player.RobloxId || "");

  const previous = db.prepare("SELECT username FROM roblox_users").all();

  for (const old of previous) {
    if (old.username && similarity(username, old.username) >= 0.82) {
      score += 20;
      reasons.push(`Similar Roblox username to previous player: ${old.username}`);
      break;
    }
  }

  const linked = db.prepare(`
    SELECT discord_id FROM linked_accounts
    WHERE roblox_id = ?
  `).get(robloxId);

  if (!linked) {
    score += 15;
    reasons.push("Roblox account is not linked to a Discord member");
  }

  return { score, reasons };
}

async function trackERLCPlayers() {
  const players = await fetchERLCPlayers();

  for (const player of players) {
    const username = String(player.Player || "Unknown");
    const robloxId = String(player.RobloxId || "");

    if (!robloxId) continue;

    db.prepare(`
      INSERT INTO roblox_users
      (roblox_id, username, first_seen, last_seen)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(roblox_id) DO UPDATE SET
      username = excluded.username,
      last_seen = excluded.last_seen
    `).run(robloxId, username, nowISO(), nowISO());

    const { score, reasons } = robloxRiskScore(player);

    if (score >= 30) {
      await sendStaffAlert(
        "Suspected Roblox Alt Detected",
        `
Username: \`${username}\`
Roblox UserId: \`${robloxId}\`

Risk Score: \`${score}\`

Reasons:
${reasons.map(r => `- ${r}`).join("\n")}

Recommended Action:
Manual review.
`
      );
    }
  }
}

client.on("messageCreate", async message => {
  if (message.author.bot || !message.content.startsWith("!")) return;

  const args = message.content.slice(1).trim().split(/ +/);
  const command = args.shift()?.toLowerCase();

  const member = message.member;
  const canManage = member.permissions.has(PermissionsBitField.Flags.ManageGuild);

  if (command === "ping") {
    return message.reply(`🏓 ${BOT_NAME} online. Ping: \`${client.ws.ping}ms\``);
  }

  if (command === "altcheck") {
    if (!canManage) return message.reply("You need Manage Server permission.");

    const target = message.mentions.members.first();
    if (!target) return message.reply("Use: `!altcheck @user`");

    const { score, reasons } = discordRiskScore(target);

    return message.reply(`
**Alt Check for ${target}**

Risk Score: \`${score}\`

Reasons:
${reasons.length ? reasons.map(r => `- ${r}`).join("\n") : "- No major risk found"}
`);
  }

  if (command === "robloxcheck") {
    if (!canManage) return message.reply("You need Manage Server permission.");

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
    if (!canManage) return message.reply("You need Manage Server permission.");

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
});

client.login(DISCORD_TOKEN);
