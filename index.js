require("dotenv").config();

const { Client, GatewayIntentBits, ActivityType } = require("discord.js");
const { BOT_NAME } = require("./src/config");
const { setupDatabase } = require("./src/database");
const { registerSlashCommands } = require("./src/commands");
const {
  handleInteraction,
  handleMemberJoin,
  handleMemberLeave
} = require("./src/handlers");
const { trackERLCPlayers } = require("./src/erlc");
const { syncDatabaseToGoogleSheets } = require("./src/sheets");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

client.once("ready", async () => {
  await setupDatabase();
  await registerSlashCommands();

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

  trackERLCPlayers(client);
  setInterval(() => trackERLCPlayers(client), 60000);

  syncDatabaseToGoogleSheets();
  setInterval(syncDatabaseToGoogleSheets, 300000);
});

client.on("guildMemberAdd", member => handleMemberJoin(client, member));
client.on("guildMemberRemove", member => handleMemberLeave(member));
client.on("interactionCreate", interaction => handleInteraction(client, interaction));

client.login(process.env.DISCORD_TOKEN);
