const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'configuration',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Choisit le salon où le bot note les sanctions et actions')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addChannelOption((o) => o
      .setName('salon')
      .setDescription('Le salon des logs (laisse vide pour désactiver)')
      .setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const salon = interaction.options.getChannel('salon');

    if (!salon) {
      stockage.majReglages(interaction.guildId, { logs: null });
      return panneaux.ok(interaction, '🔕 Logs désactivés',
        'Le bot ne notera plus les sanctions.');
    }

    stockage.majReglages(interaction.guildId, { logs: salon.id });
    await journaliser(interaction.guild, {
      type: 'ok', titre: '⚙️ Logs configurés',
      auteur: interaction.user.tag,
      details: 'Les prochaines actions de modération apparaîtront ici.',
    });

    return panneaux.ok(interaction, '📋 Salon des logs enregistré',
      `Toutes les sanctions seront notées dans <#${salon.id}>.`);
  },
};
