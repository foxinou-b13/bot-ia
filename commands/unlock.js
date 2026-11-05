const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('unlock')
    .setDescription('Déverrouille ce salon')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageChannels);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    try {
      const everyone = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: null,
        AddReactions: null,
      }, { reason: `Déverrouillage par ${interaction.user.tag}` });
    } catch {
      return panneaux.oups(interaction, '❌ Impossible de déverrouiller',
        "Il me manque la permission « Gérer les salons » sur ce salon.");
    }

    await journaliser(interaction.guild, {
      type: 'ok', titre: '🔓 Salon déverrouillé',
      auteur: interaction.user.tag, details: `<#${interaction.channel.id}>`,
    });

    return panneaux.ok(interaction, '🔓 Salon déverrouillé',
      'Les membres peuvent de nouveau écrire.');
  },
};
