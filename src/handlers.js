const { pool } = require("./database");
const { BOT_NAME, STAFF_ALERT_USER_IDS, isStaff } = require("./config");
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
}

async function handleMemberLeave(member) {
  await pool.query(`UPDATE discord_users SET left_at = $1 WHERE discord_id = $2`, [
    nowISO(),
    member.id
  ]);
}

async function handleInteraction(client, interaction) {
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

\`/ping\`
\`/help\`
\`/erlctest\`
\`/kill roblox_username:Name\`
\`/lock refresh_seconds:5 duration_minutes:10 roblox_username:Name\`
\`/unlock roblox_username:Name\`
\`/locks\`
\`/testalert\`
\`/alerts\`
\`/altcheck user:@user\`
\`/robloxcheck roblox_id:123\`
\`/link user:@user roblox_id:123 roblox_username:Name\`
\`/flagdiscord user:@user reason:text\`
\`/flagroblox roblox_id:123 reason:text\`
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
`);
    }

    const samplePlayers = players
      .slice(0, 5)
      .map(p => {
        const parsed = parseERLCPlayer(p);
        return `- ${parsed.username} / ${parsed.robloxId || "NO ID FOUND"}`;
      })
      .join("\n") || "- No players returned";

    return interaction.editReply(`
**ER:LC API Test Successful**

API Version Used: \`${serverInfo.version}\`
Server Name: \`${getServerNameFromData(serverInfo.data)}\`
Server Player Count From Server Info: \`${getPlayerCountFromServerData(serverInfo.data)}\`
Players From /server/players: \`${players.length}\`

**Sample Parsed Players**
${samplePlayers}
`);
  }

  if (command === "kill") {
    const robloxUsername = interaction.options.getString("roblox_username");
    await interaction.deferReply({ ephemeral: true });

    const result = await runERLCCommand(`:kill ${robloxUsername}`);

    if (!result.ok) {
      return interaction.editReply(`
❌ Failed to execute kill command.

Player: \`${robloxUsername}\`
Status: \`${result.status}\`
Error: \`${JSON.stringify(result.error)}\`
`);
    }

    return interaction.editReply(`
✅ Kill command sent successfully.

Player: \`${robloxUsername}\`
Command: \`:kill ${robloxUsername}\`
`);
  }

  if (command === "lock") {
    const refreshSeconds = interaction.options.getInteger("refresh_seconds");
    const durationMinutes = interaction.options.getInteger("duration_minutes");
    const robloxUsername = interaction.options.getString("roblox_username");

    lockPlayer(robloxUsername, refreshSeconds, durationMinutes);

    return interaction.reply({
      content: `🔒 Locked \`${robloxUsername}\`.\nRefresh Time: \`${refreshSeconds}s\`\nDuration: \`${durationMinutes} minute(s)\``,
      ephemeral: true
    });
  }

  if (command === "unlock") {
    const robloxUsername = interaction.options.getString("roblox_username");
    const unlocked = unlockPlayer(robloxUsername);

    return interaction.reply({
      content: unlocked
        ? `🔓 Unlocked \`${robloxUsername}\`. Refresh loop stopped.`
        : `⚠️ \`${robloxUsername}\` was not locked.`,
      ephemeral: true
    });
  }

  if (command === "locks") {
    const locked = getLockedPlayers();

    return interaction.reply({
      content: locked.length
        ? `**Currently Locked Players**\n${locked
            .map(p => `- ${p.username} | every ${p.refreshSeconds}s | ${p.remainingMinutes} min left`)
            .join("\n")}`
        : "No players are currently locked.",
      ephemeral: true
    });
  }

  if (command === "testalert") {
    const target = interaction.options.getUser("user");

    if (target) {
      const sent = await sendAlertToOneUser(client, target.id, "Single User Test Alert", `
This is a direct test alert from AltDetector3000.

Triggered by: ${interaction.user}
Sent to: ${target}
Time: ${new Date().toISOString()}
`);

      return interaction.reply({
        content: sent ? `✅ Test alert sent to ${target}.` : "❌ Could not send the test alert.",
        ephemeral: true
      });
    }

    await sendStaffAlert(client, "Staff Test Alert", `
This is a test alert from AltDetector3000.

Triggered by: ${interaction.user}
Time: ${new Date().toISOString()}
`);

    return interaction.reply({ content: "✅ Test alert sent to all staff.", ephemeral: true });
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
      return interaction.reply({ content: "Could not find that member.", ephemeral: true });
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
      [user.id, user.username, member?.displayName || user.username, user.createdAt.toISOString(), nowISO()]
    );

    await pool.query(
      `UPDATE discord_users SET flags = COALESCE(flags, '') || $1 WHERE discord_id = $2`,
      [`\n${reason}`, user.id]
    );

    return interaction.reply({ content: `Flagged ${user}: \`${reason}\``, ephemeral: true });
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

    return interaction.reply({
      content: `Flagged Roblox \`${robloxId}\`: \`${reason}\``,
      ephemeral: true
    });
  }
}

module.exports = { handleInteraction, handleMemberJoin, handleMemberLeave };
