const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');

function dateCourte(ms) {
  try {
    return new Date(ms).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return '—';
  }
}

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('avertissements')
    .setDescription('Affiche les avertissements d\'un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ModerateMembers)
    .addUserOption((o) => o.setName('membre').setDescription('Qui regarder ?').setRequired(true)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ModerateMembers);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const cible = interaction.options.getUser('membre');
    const liste = stockage.avertissements(interaction.guildId, cible.id);

    if (liste.length === 0) {
      return panneaux.ok(interaction, '📋 Aucun avertissement',
        `**${cible.tag}** a un dossier propre.`);
    }

    const lignes = liste.map((a, i) => (
      `**${i + 1}.** ${a.raison}\n   ↳ par ${a.par} le ${dateCourte(a.date)}`
    ));

    return panneaux.repondre(interaction, panneaux.info(
      `📋 ${liste.length} avertissement(s) — ${cible.tag}`,
      lignes.join('\n\n'),
    ));
  },
};
