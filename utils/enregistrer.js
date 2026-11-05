/**
 * utils/enregistrer.js — envoie les commandes à Discord.
 * Appelé automatiquement au démarrage (et par `npm run deploy`).
 */
const { REST, Routes } = require('discord.js');
const { config } = require('../config');

async function enregistrerCommandes(client, options = {}) {
  const tables = client?.commands || new Map();
  const corps = [...tables.values()].map((c) => c.data.toJSON());
  if (corps.length === 0) return { ok: false, nombre: 0, raison: 'aucune commande' };
  if (!config.botId) return { ok: false, nombre: 0, raison: 'BOT_ID manquant' };

  const rest = new REST({ version: '10' }).setToken(config.token);
  try {
    const resultat = await rest.put(Routes.applicationCommands(config.botId), { body: corps });
    if (!options.silencieux) {
      console.log(`✅ ${resultat.length} commande(s) enregistrée(s) sur Discord.`);
    }
    return { ok: true, nombre: resultat.length };
  } catch (erreur) {
    console.error('⚠️ Enregistrement des commandes impossible :', erreur.message);
    return { ok: false, nombre: 0, raison: erreur.message };
  }
}

module.exports = { enregistrerCommandes };
