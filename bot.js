// ============================================================
// ALL-IN-ONE DISCORD BOT — PREFIX (!) VERSION
// Help Menu | Moderation | Anti-Spam | Anti-Nuke | Points | Welcome
// ============================================================

require('dotenv').config();

const {
  Client,
  GatewayIntentBits,
  Partials,
  EmbedBuilder,
  PermissionFlagsBits,
  AuditLogEvent,
} = require('discord.js');

// ---------- CONFIG ----------
const CONFIG = {
  token: process.env.BOT_TOKEN,
  name: process.env.BOT_NAME || 'Guardian Bot',
  status: process.env.BOT_STATUS || 'Protecting the server',
  prefix: process.env.BOT_PREFIX || '!',
  logChannelId: process.env.LOG_CHANNEL_ID,
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
    offlineWarning: process.env.OFFLINE_WARNING_MESSAGE || 'Hey {user}, come back!',
  },
};

// ---------- CLIENT ----------
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

// ---------- STORAGE ----------
const spamTracker = new Map();
const nukeTracker = new Map();
const userPoints = new Map();
const warnedUsers = new Set();
const warnHistory = new Map();

// ============================================================
// HELPERS
// ============================================================
async function sendLog(guild, title, description, color = 0x5865F2, fields = []) {
  if (!CONFIG.logChannelId || CONFIG.logChannelId === '0') return;
  try {
    const ch = guild.channels.cache.get(CONFIG.logChannelId);
    if (!ch) return;
    const embed = new EmbedBuilder()
      .setTitle(title).setDescription(description).setColor(color)
      .setTimestamp().setFooter({ text: CONFIG.name });
    if (fields.length) embed.addFields(fields);
    await ch.send({ embeds: [embed] });
  } catch (e) { console.error(e); }
}

function animatedEmbed(title, description, color = 0x00FF88, fields = []) {
  const embed = new EmbedBuilder()
    .setTitle(title).setDescription(description).setColor(color)
    .setTimestamp().setFooter({ text: `✨ ${CONFIG.name}` });
  if (fields.length) embed.addFields(fields);
  return embed;
}

function errorEmbed(text) {
  return new EmbedBuilder()
    .setDescription(`❌ ${text}`).setColor(0xFF0000).setTimestamp();
}

// ============================================================
// HELP MENU (MAIN)
// ============================================================
function buildHelpMenu(guild) {
  const p = CONFIG.prefix;
  const icon = guild?.iconURL({ dynamic: true }) || client.user.displayAvatarURL();

  const embed = new EmbedBuilder()
    .setAuthor({
      name: `📖 ${CONFIG.name} — Help Menu`,
      iconURL: client.user.displayAvatarURL({ dynamic: true }),
    })
    .setTitle('✨ All Available Commands')
    .setDescription(
      `**${CONFIG.name}** — Full-featured bot for moderation, protection, points, and more.\n` +
      `**Prefix:** \`${p}\`\n\n` +
      `> 🎯 **Total Commands:** \`13\``
    )
    .setColor(0x5865F2)
    .setThumbnail(icon)
    .addFields(
      {
        name: '🛡️ **MODERATION**',
        value:
          `\`${p}kick @user [reason]\` — Kick a member\n` +
          `\`${p}ban @user [reason]\` — Ban a member\n` +
          `\`${p}unban USER_ID\` — Unban by ID\n` +
          `\`${p}timeout @user <min> [reason]\` — Timeout\n` +
          `\`${p}untimeout @user\` — Remove timeout\n` +
          `\`${p}warn @user <reason>\` — Warn a member\n` +
          `\`${p}warnings @user\` — View warnings\n` +
          `\`${p}clear <1-100>\` — Delete messages`,
        inline: false,
      },
      {
        name: '⭐ **POINTS & ACTIVITY**',
        value:
          `\`${p}points [@user]\` — Check points\n` +
          `\`${p}leaderboard\` — Top 10 users`,
        inline: false,
      },
      {
        name: 'ℹ️ **INFORMATION**',
        value:
          `\`${p}serverinfo\` — Server details\n` +
          `\`${p}userinfo [@user]\` — User details\n` +
          `\`${p}help\` — Show this menu`,
        inline: false,
      },
      {
        name: '🚨 **AUTOMATIC PROTECTION**',
        value:
          '🛡️ **Anti-Spam** — auto timeout on flood\n' +
          '💥 **Anti-Nuke** — auto ban on mass actions\n' +
          '🔗 **Anti-Link** — blocks invite links\n' +
          '👋 **Welcome DM** — greets new members\n' +
          '⭐ **Auto-Points** — rewards active users',
        inline: false,
      }
    )
    .setFooter({
      text: `✨ ${CONFIG.name} • Prefix: ${p}`,
      iconURL: client.user.displayAvatarURL(),
    })
    .setTimestamp();

  return embed;
}

