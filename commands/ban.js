const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const sanctions = require('../utils/sanctions');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannit définitivement un membre du serveur')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.BanMembers)
    .addUserOption((o) => o.setName('membre').setDescription('La personne à bannir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Pourquoi (visible dans les logs)').setRequired(false))
    .addIntegerOption((o) => o
      .setName('messages')
      .setDescription('Supprimer aussi ses messages des N derniers jours (0 à 7)')
      .setMinValue(0).setMaxValue(7).setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.BanMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getMember('membre');
    const probleme = perms.peutSanctionner(interaction.member, cible);
    if (probleme) return panneaux.oups(interaction, '🚫 Action impossible', probleme);
    if (!perms.botPeut(interaction.guild, PermissionsBitField.Flags.BanMembers)) {
      return panneaux.oups(interaction, '🚫 Il me manque une permission', perms.MESSAGE_BOT_SANS_PERMISSION);
    }

    const raison = perms.propreRaison(interaction.options.getString('raison'));
    const jours = interaction.options.getInteger('messages') ?? 0;

    await interaction.deferReply({ ephemeral: true });

    const resultat = await sanctions.bannir(cible, {
      raison,
      auteur: interaction.user.tag,
      joursMessages: jours,
    });

    if (!resultat.ok) {
      return interaction.editReply({
        embeds: [panneaux.erreur('❌ Le bannissement a échoué',
          `Discord a refusé l'action : mon rôle est peut-être trop bas.`)],
      }).catch(() => null);
    }

    return interaction.editReply({
      embeds: [panneaux.succes('🔨 Membre banni',
        `**${cible.user.tag}** a été banni.\n**Raison :** ${raison}\n`
        + (resultat.mp ? '' : "_La personne n'a pas pu être prévenue en message privé (MP fermés)._"))],
    }).catch(() => null);
  },
};
