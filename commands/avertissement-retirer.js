const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('avertissement-retirer')
    .setDescription('Retire un avertissement (numéro affiché dans /avertissements)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('La personne concernée').setRequired(true))
    .addIntegerOption((o) => o
      .setName('numero')
      .setDescription('Le numéro de l\'avertissement à retirer')
      .setMinValue(1).setRequired(true)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ModerateMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getUser('membre');
    const numero = interaction.options.getInteger('numero');
    const resultat = stockage.retirerAvert(interaction.guildId, cible.id, numero - 1);

    if (!resultat.ok) {
      return panneaux.oups(interaction, '🔍 Avertissement introuvable',
        `**${cible.tag}** n'a pas d'avertissement n°${numero}. Utilise \`/avertissements\` pour voir la liste à jour.`);
    }

    return panneaux.ok(interaction, '✅ Avertissement retiré',
      `« ${resultat.retire.raison} » a été retiré à **${cible.tag}**.\nIl lui reste **${resultat.liste.length}** avertissement(s).`);
  },
};
