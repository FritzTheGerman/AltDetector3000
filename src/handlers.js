const { EmbedBuilder } = require("discord.js");
const { pool } = require("./database");
const { BOT_NAME, BOT_COLOR, isStaff, STAFF_ALERT_USER_IDS } = require("./config");
const { sendStaffAlert, sendAlertToOneUser } = require("./alerts");
const { discordRisk, daysOld } = require("./risk");
const {
  fetchERLCServerInfo,
  fetchERLCPlayers,
  getServerNameFromData,
  getPlayerCountFromServerData,
  parseERLCPlayer,
  getRobloxUserInfo,
  runERLCCommand,
  lockPlayer,
  unlockPlayer,
  getLockedPlayers,
  nowISO
} = require("./erlc");
const { syncDatabaseToGoogleSheets, getLastSheetsSyncTime } = require("./sheets");

function makeEmbed(title, description, color = BOT_COLOR) {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: BOT_NAME });
}

async function replyEmbed(interaction, title, description, color = BOT_COLOR) {
  const embed = makeEmbed(title, description, color);

  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ embeds: [embed] });
  }

  return interaction.reply({ embeds: [embed] });
}

async function logCommand(interaction, status, errorMessage = null) {
  try {
    await pool.query(
      `
      INSERT INTO command_logs
      (command_name, user_id, username, guild_id, channel_id, options_json, status, error_message, ran_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      `,
      [
        interaction.commandName,
        interaction.user?.id || null,
        interaction.user?.tag || interaction.user?.username || null,
        interaction.guildId || null,
        interaction.channelId || null,
        JSON.stringify(interaction.options?.data || []),
        status,
        errorMessage
      ]
    );
  } catch (error) {
    console.error("Command log error:", error);
  }
}

async function handleMemberJoin(client, member) {
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
    [member.id, member.user.username, member.displayName, member.user.createdAt.toISOString(), nowISO()]
  );

  if (score >= 40) {
    await sendStaffAlert(
      client,
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

    await pool.query(`UPDATE discord_users SET last_alerted_at = $1 WHERE discord_id = $2`, [
      nowISO(),
      member.id
    ]);
  }

  try {
    await syncDatabaseToGoogleSheets();
  } catch (error) {
    console.error("Auto join sheet sync failed:", error.message);
  }
}

async function handleMemberLeave(member) {
  await pool.query(`UPDATE discord_users SET left_at = $1 WHERE discord_id = $2`, [
    nowISO(),
    member.id
  ]);

  try {
    await syncDatabaseToGoogleSheets();
  } catch (error) {
    console.error("Auto leave sheet sync failed:", error.message);
  }
}

