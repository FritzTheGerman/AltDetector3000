const { SlashCommandBuilder, REST, Routes } = require("discord.js");
const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = require("./config");

async function registerSlashCommands() {
  const commands = [
    new SlashCommandBuilder().setName("ping").setDescription("Check if AltDetector3000 is online"),
    new SlashCommandBuilder().setName("help").setDescription("Show AltDetector3000 commands"),
    new SlashCommandBuilder().setName("erlctest").setDescription("Test ER:LC API connection and show server info"),

    new SlashCommandBuilder()
      .setName("kill")
      .setDescription("Kill a player in ER:LC")
      .addStringOption(option =>
        option.setName("roblox_username").setDescription("Roblox username to kill").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("lock")
      .setDescription("Refresh-lock a player for a set amount of time")
      .addIntegerOption(option =>
        option.setName("refresh_seconds").setDescription("Refresh interval in seconds").setRequired(true).setMinValue(3).setMaxValue(60)
      )
      .addIntegerOption(option =>
        option.setName("duration_minutes").setDescription("Duration in minutes").setRequired(true).setMinValue(1).setMaxValue(60)
      )
      .addStringOption(option =>
        option.setName("roblox_username").setDescription("Roblox username").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlock a player")
      .addStringOption(option =>
        option.setName("roblox_username").setDescription("Roblox username").setRequired(true)
      ),

    new SlashCommandBuilder().setName("locks").setDescription("Show locked players"),
    new SlashCommandBuilder().setName("syncsheets").setDescription("Manually sync Postgres database to Google Sheets"),

    new SlashCommandBuilder()
      .setName("testalert")
      .setDescription("Send a test alert")
      .addUserOption(option =>
        option.setName("user").setDescription("Optional user to DM").setRequired(false)
      ),

    new SlashCommandBuilder().setName("alerts").setDescription("Show alert users"),

    new SlashCommandBuilder()
      .setName("altcheck")
      .setDescription("Check Discord alt risk")
      .addUserOption(option =>
        option.setName("user").setDescription("Discord user").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("robloxcheck")
      .setDescription("Check Roblox user")
      .addStringOption(option =>
        option.setName("roblox_id").setDescription("Roblox UserId").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("link")
      .setDescription("Link Discord user to Roblox")
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
      .setDescription("Flag a Discord user")
      .addUserOption(option =>
        option.setName("user").setDescription("Discord user").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason").setDescription("Reason").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("flagroblox")
      .setDescription("Flag a Roblox user")
      .addStringOption(option =>
        option.setName("roblox_id").setDescription("Roblox UserId").setRequired(true)
      )
      .addStringOption(option =>
        option.setName("reason").setDescription("Reason").setRequired(true)
      )
  ].map(cmd => cmd.toJSON());

  const rest = new REST({ version: "10" }).setToken(DISCORD_TOKEN);

  if (GUILD_ID) {
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
  }

  console.log("Slash commands registered.");
}

module.exports = { registerSlashCommands };
