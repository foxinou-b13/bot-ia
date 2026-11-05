const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('lock')
    .setDescription('Verrouille ce salon : plus personne ne peut écrire (sauf le staff)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageChannels);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    try {
      const everyone = interaction.guild.roles.everyone;
      await interaction.channel.permissionOverwrites.edit(everyone, {
        SendMessages: false,
        AddReactions: false,
      }, { reason: `Verrouillage par ${interaction.user.tag}` });
    } catch {
      return panneaux.oups(interaction, '❌ Impossible de verrouiller',
        "Il me manque la permission « Gérer les salons » sur ce salon.");
    }

    await journaliser(interaction.guild, {
      type: 'auto', titre: '🔒 Salon verrouillé',
      auteur: interaction.user.tag, details: `<#${interaction.channel.id}>`,
    });

    return panneaux.ok(interaction, '🔒 Salon verrouillé',
      'Les membres ne peuvent plus écrire ici. Le staff garde l\'accès.');
  },
};
