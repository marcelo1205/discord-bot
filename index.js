const { Client, GatewayIntentBits, Partials, Events, ActionRowBuilder, StringSelectMenuBuilder, PermissionsBitField, ButtonBuilder, ButtonStyle } = require('discord.js');
require('dotenv').config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMessageReactions,
  ],
  partials: [Partials.Message, Partials.Channel, Partials.Reaction],
});

// ✅ Rôles autorisés pour les requêtes
const allowedRoles = ['AOO Team', 'Verified RSS Seller', 'Pilot', '3384 Member'];
// ✅ Utilisateurs autorisés à lancer un retrait de rôle global (IDs)
const authorizedUsers = ['240843764262764544', '696791054321713173']; // Remplace avec vos IDs Discord
// 🔐 Stockage temporaire des confirmations
const pendingRemovals = new Map();

client.once(Events.ClientReady, () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;

  // 📌 !help command
  if (message.content === '!help-autobot') {
    return message.reply(`📌 **Role Request Bot Help**

- Use \`!request-role\` to ask for a role via dropdown.()
- Use \`!remove-role-everyone\` (restricted) to remove a role from all members. Requires 2 confirmations.

Roles must be in the allowed list or be visible to the bot.`);
  }

  // 📋 !request-role command
  if (message.content === '!request-role') {
    const roles = message.guild.roles.cache
      .filter(role => allowedRoles.includes(role.name))
      .map(role => ({ label: role.name, value: role.name }));

    if (roles.length === 0) return message.reply('❗ No roles available for request.');

    const menu = new StringSelectMenuBuilder()
      .setCustomId('select-role')
      .setPlaceholder('Select the role you want to request')
      .addOptions(roles.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(menu);

    await message.reply({ content: '📋 Choose the role you want to request:', components: [row] });
  }

  // ❌ !remove-role-everyone command
  if (message.content === '!remove-role-everyone') {
    if (!authorizedUsers.includes(message.author.id)) {
      return message.reply('⛔ You are not authorized to use this command.');
    }

    const roles = message.guild.roles.cache
      .filter(role => role.name !== '@everyone' && !role.managed)
      .map(role => ({ label: role.name, value: role.id }));

    if (roles.length === 0) return message.reply('❗ No roles available to remove.');

    const menu = new StringSelectMenuBuilder()
      .setCustomId('remove-role-menu')
      .setPlaceholder('Select a role to remove from everyone')
      .addOptions(roles.slice(0, 25));

    const row = new ActionRowBuilder().addComponents(menu);

    await message.reply({ content: '⚠️ Select the role to remove from all members:', components: [row] });
  }
});

client.on(Events.InteractionCreate, async interaction => {
  // ✅ Role request menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'select-role') {
    const roleName = interaction.values[0];
    const channel = interaction.guild.channels.cache.find(c => c.name === 'role-request');
    if (!channel) {
      return interaction.reply({ content: '❗ The channel `role-request` does not exist.', ephemeral: true });
    }

    const requestMessage = await channel.send({
      content: `📥 **Role Request**\n> User ${interaction.user} requested the role \`${roleName}\`.\n> ✅ to approve, ❌ to deny.`,
    });

    await requestMessage.react('✅');
    await requestMessage.react('❌');

    await interaction.reply({ content: `✅ Your request for the role \`${roleName}\` has been sent to the admins.`, ephemeral: true });
  }

  // ❌ Role removal menu
  if (interaction.isStringSelectMenu() && interaction.customId === 'remove-role-menu') {
    const roleId = interaction.values[0];
    const role = interaction.guild.roles.cache.get(roleId);
    if (!role) return interaction.reply({ content: '❗ Role not found.', ephemeral: true });

    if (!authorizedUsers.includes(interaction.user.id)) {
      return interaction.reply({ content: '⛔ You are not authorized to confirm this action.', ephemeral: true });
    }

    const confirmationKey = `${interaction.guild.id}-${roleId}`;
    if (!pendingRemovals.has(confirmationKey)) {
      pendingRemovals.set(confirmationKey, new Set([interaction.user.id]));
      await interaction.reply(`⚠️ You have confirmed the removal of the role \`${role.name}\`. Waiting for one more authorized user.`);
    } else {
      const users = pendingRemovals.get(confirmationKey);
      users.add(interaction.user.id);
      if (users.size >= 2) {
        pendingRemovals.delete(confirmationKey);
        await interaction.reply(`🚨 Removing role \`${role.name}\` from all members...`);

        let removed = 0;
        const members = await interaction.guild.members.fetch();
        for (const member of members.values()) {
          if (member.roles.cache.has(roleId)) {
            try {
              await member.roles.remove(role);
              removed++;
            } catch (err) {
              console.error(`Failed to remove role from ${member.user.tag}:`, err);
            }
          }
        }

        await interaction.followUp(`✅ Done. Removed \`${role.name}\` from ${removed} members.`);
      } else {
        await interaction.reply({ content: `⚠️ You have already confirmed. Waiting for another authorized user.`, ephemeral: true });
      }
    }
  }
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;

  if (reaction.partial) {
    try { await reaction.fetch(); } catch (err) { console.error(err); return; }
  }
  if (reaction.message.partial) {
    try { await reaction.message.fetch(); } catch (err) { console.error(err); return; }
  }

  if (reaction.message.channel.name !== 'role-request') return;
  if (!['✅', '❌'].includes(reaction.emoji.name)) return;

  const member = reaction.message.guild.members.cache.get(user.id);
  if (!member.permissions.has(PermissionsBitField.Flags.Administrator)) return;

  const roleNameMatch = reaction.message.content.match(/`(.+?)`/);
  const targetUser = reaction.message.mentions.users.first();
  if (!roleNameMatch || !targetUser) return;

  const roleName = roleNameMatch[1];
  const role = reaction.message.guild.roles.cache.find(r => r.name === roleName);
  const targetMember = reaction.message.guild.members.cache.get(targetUser.id);
  if (!role || !targetMember) return;

  if (reaction.emoji.name === '✅') {
    try {
      await targetMember.roles.add(role);
      reaction.message.channel.send(`✅ Role \`${roleName}\` granted to ${targetUser}.`);
    } catch (err) {
      console.error(err);
      reaction.message.channel.send(`❌ Failed to assign the role. Check bot permissions.`);
    }
  } else {
    reaction.message.channel.send(`❌ Request for role \`${roleName}\` denied for ${targetUser}.`);
  }
});

client.login(process.env.TOKEN);