// ============================================================
// ANTI-SPAM
// ============================================================
async function handleAntiSpam(message) {
  if (!message.guild || message.author.bot) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const userId = message.author.id;
  const now = Date.now();

  if (!spamTracker.has(userId)) spamTracker.set(userId, { timestamps: [] });
  const t = spamTracker.get(userId);
  t.timestamps = t.timestamps.filter(x => now - x < CONFIG.antiSpam.timeWindow);
  t.timestamps.push(now);

  if (t.timestamps.length > CONFIG.antiSpam.messageLimit) {
    await message.delete().catch(() => {});
    await message.member.timeout(5 * 60 * 1000, 'Message flood').catch(() => {});
    t.timestamps = [];
    await sendLog(message.guild, '🚨 Anti-Spam Triggered',
      `**User:** ${message.author.tag}\n**Reason:** Message flood`, 0xFF5555);
  }
}

// ============================================================
// ANTI-NUKE
// ============================================================
async function handleAntiNuke(guild, executorId, action, limit) {
  if (!guild) return;
  if (!nukeTracker.has(guild.id)) {
    nukeTracker.set(guild.id, { bans: [], kicks: [], channels: [], roles: [] });
  }
  const tr = nukeTracker.get(guild.id);
  const now = Date.now();
  if (!tr[action]) tr[action] = [];
  tr[action] = tr[action].filter(x => now - x < 10000);
  tr[action].push(now);

  if (tr[action].length >= limit) {
    const member = await guild.members.fetch(executorId).catch(() => null);
    if (!member) return;
    if (member.permissions.has(PermissionFlagsBits.Administrator)) return;

    await member.ban({ reason: 'Anti-Nuke: Mass action detected' }).catch(() => {});
    await sendLog(guild, '💥 Anti-Nuke Triggered',
      `**User:** ${member.user.tag}\n**Action:** ${action}\n**Count:** ${tr[action].length}`, 0xFF0000);
    tr[action] = [];
  }
}

// ============================================================
// LINK BLOCKER
// ============================================================
async function handleLinkBlocker(message) {
  if (!message.guild || message.author.bot) return;
  if (message.member.permissions.has(PermissionFlagsBits.ManageMessages)) return;

  const inviteRegex = /(https?:\/\/)?(www\.)?(discord\.(gg|io|me|li)|discordapp\.com\/invite|discord\.com\/invite)\/.+[a-z]/gi;

  if (inviteRegex.test(message.content)) {
    await message.delete().catch(() => {});
    const w = await message.channel.send({
      embeds: [animatedEmbed('🔗 Link Blocked',
        `${message.author}, you are not allowed to post invite links here!`, 0xFF0000)]
    });
    setTimeout(() => w.delete().catch(() => {}), 5000);
    await sendLog(message.guild, '🔗 Link Blocked',
      `**User:** ${message.author.tag}\n**Message:** ${message.content}`, 0xFFAA00);
  }
}

// ============================================================
// WELCOME DM
// ============================================================
async function handleWelcomeDM(member) {
  try {
    const title = CONFIG.welcomeDM.title.replace('{server}', member.guild.name);
    const msg = CONFIG.welcomeDM.message
      .replace('{user}', member.user.username)
      .replace('{server}', member.guild.name);

    const embed = new EmbedBuilder()
      .setTitle(`🎉 ${title}`)
      .setDescription(msg)
      .setColor(0x00FF88)
      .setThumbnail(member.user.displayAvatarURL({ dynamic: true }))
      .setTimestamp()
      .setFooter({ text: `✨ ${CONFIG.name}` });

    await member.send({ embeds: [embed] }).catch(() => {});
  } catch (e) {}
}

// ============================================================
// POINTS SYSTEM
// ============================================================
function handlePointsActivity(userId) {
  const now = Date.now();
  if (!userPoints.has(userId)) {
    userPoints.set(userId, { points: 0, lastSeen: now, lastPointsGiven: now });
  }
  const d = userPoints.get(userId);
  d.lastSeen = now;
  if (now - d.lastPointsGiven >= 86400000) {
    d.points += CONFIG.points.perDay;
    d.lastPointsGiven = now;
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
          .replace('{user}', `**${member.user.username}**`)
          .replace('{server}', `**${guild.name}**`);

        const embed = new EmbedBuilder()
          .setTitle('🌟 Your Friends Are Waiting!')
          .setDescription(warning)
          .setColor(0xFFA500)
          .setTimestamp()
          .setFooter({ text: `✨ ${CONFIG.name}` });

        await member.send({ embeds: [embed] }).catch(() => {});
        warnedUsers.add(userId);
      } catch (e) {}
    }
  }
}

