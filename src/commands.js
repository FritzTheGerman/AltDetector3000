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
        option
          .setName("refresh_seconds")
          .setDescription("How often to refresh them, in seconds. Minimum 3.")
          .setRequired(true)
          .setMinValue(3)
          .setMaxValue(60)
      )
      .addIntegerOption(option =>
        option
          .setName("duration_minutes")
          .setDescription("How long the lock lasts, in minutes.")
          .setRequired(true)
          .setMinValue(1)
          .setMaxValue(60)
      )
      .addStringOption(option =>
        option
          .setName("roblox_username")
          .setDescription("Roblox username to lock")
          .setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("unlock")
      .setDescription("Unlock a player and stop refreshing them")
      .addStringOption(option =>
        option.setName("roblox_username").setDescription("Roblox username to unlock").setRequired(true)
      ),

    new SlashCommandBuilder()
      .setName("locks")
      .setDescription("Show currently locked players"),

    new SlashCommandBuilder()
      .setName("testalert")
      .setDescription("Send a test DM alert")
      .addUserOption(option =>
        option.setName("user").setDescription("Optional: test DM one specific user").setRequired(false)
      ),

    new SlashCommandBuilder().setName("alerts").setDescription("List staff alert users"),

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
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: commands });
    console.log("Guild slash commands registered.");
  } else {
    await rest.put(Routes.applicationCommands(CLIENT_ID), { body: commands });
    console.log("Global slash commands registered.");
  }
}

module.exports = { registerSlashCommands };
