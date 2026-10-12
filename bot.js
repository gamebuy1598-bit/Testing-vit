// ============================================================
// ALL-IN-ONE DISCORD BOT
// Anti-Spam | Anti-Nuke | Moderation | Welcome DM | Points
// ============================================================

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  AuditLogEvent,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');

// ---------- CONFIG FROM .env ----------
const CONFIG = {
  token: process.env.BOT_TOKEN,
  name: process.env.BOT_NAME || 'Guardian Bot',
  status: process.env.BOT_STATUS || 'Protecting the server',
  prefix: process.env.BOT_PREFIX || '!',
  logChannelId: process.env.LOG_CHANNEL_ID,
  modRoleId: process.env.MOD_ROLE_ID,
  antiNuke: {
    banLimit: parseInt(process.env.ANTI_NUKE_BAN_LIMIT) || 3,
    kickLimit: parseInt(process.env.ANTI_NUKE_KICK_LIMIT) || 3,
    channelLimit: parseInt(process.env.ANTI_NUKE_CHANNEL_LIMIT) || 3,
    roleLimit: parseInt(process.env.ANTI_NUKE_ROLE_LIMIT) || 3,
  },
  antiSpam: {
    messageLimit: parseInt(process.env.SPAM_MESSAGE_LIMIT) || 5,
    timeWindow: parseInt(process.env.SPAM_TIME_WINDOW) || 5000,
  },
  welcomeDM: {
    title: process.env.WELCOME_DM_TITLE || 'Welcome!',
    message: process.env.WELCOME_DM_MESSAGE || 'Hey {user}, welcome to {server}!',
  },
  points: {
    perDay: parseInt(process.env.POINTS_PER_DAY) || 5,
    checkInterval: parseInt(process.env.POINTS_CHECK_INTERVAL) || 86400000,
    offlineWarning: process.env.OFFLINE_WARNING_MESSAGE || 'Hey {user}, you haven\'t been active!',
  },
};

// ---------- CLIENT SETUP ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildPresences,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember],
});

// ---------- IN-MEMORY STORAGE ----------
const spamTracker = new Map();       // userId -> { count, lastMessage, timestamps }
const nukeTracker = new Map();       // guildId -> { bans, kicks, channels, roles, timestamps }
const userPoints = new Map();        // userId -> { points, lastSeen, lastPointsGiven }
const warnedUsers = new Set();       // userIds who got offline warning

// ---------- UTILITY: LOGGING ----------
async function sendLog(guild, title, description, color = 0x5865F2, fields = []) {
  if (!CONFIG.logChannelId) return;
  try {
    const logChannel = guild.channels.cache.get(CONFIG.logChannelId);
    if (!logChannel) return;

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(description)
      .setColor(color)
      .setTimestamp()
      .setFooter({ text: CONFIG.name });

    if (fields.length) embed.addFields(fields);

    await logChannel.send({ embeds: [embed] });
  } catch (err) {
    console.error('Log error:', err);
  }
}

// ---------- ANIMATED EMBED HELPER ----------
function createRainbowEmbed(title, description, fields = []) {
  const colors = [0xFF0000, 0xFF7F00, 0xFFFF00, 0x00FF00, 0x0000FF, 0x4B0082, 0x9400D3];
  const color = colors[Math.floor(Math.random() * colors.length)];

  const embed = new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(color)
    .setTimestamp()
    .setFooter({ text: CONFIG.name });

  if (fields.length) embed.addFields(fields);
  return embed;
}

