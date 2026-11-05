/**
 * utils/journal.js — tout ce qui se passe de sensible laisse une trace.
 * Si aucun salon de logs n'est réglé, on ne fait rien (jamais de crash).
 */
const { EmbedBuilder } = require('discord.js');
const stockage = require('./stockage');

const COULEUR = {
  ban: 0xed4245,
  kick: 0xe67e22,
  mute: 0xfaa61a,
  warn: 0xfee75c,
  auto: 0xeb459e,
  ok: 0x3ba55d,
};

/**
 * Envoie une ligne dans le salon de logs du serveur.
 * @returns {Promise<boolean>} true si le message est parti
 */
async function journaliser(guild, entree = {}) {
  if (!guild) return false;
  const reglages = stockage.reglages(guild.id);
  if (!reglages.logs) return false;

  const salon = guild.channels?.cache?.get(reglages.logs);
  if (!salon || typeof salon.send !== 'function') return false;

  const embed = new EmbedBuilder()
    .setColor(COULEUR[entree.type] || 0x5865f2)
    .setTitle(entree.titre || 'Action de modération')
    .setTimestamp(entree.date ? new Date(entree.date) : new Date());

  if (entree.auteur) embed.addFields({ name: 'Par', value: String(entree.auteur), inline: true });
  if (entree.cible) embed.addFields({ name: 'Membre', value: String(entree.cible), inline: true });
  if (entree.duree) embed.addFields({ name: 'Durée', value: String(entree.duree), inline: true });
  if (entree.raison) embed.addFields({ name: 'Raison', value: String(entree.raison).slice(0, 1000) });
  if (entree.details) embed.setDescription(String(entree.details).slice(0, 1900));

  try {
    await salon.send({ embeds: [embed] });
    return true;
  } catch (erreur) {
    console.error('⚠️ Log non envoyé :', erreur.message);
    return false;
  }
}

module.exports = { journaliser, COULEUR };
