const { SlashCommandBuilder, PermissionsBitField, MessageFlags,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const sanctions = require('../utils/sanctions');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription("Expulse un membre (il peut revenir avec une invitation)")
    .setDefaultMemberPermissions(PermissionsBitField.Flags.KickMembers)
    .addUserOption((o) => o.setName('membre').setDescription('La personne à expulser').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Pourquoi').setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.KickMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getMember('membre');
    const probleme = perms.peutSanctionner(interaction.member, cible);
    if (probleme) return panneaux.oups(interaction, '🚫 Action impossible', probleme);
    if (!perms.botPeut(interaction.guild, PermissionsBitField.Flags.KickMembers)) {
      return panneaux.oups(interaction, '🚫 Il me manque une permission', perms.MESSAGE_BOT_SANS_PERMISSION);
    }

    const raison = perms.propreRaison(interaction.options.getString('raison'));
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const resultat = await sanctions.expulser(cible, { raison, auteur: interaction.user.tag });
    if (!resultat.ok) {
      return interaction.editReply({
        embeds: [panneaux.erreur('❌ L\'expulsion a échoué',
          'Discord a refusé : vérifie que mon rôle est au-dessus de celui de la personne.')],
      }).catch(() => null);
    }

    return interaction.editReply({
      embeds: [panneaux.succes('👢 Membre expulsé',
        `**${cible.user.tag}** a été expulsé.\n**Raison :** ${raison}\n`
        + (resultat.mp ? '' : "_La personne n'a pas pu être prévenue en message privé._"))],
    }).catch(() => null);
  },
};
