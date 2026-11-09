/**
 * events/guildMemberRemove.js — les départs laissés silencieux sont un angle
 * mort pour un serveur. Le « Journal du staff » note donc chaque départ :
 * pseudo, ancienneté du compte, rôle(s). Un compte de moins de 7 jours qui
 * part aussitôt est signalé : c'est la signature classique d'un raidéclair.
 */
const { Events } = require('discord.js');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');

const JEUNE_MS = 7 * 24 * 60 * 60 * 1000;

module.exports = {
  nom: Events.GuildMemberRemove,

  async executer(client, membre) {
    const guild = membre && membre.guild;
    if (!guild || !membre.user) return;
    if (membre.user.bot) return;

    const reglages = stockage.reglages(guild.id);
    const j = reglages.journal || {};
    if (j.sorties === false) return;
    if (!reglages.logs) return;

    const cree = membre.user.createdTimestamp || Date.now();
    const lignes = [
      `**Membre :** ${journal.chapper(membre.user.tag)}`,
      `**Compte créé :** <t:${Math.floor(cree / 1000)}:D> · <t:${Math.floor(cree / 1000)}:R>`,
    ];
    if (membre.roles && membre.roles.cache) {
      lignes.push(`**Rôles :** ${membre.roles.cache.size}`);
    }
    if (Date.now() - cree < JEUNE_MS) {
      lignes.push('⚠️ **Compte de moins de 7 jours.** Si d\u2019autres arrivées du même genre s\u2019enchaînent, verrouille avec `/lock`.');
    }

    await journal.journaliser(guild, {
      type: 'sortie',
      titre: `🚪 ${journal.chapper(membre.displayName || membre.user.username)} a quitté le serveur`,
      details: lignes.join('\n'),
    });
  },
};
