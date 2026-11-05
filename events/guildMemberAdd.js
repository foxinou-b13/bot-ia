/**
 * events/guildMemberAdd.js — message de bienvenue + détection de raid.
 */
const { Events } = require('discord.js');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');
const { config } = require('../config');

const arrivees = new Map();     // guildId → [horodatages]

function texteBienvenue(modele, membre, serveur, nombre) {
  return String(modele || '')
    .replace(/\{membre\}/g, `<@${membre.id}>`)
    .replace(/\{serveur\}/g, serveur.name)
    .replace(/\{nombre\}/g, String(nombre));
}

module.exports = {
  nom: Events.GuildMemberAdd,

  async executer(client, membre) {
    const guild = membre.guild;
    const reglages = stockage.reglages(guild.id);

    // ─── raid ? ───
    if (reglages.automod?.raid) {
      const maintenant = Date.now();
      const fenetre = config.modo.raidSecondes * 1000;
      const liste = (arrivees.get(guild.id) || []).filter((t) => maintenant - t <= fenetre);
      liste.push(maintenant);
      arrivees.set(guild.id, liste);

      if (liste.length >= config.modo.raidInscrits) {
        arrivees.set(guild.id, []);          // on évite de spammer l'alerte
        await journal.journaliser(guild, {
          type: 'auto',
          titre: '🚨 Arrivées suspectes',
          details: `${liste.length} personnes ont rejoint en moins de ${config.modo.raidSecondes} secondes.\n`
            + 'Vérifie les nouveaux comptes et pense à `/lock` les salons sensibles.',
        });
      }
    }

    // ─── message de bienvenue ───
    const { salon, message } = reglages.bienvenue || {};
    if (!salon) return null;

    const cible = guild.channels?.cache?.get(salon);
    if (!cible || typeof cible.send !== 'function') return null;

    const nombre = guild.memberCount || 0;
    const texte = texteBienvenue(message || 'Bienvenue {membre} sur **{serveur}** !', membre, guild, nombre);

    try {
      await cible.send({ content: texte, allowedMentions: { users: [membre.id] } });
      return true;
    } catch (erreur) {
      console.error('⚠️ Bienvenue non envoyée :', erreur.message);
      return null;
    }
  },
};
