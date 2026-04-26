const { pool } = require("./database");

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

function parseLocalERLCPlayer(player) {
  const rawPlayer = String(player.Player || "");
  const split = rawPlayer.split(":");

  return {
    username: String(player.Username || player.PlayerName || player.Name || split[0] || "Unknown").trim(),
    robloxId: String(player.RobloxId || player.RobloxID || player.UserId || player.UserID || player.Id || player.ID || split[1] || "").trim()
  };
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
    `SELECT username, display_name FROM discord_users WHERE discord_id != $1`,
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
  const { username, robloxId } = parseLocalERLCPlayer(player);

  if (robloxInfo?.created) {
    const robloxAge = daysOld(robloxInfo.created);

    if (robloxAge <= 30) {
      score += 40;
      reasons.push("Roblox account is under 30 days old");
    } else if (robloxAge <= 365) {
      score += 25;
      reasons.push("Roblox account is under 1 year old");
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

module.exports = { discordRisk, robloxRisk, daysOld, similarity };
