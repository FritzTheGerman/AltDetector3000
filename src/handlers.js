const { pool } = require("./database");
const { BOT_NAME, isStaff, STAFF_ALERT_USER_IDS } = require("./config");
const { sendStaffAlert } = require("./alerts");
const { discordRisk, daysOld } = require("./risk");
const {
  runERLCCommand,
  lockPlayer,
  unlockPlayer,
  getLockedPlayers
} = require("./erlc");

const { syncDatabaseToGoogleSheets, getLastSheetsSyncTime } = require("./sheets");

async function handleInteraction(client, interaction) {
  if (!interaction.isChatInputCommand()) return;

  if (!isStaff(interaction.user.id)) {
    return interaction.reply({ content: "Not authorized.", ephemeral: true });
  }

  const command = interaction.commandName;

  // ping
  if (command === "ping") {
    return interaction.reply({ content: `🏓 ${client.ws.ping}ms`, ephemeral: true });
  }

  // lock
  if (command === "lock") {
    const refresh = interaction.options.getInteger("refresh_seconds");
    const duration = interaction.options.getInteger("duration_minutes");
    const user = interaction.options.getString("roblox_username");

    lockPlayer(user, refresh, duration);

    return interaction.reply({
      content: `🔒 Locked ${user}\nEvery ${refresh}s for ${duration} min`,
      ephemeral: true
    });
  }

  // unlock
  if (command === "unlock") {
    const user = interaction.options.getString("roblox_username");

    const ok = unlockPlayer(user);

    return interaction.reply({
      content: ok ? `🔓 Unlocked ${user}` : `⚠️ ${user} not locked`,
      ephemeral: true
    });
  }

  // locks
  if (command === "locks") {
    const locked = getLockedPlayers();

    return interaction.reply({
      content: locked.length
        ? locked.map(p => `- ${p.username} (${p.remainingMinutes}m left)`).join("\n")
        : "No locked players.",
      ephemeral: true
    });
  }

  // kill
  if (command === "kill") {
    const user = interaction.options.getString("roblox_username");
    await runERLCCommand(`:kill ${user}`);

    return interaction.reply({
      content: `💀 Killed ${user}`,
      ephemeral: true
    });
  }

  // SYNC SHEETS
  if (command === "syncsheets") {
    await interaction.deferReply({ ephemeral: true });

    try {
      const lastSync = await getLastSheetsSyncTime();
      const result = await syncDatabaseToGoogleSheets();

      if (!result.ok) {
        return interaction.editReply(`❌ ${result.message}`);
      }

      return interaction.editReply(`
✅ **Sheets Synced**

Last Sync Before: ${lastSync ? new Date(lastSync).toISOString() : "Never"}
Now: ${result.currentSync.toISOString()}

Rows:
Discord: ${result.rows.discordRows}
Roblox: ${result.rows.robloxRows}
Linked: ${result.rows.linkedRows}

New:
Discord: ${result.stats.discordNew}
Roblox: ${result.stats.robloxNew}

Updated:
Discord: ${result.stats.discordUpdated}
Roblox: ${result.stats.robloxUpdated}
`);
    } catch (err) {
      return interaction.editReply(`❌ Error: ${err.message}`);
    }
  }
}

module.exports = { handleInteraction };