// ============================================================
// MESSAGE CREATE (PREFIX COMMANDS)
// ============================================================
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  // Auto systems
  handlePointsActivity(message.author.id);
  await handleLinkBlocker(message);
  await handleAntiSpam(message);

  // Prefix check
  if (!message.content.startsWith(CONFIG.prefix)) return;

  const args = message.content.slice(CONFIG.prefix.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // ---------- !help ----------
  if (command === 'help') {
    return message.reply({ embeds: [buildHelpMenu(message.guild)] });
  }

  // ---------- !ping ----------
  if (command === 'ping') {
    const sent = await message.reply('🏓 Pinging...');
    const latency = sent.createdTimestamp - message.createdTimestamp;
    return sent.edit({
      content: null,
      embeds: [animatedEmbed('🏓 Pong!',
        `**Bot Latency:** \`${latency}ms\`\n**API Latency:** \`${Math.round(client.ws.ping)}ms\``,
        0x00FF88)]
    });
  }

  // ---------- !kick ----------
  if (command === 'kick') {
    if (!message.member.permissions.has(PermissionFlagsBits.KickMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission to kick.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user to kick.')] });
    if (!target.kickable) return message.reply({ embeds: [errorEmbed('I cannot kick this user.')] });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.kick(reason);

    await message.reply({
      embeds: [animatedEmbed('✅ User Kicked',
        `**${target.user.tag}** has been kicked.\n**Reason:** ${reason}`, 0xFF5555)]
    });
    await sendLog(message.guild, '👢 Kick',
      `**User:** ${target.user.tag}\n**By:** ${message.author.tag}\n**Reason:** ${reason}`, 0xFF5555);
    return;
  }

  // ---------- !ban ----------
  if (command === 'ban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission to ban.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user to ban.')] });
    if (!target.bannable) return message.reply({ embeds: [errorEmbed('I cannot ban this user.')] });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    await target.ban({ reason });

    await message.reply({
      embeds: [animatedEmbed('✅ User Banned',
        `**${target.user.tag}** has been banned.\n**Reason:** ${reason}`, 0xFF0000)]
    });
    await sendLog(message.guild, '🔨 Ban',
      `**User:** ${target.user.tag}\n**By:** ${message.author.tag}\n**Reason:** ${reason}`, 0xFF0000);
    return;
  }

  // ---------- !unban ----------
  if (command === 'unban') {
    if (!message.member.permissions.has(PermissionFlagsBits.BanMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const userId = args[0];
    if (!userId) return message.reply({ embeds: [errorEmbed('Please provide a user ID.')] });

    try {
      await message.guild.bans.remove(userId);
      await message.reply({
        embeds: [animatedEmbed('✅ User Unbanned', `User \`${userId}\` has been unbanned.`)]
      });
      await sendLog(message.guild, '✅ Unban', `**User ID:** ${userId}\n**By:** ${message.author.tag}`);
    } catch (e) {
      return message.reply({ embeds: [errorEmbed('Could not unban — user not banned?')] });
    }
    return;
  }

  // ---------- !timeout ----------
  if (command === 'timeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user.')] });
    if (!target.moderatable) return message.reply({ embeds: [errorEmbed('I cannot timeout this user.')] });

    const mins = parseInt(args[1]) || 10;
    if (mins < 1 || mins > 40320) return message.reply({ embeds: [errorEmbed('Minutes must be 1-40320.')] });
    const reason = args.slice(2).join(' ') || 'No reason provided';

    await target.timeout(mins * 60 * 1000, reason);

    await message.reply({
      embeds: [animatedEmbed('✅ User Timed Out',
        `**${target.user.tag}** timed out for **${mins} min**.\n**Reason:** ${reason}`, 0xFFAA00)]
    });
    await sendLog(message.guild, '⏱️ Timeout',
      `**User:** ${target.user.tag}\n**By:** ${message.author.tag}\n**Duration:** ${mins}m\n**Reason:** ${reason}`, 0xFFAA00);
    return;
  }

  // ---------- !untimeout ----------
  if (command === 'untimeout') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user.')] });

    await target.timeout(null, 'Timeout removed');
    await message.reply({
      embeds: [animatedEmbed('✅ Timeout Removed', `**${target.user.tag}** can now speak again.`)]
    });
    await sendLog(message.guild, '🕊️ Untimeout',
      `**User:** ${target.user.tag}\n**By:** ${message.author.tag}`);
    return;
  }

  // ---------- !warn ----------
  if (command === 'warn') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user.')] });

    const reason = args.slice(1).join(' ') || 'No reason provided';
    if (!warnHistory.has(target.id)) warnHistory.set(target.id, []);
    warnHistory.get(target.id).push({ reason, by: message.author.tag, time: Date.now() });

    await message.reply({
      embeds: [animatedEmbed('⚠️ User Warned',
        `**${target.user.tag}** has been warned.\n**Reason:** ${reason}`, 0xFFAA00)]
    });

    await target.send({
      embeds: [new EmbedBuilder()
        .setTitle('⚠️ You Have Been Warned')
        .setDescription(`You were warned in **${message.guild.name}**.\n**Reason:** ${reason}`)
        .setColor(0xFFAA00).setTimestamp().setFooter({ text: `✨ ${CONFIG.name}` })]
    }).catch(() => {});

    await sendLog(message.guild, '⚠️ Warn',
      `**User:** ${target.user.tag}\n**By:** ${message.author.tag}\n**Reason:** ${reason}`, 0xFFAA00);
    return;
  }

  // ---------- !warnings ----------
  if (command === 'warnings') {
    if (!message.member.permissions.has(PermissionFlagsBits.ModerateMembers))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const target = message.mentions.members.first() || message.guild.members.cache.get(args[0]);
    if (!target) return message.reply({ embeds: [errorEmbed('Please mention a user.')] });

    const list = warnHistory.get(target.id) || [];
    if (!list.length) {
      return message.reply({
        embeds: [animatedEmbed('📋 No Warnings', `**${target.user.tag}** has no warnings.`)]
      });
    }

    const fields = list.slice(0, 10).map((w, i) => ({
      name: `#${i + 1} — by ${w.by}`,
      value: `**Reason:** ${w.reason}\n**Date:** <t:${Math.floor(w.time / 1000)}:R>`,
    }));

    return message.reply({
      embeds: [animatedEmbed('📋 Warnings',
        `Total: **${list.length}** warning(s) for **${target.user.tag}**`, 0xFFAA00, fields)]
    });
  }

  // ---------- !clear ----------
  if (command === 'clear') {
    if (!message.member.permissions.has(PermissionFlagsBits.ManageMessages))
      return message.reply({ embeds: [errorEmbed('You don\'t have permission.')] });

    const amount = parseInt(args[0]);
    if (!amount || amount < 1 || amount > 100)
      return message.reply({ embeds: [errorEmbed('Amount must be 1-100.')] });

    await message.delete().catch(() => {});
    await message.channel.bulkDelete(amount, true).catch(() => {});

    const m = await message.channel.send({
      embeds: [animatedEmbed('🧹 Messages Cleared', `Deleted **${amount}** messages.`)]
    });
    setTimeout(() => m.delete().catch(() => {}), 3000);
    return;
  }

  // ---------- !points ----------
  if (command === 'points') {
    const target = message.mentions.users.first() || message.author;
    const data = userPoints.get(target.id);
    const pts = data ? data.points : 0;

    return message.reply({
      embeds: [animatedEmbed('⭐ Points',
        `**${target.username}** has **${pts}** points.`, 0xFFD700,
        [
          { name: '📊 Last Seen', value: data ? `<t:${Math.floor(data.lastSeen / 1000)}:R>` : 'No activity yet', inline: true },
          { name: '🎁 Daily Reward', value: `+${CONFIG.points.perDay} points/day`, inline: true },
        ])]
    });
  }

  // ---------- !leaderboard ----------
  if (command === 'leaderboard') {
    const sorted = [...userPoints.entries()]
      .sort((a, b) => b[1].points - a[1].points)
      .slice(0, 10);

    if (!sorted.length) {
      return message.reply({ embeds: [animatedEmbed('🏆 Leaderboard', 'No points recorded yet.', 0xFFD700)] });
    }

    const medals = ['🥇', '🥈', '🥉'];
    const lines = await Promise.all(sorted.map(async ([id, d], i) => {
      const u = await client.users.fetch(id).catch(() => null);
      const name = u ? u.username : `User ${id}`;
      const badge = medals[i] || `**#${i + 1}**`;
      return `${badge} **${name}** — \`${d.points}\` pts`;
    }));

    return message.reply({
      embeds: [animatedEmbed('🏆 Top 10 Leaderboard', lines.join('\n'), 0xFFD700)]
    });
  }

  // ---------- !serverinfo ----------
  if (command === 'serverinfo') {
    const g = message.guild;
    const embed = animatedEmbed('🌐 Server Information',
      `Details about **${g.name}**`, 0x5865F2,
      [
        { name: '👑 Owner', value: `<@${g.ownerId}>`, inline: true },
        { name: '🆔 Server ID', value: `\`${g.id}\``, inline: true },
        { name: '👥 Members', value: `${g.memberCount}`, inline: true },
        { name: '💬 Channels', value: `${g.channels.cache.size}`, inline: true },
        { name: '🎭 Roles', value: `${g.roles.cache.size}`, inline: true },
        { name: '😀 Emojis', value: `${g.emojis.cache.size}`, inline: true },
        { name: '📅 Created', value: `<t:${Math.floor(g.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '🚀 Boost Tier', value: `Tier ${g.premiumTier}`, inline: true },
      ]
    ).setThumbnail(g.iconURL({ dynamic: true }));

    return message.reply({ embeds: [embed] });
  }

  // ---------- !userinfo ----------
  if (command === 'userinfo') {
    const target = message.mentions.members.first() || message.member;
    const u = target.user;

    const embed = animatedEmbed('👤 User Information',
      `Details about **${u.tag}**`, 0x5865F2,
      [
        { name: '🆔 User ID', value: `\`${u.id}\``, inline: true },
        { name: '🤖 Bot', value: u.bot ? 'Yes' : 'No', inline: true },
        { name: '📅 Account Created', value: `<t:${Math.floor(u.createdTimestamp / 1000)}:R>`, inline: true },
        { name: '📥 Joined Server', value: target.joinedTimestamp ? `<t:${Math.floor(target.joinedTimestamp / 1000)}:R>` : 'Unknown', inline: true },
        { name: '🎭 Top Role', value: `${target.roles.highest}`, inline: true },
        { name: '📛 Nickname', value: target.nickname || 'None', inline: true },
      ]
    ).setThumbnail(u.displayAvatarURL({ dynamic: true }));

    return message.reply({ embeds: [embed] });
  }
});

