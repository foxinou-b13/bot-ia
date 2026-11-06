const { SlashCommandBuilder, PermissionsBitField, MessageFlags,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('clear')
    .setDescription('Supprime des messages d\'un coup (1 à 100)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageMessages)
    .addIntegerOption((o) => o
      .setName('nombre')
      .setDescription('Combien de messages ? (1 à 100)')
      .setMinValue(1).setMaxValue(100).setRequired(true))
    .addUserOption((o) => o
      .setName('membre')
      .setDescription('Ne supprimer que les messages de cette personne')
      .setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageMessages);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const nombre = interaction.options.getInteger('nombre');
    const filtre = interaction.options.getUser('membre');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const salon = interaction.channel;
    let supprimes = 0;

    try {
      if (filtre) {
        // On récupère un peu plus large pour trouver assez de messages de la personne.
        const recents = await salon.messages.fetch({ limit: 100 });
        const aSupprimer = [...recents.values()]
          .filter((m) => m.author?.id === filtre.id)
          .slice(0, nombre);
        if (aSupprimer.length === 0) {
          return interaction.editReply({
            embeds: [panneaux.attention('🔍 Rien à supprimer',
              `Je n'ai trouvé aucun message récent de **${filtre.tag}** dans ce salon.`)],
          }).catch(() => null);
        }
        const resultat = await salon.bulkDelete(aSupprimer, true);
        supprimes = resultat.size;
      } else {
        const resultat = await salon.bulkDelete(nombre, true);
        supprimes = resultat.size;
      }
    } catch (erreur) {
      return interaction.editReply({
        embeds: [panneaux.erreur('❌ Suppression impossible',
          "Discord bloque la suppression groupée des messages de plus de 14 jours, et j'ai besoin de la permission « Gérer les messages ».")],
      }).catch(() => null);
    }

    await journaliser(interaction.guild, {
      type: 'auto', titre: '🧹 Messages supprimés',
      auteur: interaction.user.tag,
      details: `${supprimes} message(s) dans <#${salon.id}>${filtre ? ` (uniquement ${filtre.tag})` : ''}`,
    });

    return interaction.editReply({
      embeds: [panneaux.succes('🧹 Salon nettoyé',
        `**${supprimes}** message(s) supprimé(s) dans <#${salon.id}>.`
        + (filtre ? `\nFiltre : uniquement **${filtre.tag}**.` : ''))],
    }).catch(() => null);
  },
};
