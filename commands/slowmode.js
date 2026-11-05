const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('slowmode')
    .setDescription('Ralentit l\'envoi de messages dans ce salon')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageChannels)
    .addIntegerOption((o) => o
      .setName('secondes')
      .setDescription('Délai entre deux messages (0 = désactivé, max 21600)')
      .setMinValue(0).setMaxValue(21600).setRequired(true)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageChannels);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const secondes = interaction.options.getInteger('secondes');
    try {
      await interaction.channel.setRateLimitPerUser(secondes, `${interaction.user.tag}`);
    } catch {
      return panneaux.oups(interaction, '❌ Impossible de régler le mode lent',
        "Il me manque la permission « Gérer les salons » sur ce salon.");
    }

    if (secondes === 0) {
      return panneaux.ok(interaction, '⚡ Mode lent désactivé',
        'Tout le monde peut de nouveau écrire normalement.');
    }
    return panneaux.ok(interaction, '🐢 Mode lent activé',
      `Chacun devra attendre **${secondes} seconde(s)** entre deux messages.`);
  },
};
