const { SlashCommandBuilder, PermissionsBitField, MessageFlags,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const sanctions = require('../utils/sanctions');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('mute')
    .setDescription('Empêche quelqu\'un d\'écrire pendant une durée (exclusion temporaire)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('La personne à mettre en sourdine').setRequired(true))
    .addStringOption((o) => o
      .setName('duree')
      .setDescription('Combien de temps ? Exemples : 10m, 2h, 3j (max 28 jours)')
      .setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Pourquoi').setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ModerateMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getMember('membre');
    const probleme = perms.peutSanctionner(interaction.member, cible);
    if (probleme) return panneaux.oups(interaction, '🚫 Action impossible', probleme);

    const saisie = interaction.options.getString('duree');
    const ms = perms.dureeEnMs(saisie);
    if (!ms) {
      return panneaux.oups(interaction, '⏱️ Durée mal écrite',
        "Écris par exemple **10m** (10 minutes), **2h** (2 heures) ou **3j** (3 jours). Minimum 5 secondes, maximum 28 jours.");
    }

    const raison = perms.propreRaison(interaction.options.getString('raison'));
    const duree = perms.dureeLisible(ms);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const resultat = await sanctions.rendreMuet(cible, {
      raison, auteur: interaction.user.tag, ms, dureeLisible: duree,
    });
    if (!resultat.ok) {
      return interaction.editReply({
        embeds: [panneaux.erreur('❌ Le mute a échoué',
          'Discord a refusé : j\'ai besoin de la permission « Exclure temporairement des membres » et d\'un rôle au-dessus du sien.')],
      }).catch(() => null);
    }

    return interaction.editReply({
      embeds: [panneaux.succes('🔇 Membre en sourdine',
        `**${cible.user.tag}** ne peut plus écrire pendant **${duree}**.\n**Raison :** ${raison}\n`
        + (resultat.mp ? '' : "_La personne n'a pas pu être prévenue en message privé._"))],
    }).catch(() => null);
  },
};
