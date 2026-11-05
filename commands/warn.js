const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const sanctions = require('../utils/sanctions');
const stockage = require('../utils/stockage');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Donne un avertissement officiel à un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('La personne à avertir').setRequired(true))
    .addStringOption((o) => o.setName('raison').setDescription('Ce qui est reproché').setRequired(true)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ModerateMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getMember('membre');
    const probleme = perms.peutSanctionner(interaction.member, cible, { ignorerHierarchie: false });
    if (probleme) return panneaux.oups(interaction, '🚫 Action impossible', probleme);

    const raison = perms.propreRaison(interaction.options.getString('raison'));
    await interaction.deferReply({ ephemeral: true });

    const liste = stockage.ajouterAvert(interaction.guildId, cible.id, {
      raison,
      par: interaction.user.tag,
      date: Date.now(),
    });
    await sanctions.avertir(cible, { raison, auteur: interaction.user.tag, nombre: liste.length });

    const palier = liste.length >= 3
      ? '\n\n⚠️ **3 avertissements atteints** : pense à un mute ou un ban si ça continue.'
      : '';

    return interaction.editReply({
      embeds: [panneaux.succes('⚠️ Avertissement enregistré',
        `**${cible.user.tag}** a maintenant **${liste.length} avertissement(s)**.\n**Raison :** ${raison}${palier}`)],
    }).catch(() => null);
  },
};
