const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');

const MESSAGE_DEFAUT = 'Bienvenue {membre} sur **{serveur}** ! Tu es notre {nombre}e membre.';

module.exports = {
  categorie: 'configuration',
  data: new SlashCommandBuilder()
    .setName('bienvenue')
    .setDescription('Configure le message de bienvenue des nouveaux membres')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addChannelOption((o) => o
      .setName('salon')
      .setDescription('Où souhaiter la bienvenue (vide = désactiver)')
      .setRequired(false))
    .addStringOption((o) => o
      .setName('message')
      .setDescription('Ton message ({membre}, {serveur}, {nombre} sont remplacés automatiquement)')
      .setMaxLength(500)
      .setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const salon = interaction.options.getChannel('salon');
    const message = interaction.options.getString('message');
    const actuels = stockage.reglages(interaction.guildId).bienvenue;

    if (!salon && !message) {
      const etat = actuels.salon
        ? `Salon : <#${actuels.salon}>\nMessage : ${actuels.message || MESSAGE_DEFAUT}`
        : 'Les messages de bienvenue sont **désactivés**.';
      return panneaux.repondre(interaction, panneaux.info('👋 Message de bienvenue', etat));
    }

    if (!salon) {
      stockage.majReglages(interaction.guildId, { bienvenue: { salon: null } });
      return panneaux.ok(interaction, '🔕 Bienvenue désactivée',
        'Le bot ne souhaitera plus la bienvenue.');
    }

    stockage.majReglages(interaction.guildId, {
      bienvenue: { salon: salon.id, message: message || actuels.message || MESSAGE_DEFAUT },
    });

    return panneaux.ok(interaction, '👋 Bienvenue activée',
      `Les nouveaux membres seront accueillis dans <#${salon.id}>.\n`
      + `**Message :** ${message || actuels.message || MESSAGE_DEFAUT}\n`
      + '_Variables : `{membre}`, `{serveur}`, `{nombre}`._');
  },
};