// ============================================================
// GUILD MEMBER ADD (Welcome DM)
// ============================================================
client.on('guildMemberAdd', async (member) => {
  await handleWelcomeDM(member);
  await sendLog(member.guild, '👋 New Member',
    `${member.user.tag} joined the server.`, 0x00FF88);
});

// ============================================================
// ANTI-NUKE (Audit Log)
// ============================================================
client.on('guildAuditLogEntryCreate', async (entry, guild) => {
  const { action, executorId } = entry;
  if (executorId === client.user.id) return;

  switch (action) {
    case AuditLogEvent.MemberBanAdd:
      await handleAntiNuke(guild, executorId, 'bans', CONFIG.antiNuke.banLimit); break;
    case AuditLogEvent.MemberKick:
      await handleAntiNuke(guild, executorId, 'kicks', CONFIG.antiNuke.kickLimit); break;
    case AuditLogEvent.ChannelDelete:
      await handleAntiNuke(guild, executorId, 'channels', CONFIG.antiNuke.channelLimit); break;
    case AuditLogEvent.RoleDelete:
      await handleAntiNuke(guild, executorId, 'roles', CONFIG.antiNuke.roleLimit); break;
  }
});

// ============================================================
// READY
// ============================================================
client.once('ready', async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`✅ ${client.user.tag} is online!`);
  console.log(`📛 Name: ${CONFIG.name}`);
  console.log(`📊 Status: ${CONFIG.status}`);
  console.log(`🔤 Prefix: ${CONFIG.prefix}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  client.user.setActivity(CONFIG.status, { type: 3 });

  setInterval(async () => {
    for (const g of client.guilds.cache.values()) {
      await checkInactiveUsers(g);
    }
  }, CONFIG.points.checkInterval);

  for (const g of client.guilds.cache.values()) {
    await sendLog(g, '🚀 Bot Started',
      `**${CONFIG.name}** is now online!\n**Prefix:** \`${CONFIG.prefix}\`\nType \`${CONFIG.prefix}help\` for commands.`,
      0x00FF88);
  }
});

// ============================================================
// LOGIN
// ============================================================
client.login(CONFIG.token);
