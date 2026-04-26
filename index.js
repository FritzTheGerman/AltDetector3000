require("dotenv").config();

const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
const { BOT_NAME } = require("./src/config");
const { setupDatabase } = require("./src/database");
const { registerSlashCommands } = require("./src/commands");
const { handleInteraction, handleMemberJoin, handleMemberLeave } = require("./src/handlers");
const { trackERLCPlayers, startRefreshLoop } = require("./src/erlc");
const { syncDatabaseToGoogleSheets } = require("./src/sheets");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  try {
    await setupDatabase();
    await registerSlashCommands();

    console.log(`${BOT_NAME} logged in as ${client.user.tag}`);

    client.user.setPresence({
      activities: [{ name: "ER:LC + Discord for alts", type: ActivityType.Watching }],
      status: "online"
    });

    trackERLCPlayers(client);
    setInterval(() => trackERLCPlayers(client), 60000);

    startRefreshLoop();

    // Sync once on startup only. Real-time sync happens in handlers/ERLC updates.
    syncDatabaseToGoogleSheets().catch(err =>
      console.error("Startup sheet sync failed:", err.message)
    );

    console.log("AltDetector3000 fully started.");
  } catch (error) {
    console.error("Startup error:", error);
  }
});

client.on("guildMemberAdd", async member => {
  try {
    await handleMemberJoin(client, member);
  } catch (error) {
    console.error("guildMemberAdd error:", error);
  }
});

client.on("guildMemberRemove", async member => {
  try {
    await handleMemberLeave(member);
  } catch (error) {
    console.error("guildMemberRemove error:", error);
  }
});

client.on("interactionCreate", async interaction => {
  try {
    await handleInteraction(client, interaction);
  } catch (error) {
    console.error("Interaction error:", error);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply("❌ Command failed. Check Railway logs.").catch(() => {});
    } else {
      await interaction.reply({
        content: "❌ Command failed. Check Railway logs."
      }).catch(() => {});
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
