/**
 * events/messageUpdate.js — trace des MODIFICATIONS de messages dans le
 * « Journal du staff » réglé dans /config (avant / après, tronqués).
 *
 * On ignore : les bots, les messages partiels (déjà oubliés par Discord),
 * les « modifications » qui ne changent pas le texte (aperçu d'embed,
 * réaction, épingle), et le journal lui-même.
 */
const { Events } = require('discord.js');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');

const EXTRAIT_MAX = 300;

function normalise(texte) {
  return String(texte || '').replace(/\s+/g, ' ').trim();
}

function chapon(texte) {
  const t = normalise(texte);
  return journal.chapper(t.length > EXTRAIT_MAX ? `${t.slice(0, EXTRAIT_MAX)}…` : t) || '(vide)';
}

module.exports = {
  nom: Events.MessageUpdate,

  async executer(client, ancien, nouveau) {
    const message = nouveau || ancien;
    if (!message || !message.guild || message.partial) return;
    if (message.author && message.author.bot) return;
    if (!ancien || ancien.partial) return;

    const avant = normalise(ancien.content);
    const apres = normalise(message.content);
    if (avant === apres) return;   // pas de vrai changement de texte

    const reglages = stockage.reglages(message.guild.id);
    const j = reglages.journal || {};
    if (j.modifications === false) return;
    if (!reglages.logs || message.channelId === reglages.logs) return;

    const lignes = [
      `**Auteur :** ${message.author ? message.author.tag : 'inconnu'}`,
      `**Salon :** #${(message.channel && message.channel.name) || '?'}`,
      `**Avant :** ${chapon(ancien.content)}`,
      `**Après :** ${chapon(message.content)}`,
    ];
    if (message.url) lignes.push(`**Lien :** ${message.url}`);

    await journal.journaliser(message.guild, {
      type: 'modification',
      titre: '✏️ Message modifié',
      details: lignes.join('\n'),
    });
  },
};
