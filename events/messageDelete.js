/**
 * events/messageDelete.js — le « Journal du staff » promet les suppressions :
 * cette fois c'est vrai. Chaque message effacé par un membre laisse une trace
 * (auteur, salon, extrait court) dans le salon de logs réglé dans /config.
 *
 * Zéro doublon : les retraits faits par le bot lui-même (auto-mod, /clear,
 * ménage du panneau) sont marqués « silencieux » par leurs auteurs avant
 * l'envoi de la consigne Discord — voir utils/journal.js.
 * Messages des bots, messages déjà oubliés par Discord (partiels) et le
 * journal lui-même sont ignorés.
 */
const { Events } = require('discord.js');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');

const EXTRAIT_MAX = 350;

function extrait(message) {
  const texte = String(message.content || '').replace(/\s+/g, ' ').trim();
  if (!texte) return null;
  return journal.chapper(texte.length > EXTRAIT_MAX ? `${texte.slice(0, EXTRAIT_MAX)}…` : texte);
}

module.exports = {
  nom: Events.MessageDelete,

  async executer(client, message) {
    if (!message || !message.guild || message.partial) return;
    if (message.author && message.author.bot) return;
    if (journal.estTaie(message.id, message.channelId)) return;

    const reglages = stockage.reglages(message.guild.id);
    const j = reglages.journal || {};
    if (j.suppressions === false) return;
    if (!reglages.logs || message.channelId === reglages.logs) return;

    const pieces = message.attachments && message.attachments.size
      ? ` — 📎 ${message.attachments.size} pièce(s) jointe(s)`
      : '';
    const lignes = [
      `**Auteur :** ${message.author ? message.author.tag : 'inconnu'}`,
      `**Salon :** #${(message.channel && message.channel.name) || '?'}`,
      `**Contenu :** ${extrait(message) || '(aucun texte)'}`,
    ];
    if (pieces) lignes.push(lignes.pop() + pieces);

    await journal.journaliser(message.guild, {
      type: 'suppression',
      titre: '🗑️ Message supprimé',
      details: lignes.join('\n'),
    });
  },
};
