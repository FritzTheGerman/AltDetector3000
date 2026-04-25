require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  EmbedBuilder,
  ActivityType,
  SlashCommandBuilder,
  REST,
  Routes
} = require("discord.js");

const axios = require("axios");
const { Pool } = require("pg");

const BOT_NAME = "AltDetector3000";
const BOT_COLOR = 0xff0000;

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const CLIENT_ID = process.env.CLIENT_ID;
const GUILD_ID = process.env.GUILD_ID;
const ERLC_SERVER_KEY = process.env.ERLC_SERVER_KEY;
const DATABASE_URL = process.env.DATABASE_URL;
const STAFF_LOG_CHANNEL_ID = process.env.STAFF_LOG_CHANNEL_ID || "0";

const STAFF_ALERT_USER_IDS = (process.env.STAFF_ALERT_USER_IDS || "")
  .split(",")
  .map(id => id.trim())
  .filter(Boolean);

const ERLC_BASE_URL = "https://api.policeroleplay.community/v1";
const ERLC_V2_BASE_URL = "https://api.policeroleplay.community/v2";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers
  ]
});

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

function isStaff(userId) {
  return STAFF_ALERT_USER_IDS.includes(String(userId));
}

function nowISO() {
  return new Date().toISOString();
}

function daysOld(date) {
  if (!date) return 9999;
  return Math.floor((Date.now() - new Date(date).getTime()) / 86400000);
}

function similarity(a = "", b = "") {
  a = String(a).toLowerCase();
  b = String(b).toLowerCase();

  if (!a || !b) return 0;

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
  if (!user) return false;

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

async function fetchERLCServerInfo() {
  if (!ERLC_SERVER_KEY) {
    return {
      ok: false,
      status: "NO_KEY",
      error: "Missing ERLC_SERVER_KEY",
      data: null
    };
  }

  try {
    const response = await axios.get(`${ERLC_V2_BASE_URL}/server?Players=true`, {
      headers: { "Server-Key": ERLC_SERVER_KEY }
    });

    return {
      ok: true,
      status: response.status,
      version: "v2",
      data: response.data
    };
  } catch (v2Error) {
    try {
      const response = await axios.get(`${ERLC_BASE_URL}/server`, {
        headers: { "Server-Key": ERLC_SERVER_KEY }
      });

      return {
        ok: true,
        status: response.status,
        version: "v1",
        data: response.data
      };
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
    `SELECT username, display_name, left_at, flags FROM discord_users WHERE discord_id != $1`,
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

  const username = String(player.Player || player.PlayerName || player.Username || "Unknown");
  const robloxId = String(player.RobloxId || player.UserId || player.Id || "");

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
      headers: { "Server-Key": ERLC_SERVER_KEY }
    });

    return Array.isArray(response.data) ? response.data : [];
  } catch (error) {
    console.log("ERLC API error:", error.response?.status || error.message, error.response?.data || "");
    return [];
  }
}

