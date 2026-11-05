/**
 * commands/guide.js — les repères publics du serveur (pour TOUS les membres).
 * Règles, support/tickets, accueil : le bot répond « ici » au bon endroit,
 * et /ask utilise les mêmes infos quand on lui pose la question en langage naturel.
 */
const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const stockage = require('../utils/stockage');
const panneaux = require('../utils/panneaux');

module.exports = {
  categorie: 'utilisateurs',

  data: new SlashCommandBuilder()
    .setName('guide')
    .setDescription('Raccourcis du serveur : règles, support/tickets, accueil'),

  async executer(interaction) {
    const r = stockage.reglages(interaction.guildId);
    const champs = [];
    if (r.guide.regles) champs.push({ name: '📜 Les règles', value: `À lire ici : <#${r.guide.regles}>` });
    if (r.guide.support) champs.push({ name: '🛟 Support & tickets', value: `Pour parler au staff ou ouvrir un ticket : <#${r.guide.support}>` });
    if (r.bienvenue.salon) champs.push({ name: '👋 Se présenter', value: `C'est dans <#${r.bienvenue.salon}> que ça se passe !` });

    if (!champs.length) {
      return panneaux.repondre(
        interaction,
        panneaux.attention('🧭 Pas encore de repères',
          'Un administrateur peut les régler avec `/config` (section « Salons & repères »).'),
        { ephemere: true },
      );
    }

    const carte = new EmbedBuilder()
      .setColor(panneaux.COULEUR)
      .setTitle(`🧭 Guide — ${interaction.guild.name}`)
      .setDescription('Besoin d\'autre chose ? Tape `/ask` et demande-moi, je réponds avec le bon lien.')
      .addFields(champs);

    return interaction.reply({ embeds: [carte], ephemeral: false }).catch(() => null);
  },
};
