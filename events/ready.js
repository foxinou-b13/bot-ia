/**
 * events/ready.js — au démarrage : on se présente et on vérifie l'essentiel.
 */
const { Events, ActivityType } = require('discord.js');
const { config, fournisseursIA } = require('../config');
const { enregistrerCommandes } = require('../utils/enregistrer');

module.exports = {
  nom: Events.ClientReady,
  uneFois: true,

  async executer(client) {
    console.log(`✅ Connecté en tant que ${client.user.tag} (${client.user.id})`);
    console.log(`   Serveurs : ${client.guilds.cache.size}`);
    console.log(`   IA : ${fournisseursIA().join(' → ') || 'aucune clé'}`);

    try {
      client.user.setPresence({
        activities: [{ name: 'vos questions · /aide', type: ActivityType.Watching }],
        status: 'online',
      });
    } catch { /* sans importance */ }

    // Rappel utile si une clé manque : ça évite de chercher pendant des heures.
    if (fournisseursIA().length === 0) {
      console.warn('⚠️ Aucune clé IA : /ask répondra par un message d\'indisponibilité.');
    }
    // On enregistre les commandes à chaque démarrage : plus rien à faire à la main.
    try {
      const envoi = await enregistrerCommandes(client);
      if (envoi.ok) console.log(`   Commandes à jour (${envoi.nombre}).`);
    } catch (erreur) {
      console.warn('⚠️ Commandes non enregistrées :', erreur.message);
    }

    // Assistant de tickets : surveillance des silences dans les entretiens en cours.
    try {
      const asst = require('../utils/assistant-ticket');
      asst.fournirClient(client);
      asst.demarrerVeille();
      const n = asst.sessions.size;
      if (n) console.log(`   🤝 Assistant tickets : ${n} entretien(s) en cours repris.`);
    } catch (erreur) {
      console.warn('⚠️ Assistant tickets non démarré :', erreur.message);
    }

    console.log(`   Version ${config.version} prête.`);
  },
};
