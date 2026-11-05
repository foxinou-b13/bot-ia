/**
 * commands/donnees.js — le droit des membres sur leurs données (RGPD + règles Discord).
 *
 * /donnees           → ce que le bot garde sur toi, dans ce serveur
 * /donnees supprimer → efface tes avertissements + ta mémoire de conversation
 */
const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const stockage = require('../utils/stockage');
const panneaux = require('../utils/panneaux');
const ia = require('../utils/ia');

module.exports = {
  categorie: 'utilisateurs',

  data: new SlashCommandBuilder()
    .setName('donnees')
    .setDescription('Voir ou effacer les données que le bot garde sur toi dans ce serveur')
    .addStringOption((o) => o
      .setName('action')
      .setDescription('Que veux-tu faire ?')
      .setChoices(
        { name: '👀 Voir mes données', value: 'voir' },
        { name: '🗑️ Tout effacer me concernant', value: 'supprimer' },
      )),

  async executer(interaction) {
    const action = interaction.options.getString('action') || 'voir';
    const moi = interaction.user;
    const stocke = stockage.avertissements(interaction.guildId, moi.id) || [];

    if (action === 'voir') {
      const lignes = [
        `**Avertissements** : ${stocke.length}${stocke.length ? '' : ' (rien, bravo)'}`,
        '**Conversations IA** : mémoire temporaire du salon, jamais stockée sur disque',
        '**Message envoyé à une IA** : supprimé de la mémoire du bot au redémarrage',
        '',
        '_Le bot ne garde pas de copie de tes messages, ni d\'e-mail, ni de nom réel._',
      ].join('\n');
      return panneaux.repondre(
        interaction,
        panneaux.info(`👀 Tes données sur ${interaction.guild.name}`, lignes),
        { ephemere: true },
      );
    }

    // ─── suppression ───
    const retires = stockage.effacerAvertissements(interaction.guildId, moi.id);
    ia.oublierMembre(interaction.user.id);

    return panneaux.repondre(
      interaction,
      panneaux.succes('🗑️ Effacé',
        `${retires} avertissement(s) supprimé(s) te concernant${retires ? '' : ' — tu n\'en avais aucun'}.\n`
        + 'Tes échanges avec l\'IA ne sont pas conservés sur disque : rien d\'autre à effacer.\n\n'
        + '_Si un modérateur souhaite tout de même garder une trace, c\'est son droit de re-supprimer tes données via ses commandes._'),
      { ephemere: true },
    );
  },
};
