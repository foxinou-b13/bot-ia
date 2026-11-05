const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const ia = require('../utils/ia');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');

module.exports = {
  categorie: 'ia',
  data: new SlashCommandBuilder()
    .setName('ia-reset')
    .setDescription('Efface la mémoire de l\'IA dans ce salon (elle repart de zéro)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageMessages);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    ia.oublier(interaction.guildId, interaction.channelId);
    return panneaux.ok(interaction, '🧠 Mémoire effacée',
      'Je ne me souviens plus de la conversation précédente dans ce salon.');
  },
};