// ============================================================
// 1. ANTI-SPAM SYSTEM
// ============================================================
async function handleAntiSpam(message) {
  if (!message.guild || message.author.bot) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();

  if (!spamTracker.has(userId)) {
    spamTracker.set(userId, { timestamps: [] });
  }

  const tracker = spamTracker.get(userId);
  tracker.timestamps = tracker.timestamps.filter(t => now - t < CONFIG.antiSpam.timeWindow);
  tracker.timestamps.push(now);

  // Duplicate message check
  const content = message.content.toLowerCase();
  if (tracker.lastMessage === content && tracker.duplicateCount >= 2) {
    await message.delete().catch(() => {});
    await message.member.timeout(5 * 60 * 1000, 'Duplicate message spam').catch(() => {});
    await sendLog(message.guild, '🚨 Anti-Spam Triggered', `**User:** ${message.author.tag}\n**Reason:** Duplicate message spam`);
    return;
  }
  tracker.lastMessage = content;
  tracker.duplicateCount = (tracker.duplicateCount || 0) + 1;

  // Flood check
  if (tracker.timestamps.length > CONFIG.antiSpam.messageLimit) {
    await message.delete().catch(() => {});
    await message.member.timeout(5 * 60 * 1000, 'Message flood').catch(() => {});
    tracker.timestamps = [];
    await sendLog(message.guild, '🚨 Anti-Spam Triggered', `**User:** ${message.author.tag}\n**Reason:** Message flood`);
  }
}

// ============================================================
// 2. ANTI-NUKE SYSTEM
// ============================================================
async function handleAntiNuke(guild, executorId, action, limit) {
  if (!guild) return;

  const guildId = guild.id;
  if (!nukeTracker.has(guildId)) {
    nukeTracker.set(guildId, { bans: [], kicks: [], channels: [], roles: [] });
  }

  const tracker = nukeTracker.get(guildId);
  const now = Date.now();

  if (!tracker[action]) tracker[action] = [];
  tracker[action] = tracker[action].filter(t => now - t < 10000);
  tracker[action].push(now);

  if (tracker[action].length >= limit) {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

    await member.ban({ reason: 'Anti-Nuke: Mass action detected' }).catch(() => {});
    await sendLog(guild, '💥 Anti-Nuke Triggered', `**User:** ${member.user.tag}\n**Action:** ${action}\n**Count:** ${tracker[action].length}`);
    tracker[action] = [];
  }
}

// ============================================================
// 3. LINK BLOCKER
// ============================================================
async function handleLinkBlocker(message) {
  if (!message.guild || message.author.bot) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/.+[a-z]/gi;

  if (inviteRegex.test(message.content)) {
    await message.delete().catch(() => {});
    const warning = await message.channel.send({
      embeds: [
        new EmbedBuilder()
          .setColor(0xFF0000)
          .setDescription(`⚠️ ${message.author}, you are not allowed to post invite links here!`)
      ]
    });
    setTimeout(() => warning.delete().catch(() => {}), 5000);
    await sendLog(message.guild, '🔗 Link Blocked', `**User:** ${message.author.tag}\n**Message:** ${message.content}`);
  }
}

// ============================================================
// 4. WELCOME DM
// ============================================================
async function handleWelcomeDM(member) {
  try {
    const title = CONFIG.welcomeDM.title.replace('{server}', member.guild.name);
    const message = CONFIG.welcomeDM.message
      .replace('{user}', member.user.username)
      .replace('{server}', member.guild.name);

    const embed = new EmbedBuilder()
      .setTitle(title)
      .setDescription(message)
      .setColor(0x00FF00)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp();

    await member.send({ embeds: [embed] });
  } catch (err) {
    // User has DMs closed
  }
}

// ============================================================
// 5. POINTS SYSTEM
// ============================================================
function handlePointsActivity(userId) {
  const now = Date.now();
  if (!userPoints.has(userId)) {
    userPoints.set(userId, { points: 0, lastSeen: now, lastPointsGiven: 0 });
  }

  const data = userPoints.get(userId);
  data.lastSeen = now;

  if (now - data.lastPointsGiven >= 86400000) {
    data.points += CONFIG.points.perDay;
    data.lastPointsGiven = now;
    warnedUsers.delete(userId);
  }
}

async function checkInactiveUsers(guild) {
  const now = Date.now();

  for (const [userId, data] of userPoints.entries()) {
    if (now - data.lastSeen > 172800000 && !warnedUsers.has(userId)) {
      try {
        const member = await guild.members.fetch(userId).catch(() => null);
        if (!member) continue;

        const warning = CONFIG.points.offlineWarning
          .replace('{user}', member.user.username)
          .replace('{server}', guild.name);

        const embed = new EmbedBuilder()
          .setTitle('🌟 Your Friends Are Waiting!')
          .setDescription(warning)
          .setColor(0xFFA500)
          .setTimestamp();

        await member.send({ embeds: [embed] }).catch(() => {});
        warnedUsers.add(userId);
      } catch (err) {
        // Ignore
      }
    }
  }
}

