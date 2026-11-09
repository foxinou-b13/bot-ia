const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'configuration',
  data: new SlashCommandBuilder()
    .setName('logs')
    .setDescription('Le salon où le bot note sanctions, auto-mod, suppressions, modifications et départs')
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
      return panneaux.ok(interaction, '🔕 Journal désactivé',
        'Le bot ne notera plus rien (ni sanctions, ni suppressions, ni départs).');
    }

    stockage.majReglages(interaction.guildId, { logs: salon.id });
    await journaliser(interaction.guild, {
      type: 'ok', titre: '⚙️ Logs configurés',
      auteur: interaction.user.tag,
      details: 'Les prochaines actions de modération apparaîtront ici.',
    });

    return panneaux.ok(interaction, '📋 Journal du staff enregistré',
      `Sanctions, alertes d\u2019auto-modération et traces (suppressions, modifications, départs) seront notées dans <#${salon.id}>.`);
  },
};
