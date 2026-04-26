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

function isStaff(userId) {
  return STAFF_ALERT_USER_IDS.includes(String(userId));
}

module.exports = {
  BOT_NAME,
  BOT_COLOR,
  DISCORD_TOKEN,
  CLIENT_ID,
  GUILD_ID,
  ERLC_SERVER_KEY,
  DATABASE_URL,
  STAFF_LOG_CHANNEL_ID,
  STAFF_ALERT_USER_IDS,
  ERLC_BASE_URL,
  ERLC_V2_BASE_URL,
  isStaff
};