async function runInteraction(client, interaction) {
  const command = interaction.commandName;

  if (!isStaff(interaction.user.id)) {
  const ownerPing = OWNER_USER_ID ? `<@${OWNER_USER_ID}>` : "Owner not set";

  return replyEmbed(
    interaction,
    "Unauthorized",
    `${interaction.user} tried to use \`/${interaction.commandName}\` but is not authorized.\n\nOwner Alert: ${ownerPing}`,
    0xff5555,
    false // 👈 THIS is the important part (makes it public)
    );
  }

  if (command === "ping") {
    return replyEmbed(interaction, "Pong", `AltDetector3000 is online.\nPing: \`${client.ws.ping}ms\``);
  }

  if (command === "help") {
    return replyEmbed(
      interaction,
      `${BOT_NAME} Commands`,
      `
\`/ping\` - Check bot status
\`/help\` - Show commands
\`/erlctest\` - Test ER:LC API
\`/kill roblox_username:Name\` - Kill player in ER:LC
\`/lock refresh_seconds:5 duration_minutes:10 roblox_username:Name\` - Refresh-lock player
\`/unlock roblox_username:Name\` - Stop refresh-lock
\`/locks\` - Show locked players
\`/syncsheets\` - Sync database to Google Sheets
\`/testalert\` - Test alerts
\`/alerts\` - Show alert staff
\`/altcheck user:@user\` - Check Discord user
\`/robloxcheck roblox_id:123\` - Check Roblox user
\`/link user:@user roblox_id:123 roblox_username:Name\` - Link account
\`/flagdiscord user:@user reason:text\` - Flag Discord user
\`/flagroblox roblox_id:123 reason:text\` - Flag Roblox user
`
    );
  }

  if (command === "erlctest") {
    await interaction.deferReply();

    const serverInfo = await fetchERLCServerInfo();
    const players = await fetchERLCPlayers();

    if (!serverInfo.ok) {
      return replyEmbed(
        interaction,
        "ER:LC API Test Failed",
        `Status: \`${serverInfo.status}\`\nError: \`${JSON.stringify(serverInfo.error)}\``,
        0xff5555
      );
    }

    const samplePlayers = players
      .slice(0, 5)
      .map(p => {
        const parsed = parseERLCPlayer(p);
        return `- ${parsed.username} / ${parsed.robloxId || "NO ID FOUND"}`;
      })
      .join("\n") || "- No players returned";

    return replyEmbed(
      interaction,
      "ER:LC API Test Successful",
      `
API Version Used: \`${serverInfo.version}\`
Server Name: \`${getServerNameFromData(serverInfo.data)}\`
Server Player Count From Server Info: \`${getPlayerCountFromServerData(serverInfo.data)}\`
Players From /server/players: \`${players.length}\`

**Sample Parsed Players**
${samplePlayers}
`
    );
  }

  if (command === "kill") {
    await interaction.deferReply();

    const robloxUsername = interaction.options.getString("roblox_username");
    const result = await runERLCCommand(`:kill ${robloxUsername}`);

    if (!result.ok) {
      return replyEmbed(
        interaction,
        "Kill Command Failed",
        `Player: \`${robloxUsername}\`\nStatus: \`${result.status}\`\nError: \`${JSON.stringify(result.error)}\``,
        0xff5555
      );
    }

    return replyEmbed(
      interaction,
      "Kill Command Sent",
      `Player: \`${robloxUsername}\`\nCommand: \`:kill ${robloxUsername}\``
    );
  }

  if (command === "lock") {
    const refreshSeconds = interaction.options.getInteger("refresh_seconds");
    const durationMinutes = interaction.options.getInteger("duration_minutes");
    const robloxUsername = interaction.options.getString("roblox_username");

    lockPlayer(robloxUsername, refreshSeconds, durationMinutes);

    return replyEmbed(
      interaction,
      "Player Locked",
      `Player: \`${robloxUsername}\`\nRefresh Time: \`${refreshSeconds}s\`\nDuration: \`${durationMinutes} minute(s)\``
    );
  }

  if (command === "unlock") {
    const robloxUsername = interaction.options.getString("roblox_username");
    const unlocked = unlockPlayer(robloxUsername);

    return replyEmbed(
      interaction,
      unlocked ? "Player Unlocked" : "Player Was Not Locked",
      unlocked
        ? `Player: \`${robloxUsername}\`\nRefresh loop stopped.`
        : `Player: \`${robloxUsername}\`\nNo active lock found.`,
      unlocked ? BOT_COLOR : 0xffaa00
    );
  }

  if (command === "locks") {
    const locked = getLockedPlayers();

    return replyEmbed(
      interaction,
      "Currently Locked Players",
      locked.length
        ? locked.map(p => `- \`${p.username}\` | every \`${p.refreshSeconds}s\` | \`${p.remainingMinutes} min\` left`).join("\n")
        : "No players are currently locked."
    );
  }

  if (command === "syncsheets") {
    await interaction.deferReply();

    const lastSync = await getLastSheetsSyncTime();
    const result = await syncDatabaseToGoogleSheets();

    if (!result.ok) {
      return replyEmbed(interaction, "Google Sheets Sync Failed", result.message, 0xff5555);
    }

    return replyEmbed(
      interaction,
      "Google Sheets Sync Complete",
      `
**Last Sync Before:** \`${lastSync ? new Date(lastSync).toISOString() : "Never"}\`
**Synced At:** \`${result.currentSync.toISOString()}\`

**Rows Written**
- Discord Users: \`${result.rows.discordRows}\`
- Roblox Users: \`${result.rows.robloxRows}\`
- Linked Accounts: \`${result.rows.linkedRows}\`
- Command Logs: \`${result.rows.commandRows}\`

**New Since Last Sync**
- Discord Users: \`${result.stats.discordNew}\`
- Roblox Users: \`${result.stats.robloxNew}\`
- Commands: \`${result.stats.commandNew}\`

**Updated Since Last Sync**
- Discord Users: \`${result.stats.discordUpdated}\`
- Roblox Users: \`${result.stats.robloxUpdated}\`
`
    );
  }

  if (command === "testalert") {
    const target = interaction.options.getUser("user");

    if (target) {
      const sent = await sendAlertToOneUser(
        client,
        target.id,
        "Single User Test Alert",
        `Triggered by: ${interaction.user}\nSent to: ${target}\nTime: ${new Date().toISOString()}`
      );

      return replyEmbed(
        interaction,
        sent ? "Test Alert Sent" : "Test Alert Failed",
        sent ? `Sent to ${target}.` : "Could not send DM.",
        sent ? BOT_COLOR : 0xff5555
      );
    }

    await sendStaffAlert(
      client,
      "Staff Test Alert",
      `Triggered by: ${interaction.user}\nTime: ${new Date().toISOString()}`
    );

    return replyEmbed(interaction, "Test Alert Sent", "Sent to all staff.");
  }

  if (command === "alerts") {
    if (STAFF_ALERT_USER_IDS.length === 0) {
      return replyEmbed(interaction, "Alert Staff", "No staff alert users are set.", 0xffaa00);
    }

    const lines = [];
    for (const id of STAFF_ALERT_USER_IDS) {
      const user = await client.users.fetch(id).catch(() => null);
      lines.push(user ? `- ${user.tag} / \`${id}\`` : `- Unknown User / \`${id}\``);
    }

    return replyEmbed(interaction, "AltDetector3000 Alert Staff", lines.join("\n"));
  }

  if (command === "altcheck") {
    const user = interaction.options.getUser("user");
    const member = await interaction.guild.members.fetch(user.id).catch(() => null);

    if (!member) {
      return replyEmbed(interaction, "Alt Check Failed", "Could not find that member.", 0xff5555);
    }

    const { score, reasons } = await discordRisk(member);

    return replyEmbed(
      interaction,
      `Alt Check: ${member.user.username}`,
      `
Discord ID: \`${member.id}\`
Display Name: \`${member.displayName}\`
Account Created: \`${member.user.createdAt.toISOString()}\`
Discord Age: \`${daysOld(member.user.createdAt)} days\`

Risk Score: \`${score}\`

Reasons:
${reasons.length ? reasons.map(r => `- ${r}`).join("\n") : "- No major risk found"}
`
    );
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

    const dbUser = row.rows[0];

    return replyEmbed(
      interaction,
      "Roblox Check",
      `
Username: \`${dbUser?.username || robloxInfo?.name || "Unknown"}\`
Display Name: \`${dbUser?.display_name || robloxInfo?.displayName || "Unknown"}\`
Roblox UserId: \`${robloxId}\`
Roblox Created: \`${dbUser?.roblox_created_at || robloxInfo?.created || "Unknown"}\`
Roblox Age: \`${robloxInfo?.created ? daysOld(robloxInfo.created) + " days" : "Unknown"}\`
First Seen In ER:LC: \`${dbUser?.first_seen || "Not seen yet"}\`
Last Seen In ER:LC: \`${dbUser?.last_seen || "Not seen yet"}\`
Flags: \`${dbUser?.flags || "None"}\`
`
    );
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

    return replyEmbed(
      interaction,
      "Account Linked",
      `Discord: ${user}\nRoblox: \`${robloxUsername}\`\nRoblox ID: \`${robloxId}\``
    );
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
      [user.id, user.username, member?.displayName || user.username, user.createdAt.toISOString(), nowISO()]
    );

    await pool.query(
      `UPDATE discord_users SET flags = COALESCE(flags, '') || $1 WHERE discord_id = $2`,
      [`\n${reason}`, user.id]
    );

    return replyEmbed(interaction, "Discord User Flagged", `User: ${user}\nReason: \`${reason}\``);
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
      `UPDATE roblox_users SET flags = COALESCE(flags, '') || $1 WHERE roblox_id = $2`,
      [`\n${reason}`, robloxId]
    );

    return replyEmbed(interaction, "Roblox User Flagged", `Roblox ID: \`${robloxId}\`\nReason: \`${reason}\``);
  }

  return replyEmbed(interaction, "Unknown Command", `Command \`/${command}\` was not handled.`, 0xffaa00);
}

async function handleInteraction(client, interaction) {
  if (!interaction.isChatInputCommand()) return;

  let status = "success";
  let errorMessage = null;

  try {
    await runInteraction(client, interaction);
  } catch (error) {
    status = "error";
    errorMessage = error.message;
    console.error("Interaction handler error:", error);

    await replyEmbed(
      interaction,
      "Command Failed",
      `Something went wrong.\nError: \`${error.message}\``,
      0xff5555
    ).catch(() => {});
  } finally {
    await logCommand(interaction, status, errorMessage);

    try {
      await syncDatabaseToGoogleSheets();
    } catch (error) {
      console.error("Auto command sheet sync failed:", error.message);
    }
  }
}

module.exports = { handleInteraction, handleMemberJoin, handleMemberLeave };
