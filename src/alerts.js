const { EmbedBuilder } = require("discord.js");
const {
  BOT_NAME,
  BOT_COLOR,
  STAFF_LOG_CHANNEL_ID,
  STAFF_ALERT_USER_IDS
} = require("./config");

async function sendStaffAlert(client, title, description) {
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

async function sendAlertToOneUser(client, userId, title, description) {
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

module.exports = { sendStaffAlert, sendAlertToOneUser };