// ============================================================
// 6. MODERATION COMMANDS
// ============================================================
async function handleModeration(message) {
  if (!message.guild || message.author.bot) return;
  if (!message.content.startsWith(CONFIG.prefix)) return;
  if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers)) return;

  const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();
  const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);

  const modCommands = {
    kick: async () => {
      if (!target) return message.reply('Please mention a user to kick.');
      await target.kick('Moderator action');
      await message.reply({ embeds: [createRainbowEmbed('✅ User Kicked', `${target.user.tag} has been kicked.`)] });
    },

    ban: async () => {
      if (!target) return message.reply('Please mention a user to ban.');
      await target.ban({ reason: 'Moderator action' });
      await message.reply({ embeds: [createRainbowEmbed('✅ User Banned', `${target.user.tag} has been banned.`)] });
    },

    timeout: async () => {
      if (!target) return message.reply('Please mention a user to timeout.');
      const duration = parseInt(args[1]) || 600000;
      await target.timeout(duration, 'Moderator action');
      await message.reply({ embeds: [createRainbowEmbed('✅ User Timed Out', `${target.user.tag} timed out for ${duration / 60000} minutes.`)] });
    },

    untimeout: async () => {
      if (!target) return message.reply('Please mention a user.');
      await target.timeout(null, 'Moderator action');
      await message.reply({ embeds: [createRainbowEmbed('✅ Timeout Removed', `${target.user.tag} can now speak.`)] });
    },

    unban: async () => {
      const userId = args[0];
      if (!userId) return message.reply('Please provide a user ID.');
      await message.guild.bans.remove(userId);
      await message.reply({ embeds: [createRainbowEmbed('✅ User Unbanned', `User ${userId} has been unbanned.`)] });
    },
  };

  if (modCommands[command]) {
    await modCommands[command]().catch(err => message.reply(`Error: ${err.message}`));
  }
}

// ============================================================
// EVENT: MESSAGE CREATE
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  handlePointsActivity(message.author.id);
  await handleLinkBlocker(message);
  await handleAntiSpam(message);
  await handleModeration(message);
});

// ============================================================
// EVENT: GUILD MEMBER ADD (Welcome DM)
// ============================================================
client.on('guildMemberAdd', async (member) => {
  await handleWelcomeDM(member);

  const guild = member.guild;
  await sendLog(guild, '👋 New Member', `${member.user.tag} joined the server.`);
});

// ============================================================
// EVENT: ANTI-NUKE (Audit Log)
// ============================================================
client.on('guildAuditLogEntryCreate', async (auditLogEntry, guild) => {
  const { action, executorId, targetId } = auditLogEntry;

  if (executorId === client.user.id) return;

  switch (action) {
    case AuditLogEvent.MemberBanAdd:
      await handleAntiNuke(guild, executorId, 'bans', CONFIG.antiNuke.banLimit);
      break;
    case AuditLogEvent.MemberKick:
      await handleAntiNuke(guild, executorId, 'kicks', CONFIG.antiNuke.kickLimit);
      break;
    case AuditLogEvent.ChannelDelete:
      await handleAntiNuke(guild, executorId, 'channels', CONFIG.antiNuke.channelLimit);
      break;
    case AuditLogEvent.RoleDelete:
      await handleAntiNuke(guild, executorId, 'roles', CONFIG.antiNuke.roleLimit);
      break;
  }
});

// ============================================================
// EVENT: READY
// ============================================================
client.once('ready', async () => {
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`📛 Name: ${CONFIG.name}`);
  console.log(`📊 Status: ${CONFIG.status}`);

  client.user.setActivity(CONFIG.status, { type: 'WATCHING' });

  // Start points check loop
  setInterval(async () => {
    for (const guild of client.guilds.cache.values()) {
      await checkInactiveUsers(guild);
    }
  }, CONFIG.points.checkInterval);

  // Send startup log
  for (const guild of client.guilds.cache.values()) {
    await sendLog(guild, '🚀 Bot Started', `**${CONFIG.name}** is now online and protecting the server!`);
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(CONFIG.token);