async function trackERLCPlayers() {
  const players = await fetchERLCPlayers();

  for (const player of players) {
    const username = String(player.Player || player.PlayerName || player.Username || "Unknown");
    const robloxId = String(player.RobloxId || player.UserId || player.Id || "");

    if (!robloxId || robloxId === "undefined") continue;

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

    const { score, reasons } = await robloxRisk(player, robloxInfo);

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

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("ping")
      .setDescription("Check if AltDetector3000 is online"),

    new SlashCommandBuilder()
      .setName("help")
      .setDescription("Show AltDetector3000 commands"),

    new SlashCommandBuilder()
      .setName("erlctest")
      .setDescription("Test ER:LC API connection and show server info"),

    new SlashCommandBuilder()
      .setName("testalert")
      .setDescription("Send a test DM alert")
      .addUserOption(option =>
        option.setName("user").setDescription("Optional: test DM one specific user").setRequired(false)
      ),

    new SlashCommandBuilder()
      .setName("alerts")
      .setDescription("List staff alert users"),

    new SlashCommandBuilder()
      .setName("altcheck")
      .setDescription("Check a Discord member for alt risk")
      .addUserOption(option =>
        option.setName("user").setDescription("Discord user to check").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("robloxcheck")
      .setDescription("Check a Roblox user by UserId")
      .addStringOption(option =>
        option.setName("roblox_id").setDescription("Roblox UserId").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link a Discord user to a Roblox account")
      .addUserOption(option =>
        option.setName("user").setDescription("Discord user").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("roblox_id").setDescription("Roblox UserId").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("roblox_username").setDescription("Roblox username").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("flagdiscord")
      .setDescription("Add a staff flag to a Discord user")
      .addUserOption(option =>
        option.setName("user").setDescription("Discord user").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason").setDescription("Flag reason").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("flagroblox")
      .setDescription("Add a staff flag to a Roblox user")
      .addStringOption(option =>
        option.setName("roblox_id").setDescription("Roblox UserId").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason").setDescription("Flag reason").setRequired(true)
      )
  ].map(command => command.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(
      Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID),
      { body: commands }
    );
    console.log("Guild slash commands registered.");
  } else {
    await rest.put(
      Routes.applicationCommands(CLIENT_ID),
      { body: commands }
    );
    console.log("Global slash commands registered.");
  }
}

client.once("ready", async () => {
  await setupDatabase();
  await registerSlashCommands();

  console.log(`${BOT_NAME} logged in as ${client.user.tag}`);

  client.user.setPresence({
    activities: [
      { name: "ER:LC + Discord for alts", type: ActivityType.Watching }
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

client.on("interactionCreate", async interaction => {
  if (!interaction.isChatInputCommand()) return;

  if (!isStaff(interaction.user.id)) {
    return interaction.reply({
      content: "You are not authorized to use AltDetector3000 commands.",
      ephemeral: true
    });
  }

  const command = interaction.commandName;

  if (command === "ping") {
    return interaction.reply({
      content: `🏓 ${BOT_NAME} online. Ping: \`${client.ws.ping}ms\``,
      ephemeral: true
    });
  }

  if (command === "help") {
    return interaction.reply({
      content: `
**${BOT_NAME} Commands**

\`/ping\` - Check if the bot is online
\`/help\` - Show this command list
\`/erlctest\` - Test ER:LC API and show server info
\`/testalert\` - DM all staff a test alert
\`/testalert user:@user\` - DM one specific user a test alert
\`/alerts\` - Show who receives alerts
\`/altcheck user:@user\` - Check a Discord member
\`/robloxcheck roblox_id:123\` - Check Roblox history and account age
\`/link user:@user roblox_id:123 roblox_username:Name\` - Link Discord to Roblox
\`/flagdiscord user:@user reason:text\` - Add a flag to Discord user
\`/flagroblox roblox_id:123 reason:text\` - Add a flag to Roblox user
`,
      ephemeral: true
    });
  }

  if (command === "erlctest") {
    await interaction.deferReply({ ephemeral: true });

    const serverInfo = await fetchERLCServerInfo();
    const players = await fetchERLCPlayers();

    if (!serverInfo.ok) {
      return interaction.editReply(`
**ER:LC API Test Failed**

Status: \`${serverInfo.status}\`
Error: \`${JSON.stringify(serverInfo.error)}\`

Check:
- ERLC_SERVER_KEY is correct
- API pack is enabled
- Server key was copied correctly
`);
    }

    const serverName = getServerNameFromData(serverInfo.data);
    const serverPlayerCount = getPlayerCountFromServerData(serverInfo.data);

    return interaction.editReply(`
**ER:LC API Test Successful**

API Version Used: \`${serverInfo.version}\`
Server Name: \`${serverName}\`
Server Player Count From Server Info: \`${serverPlayerCount}\`
Players From /server/players: \`${players.length}\`

If the server name says Unknown, the API worked but did not return a name field in the format expected.
`);
  }

  if (command === "testalert") {
    const target = interaction.options.getUser("user");

    if (target) {
      const sent = await sendAlertToOneUser(
        target.id,
        "Single User Test Alert",
        `
This is a direct test alert from AltDetector3000.

Triggered by: ${interaction.user}
Sent to: ${target}
Time: ${new Date().toISOString()}

If this DM was received, direct test alerts are working.
`
      );

      return interaction.reply({
        content: sent
          ? `✅ Test alert sent to ${target}.`
          : "❌ Could not send the test alert to that user.",
        ephemeral: true
      });
    }

    await sendStaffAlert(
      "Staff Test Alert",
      `
This is a test alert from AltDetector3000.

Triggered by: ${interaction.user}
Time: ${new Date().toISOString()}

If you see this, staff DM alerts are working correctly.
`
    );

    return interaction.reply({
      content: "✅ Test alert sent to all staff.",
      ephemeral: true
    });
  }

  if (command === "alerts") {
    if (STAFF_ALERT_USER_IDS.length === 0) {
      return interaction.reply({
        content: "No staff alert users are set in `STAFF_ALERT_USER_IDS`.",
        ephemeral: true
      });
    }

    const lines = [];

    for (const id of STAFF_ALERT_USER_IDS) {
      const user = await client.users.fetch(id).catch(() => null);
      lines.push(user ? `- ${user.tag} / \`${id}\`` : `- Unknown User / \`${id}\``);
    }

    return interaction.reply({
      content: `**AltDetector3000 Alert Staff**\n\n${lines.join("\n")}`,
      ephemeral: true
    });
  }

  if (command === "altcheck") {
    const user = interaction.options.getUser("user");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return interaction.reply({
        content: "Could not find that member in this server.",
        ephemeral: true
      });
    }

    const { score, reasons } = await discordRisk(member);

    return interaction.reply({
      content: `
**Alt Check for ${member}**

Discord ID: \`${member.id}\`
Username: \`${member.user.username}\`
Display Name: \`${member.displayName}\`
Account Created: \`${member.user.createdAt.toISOString()}\`
Discord Age: \`${daysOld(member.user.createdAt)} days\`

Risk Score: \`${score}\`

Reasons:
${reasons.length ? reasons.map(r => `- ${r}`).join("\n") : "- No major risk found"}
`,
      ephemeral: true
    });
  }

  if (command === "robloxcheck") {
    const robloxId = interaction.options.getString("roblox_id");
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
      return interaction.reply({
        content: "No Roblox history found and Roblox API lookup failed.",
        ephemeral: true
      });
    }

    const dbUser = row.rows[0];

    return interaction.reply({
      content: `
**Roblox Check**

Username: \`${dbUser?.username || robloxInfo?.name || "Unknown"}\`
Display Name: \`${dbUser?.display_name || robloxInfo?.displayName || "Unknown"}\`
Roblox UserId: \`${robloxId}\`
Roblox Created: \`${dbUser?.roblox_created_at || robloxInfo?.created || "Unknown"}\`
Roblox Age: \`${robloxInfo?.created ? daysOld(robloxInfo.created) + " days" : "Unknown"}\`
First Seen In ER:LC: \`${dbUser?.first_seen || "Not seen yet"}\`
Last Seen In ER:LC: \`${dbUser?.last_seen || "Not seen yet"}\`
Flags: \`${dbUser?.flags || "None"}\`
`,
      ephemeral: true
    });
  }

  if (command === "link") {
    const user = interaction.options.getUser("user");
    const robloxId = interaction.options.getString("roblox_id");
    const robloxUsername = interaction.options.getString("roblox_username");

    await pool.query(
      `
      INSERT INTO linked_accounts
      (discord_id, roblox_id, roblox_username)
      VALUES ($1, $2, $3)
      ON CONFLICT (discord_id, roblox_id) DO UPDATE SET
        roblox_username = EXCLUDED.roblox_username
      `,
      [user.id, robloxId, robloxUsername]
    );

    return interaction.reply({
      content: `Linked ${user} to Roblox \`${robloxUsername}\` / \`${robloxId}\`.`,
      ephemeral: true
    });
  }

  if (command === "flagdiscord") {
    const user = interaction.options.getUser("user");
    const reason = interaction.options.getString("reason");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    await pool.query(
      `
      INSERT INTO discord_users
      (discord_id, username, display_name, created_at, joined_at, left_at, flags)
      VALUES ($1, $2, $3, $4, $5, NULL, '')
      ON CONFLICT (discord_id) DO NOTHING
      `,
      [
        user.id,
        user.username,
        member?.displayName || user.username,
        user.createdAt.toISOString(),
        nowISO()
      ]
    );

    await pool.query(
      `
      UPDATE discord_users
      SET flags = COALESCE(flags, '') || $1
      WHERE discord_id = $2
      `,
      [`\n${reason}`, user.id]
    );

    return interaction.reply({
      content: `Flagged ${user}: \`${reason}\``,
      ephemeral: true
    });
  }

  if (command === "flagroblox") {
    const robloxId = interaction.options.getString("roblox_id");
    const reason = interaction.options.getString("reason");
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

    return interaction.reply({
      content: `Flagged Roblox \`${robloxId}\`: \`${reason}\``,
      ephemeral: true
    });
  }
});

client.login(DISCORD_TOKEN);
