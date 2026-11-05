/**
 * events/messageCreate.js — deux rôles :
 *   1. la modération automatique (spam, liens, insultes, majuscules)
 *   2. l'IA quand on mentionne le bot
 */
const { Events, PermissionsBitField } = require('discord.js');
const automod = require('../utils/automod');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');
const ia = require('../utils/ia');
const panneaux = require('../utils/panneaux');

const historique = new Map();     // `${guildId}:${userId}` → [horodatages]

function journaliser(cle, horodatage, seconde) {
  const liste = historique.get(cle) || [];
  liste.push(horodatage);
  const limite = dateLimite(seconde);
  const gardes = liste.filter((t) => horodatage - t <= limite);
  historique.set(cle, gardes);
  return gardes;
}

function dateLimite(seconde) {
  return seconde * 1000;
}

async function modererAutomatiquement(message, reglages) {
  const analyse = automod.analyser(message.content);

  if (analyse.action === 'supprimer') {
    try {
      await message.delete();
    } catch {
      return null;                     // pas la permission : on n'insiste pas
    }
    const avertissement = await message.channel.send({
      embeds: [panneaux.attention('🛡️ Message supprimé',
        `<@${message.author.id}>, ton message a été retiré : **${analyse.raison}**.`)],
    }).catch(() => null);

    if (avertissement && typeof avertissement.delete === 'function') {
      setTimeout(() => avertissement.delete().catch(() => null), 8000);
    }

    await journal.journaliser(message.guild, {
      type: 'auto', titre: '🛡️ Modération automatique',
      cible: `${message.author.tag} (${message.author.id})`,
      raison: analyse.raison,
      details: message.content.slice(0, 500),
    });
    return analyse;
  }

  return null;
}

module.exports = {
  nom: Events.MessageCreate,

  async executer(client, message) {
    if (!message || message.author?.bot) return;
    if (!message.guild) return;                       // on ignore les MP

    const reglages = stockage.reglages(message.guild.id);
    const estStaff = typeof message.member?.permissions?.has === 'function'
      && message.member.permissions.has(PermissionsBitField.Flags.ManageMessages);

    // ─── 1. modération automatique ───
    const automodActif = reglages.automod
      && (reglages.automod.spam || reglages.automod.liens || reglages.automod.insultes || reglages.automod.majuscules);
    const exempte = automod.salonExempt(message.channel.id, reglages.automod);

    if (automodActif && !exempte && !estStaff && message.content) {
      // spam : on compte les messages même inoffensifs
      const cle = `${message.guild.id}:${message.author.id}`;
      const recents = journaliser(cle, Date.now(), 60);
      const spam = automod.estSpam(recents.slice(0, -1), Date.now());

      if (reglages.automod.spam && spam.spam) {
        try {
          await message.channel.send({
            embeds: [panneaux.attention('🐢 Doucement',
              `<@${message.author.id}>, tu envoies trop de messages d'un coup. Prends une pause.`)],
          }).then((m) => setTimeout(() => m.delete().catch(() => null), 8000)).catch(() => null);
        } catch { /* rien */ }
        await journal.journaliser(message.guild, {
          type: 'auto', titre: '🐢 Spam détecté',
          cible: `${message.author.tag} (${message.author.id})`,
          details: `${spam.nombre} messages en moins d'une minute dans <#${message.channel.id}>`,
        });
        return;
      }

      const reglagesActifs = {
        ...reglages.automod,
        spam: false,
        liens: reglages.automod.liens,
        insultes: reglages.automod.insultes,
        majuscules: reglages.automod.majuscules,
      };
      const analyse = await modererAutomatiquement(message, reglagesActifs);
      if (analyse) return;
    }

    // ─── 2. IA sur mention ───
    if (!client.user || !message.mentions.has(client.user.id)) return;
    if (message.content.replace(/<@!?\d+>/g, '').trim().length === 0) {
      return message.reply({ embeds: [panneaux.info('👋 Je suis là', 'Mentionne-moi avec une question : « @Otaku explique-moi les threads ».')] })
        .catch(() => null);
    }

    const question = message.content.replace(/<@!?\d+>/g, '').trim();
    const limite = ia.tropRapide(message.author.id);
    if (limite.bloque) {
      return message.reply({
        embeds: [panneaux.attention('⏳ Doucement', `Attends encore **${limite.resteSecondes} seconde(s)** avant de me reposer une question.`)],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);
    }

    try {
      if (typeof message.channel.sendTyping === 'function') await message.channel.sendTyping();
    } catch { /* rien */ }

    const debut = Date.now();
    try {
      const { texte, fournisseur } = await ia.demander({
        systeme: ia.consigneSysteme({
          serveur: message.guild.name,
          pseudo: message.member?.displayName || message.author.username,
        }),
        messages: [
          ...ia.memoire(message.guild.id, message.channel.id),
          { role: 'user', contenu: question },
        ],
      });

      ia.memoriser(message.guild.id, message.channel.id, 'user', question);
      ia.memoriser(message.guild.id, message.channel.id, 'assistant', texte);

      const secondes = ((Date.now() - debut) / 1000).toFixed(1);
      const quoi = fournisseur === 'groq' ? '⚡ Groq' : '🔷 Gemini';
      const morceaux = ia.decouper(texte);

      const carte = new (require('discord.js').EmbedBuilder)()
        .setColor(panneaux.COULEUR)
        .setDescription(morceaux[0])
        .setFooter({ text: `${quoi} • réponse en ${secondes} s` })
        .setTimestamp();
      await message.reply({ embeds: [carte], allowedMentions: { repliedUser: false } }).catch(() => null);
      for (const suite of morceaux.slice(1)) {
        await message.channel.send({
          embeds: [new (require('discord.js').EmbedBuilder)()
            .setColor(panneaux.COULEUR).setDescription(suite).setFooter({ text: '⁘ ⁘ suite de la réponse' })],
        }).catch(() => null);
      }
      return { ok: true };
    } catch (erreur) {
      console.error('⚠️ IA (mention) :', erreur.message);
      return message.reply({ embeds: [panneaux.attention('🤖 Panne temporaire', ia.PHRASE_ECHEC)] }).catch(() => null);
    }
  },
};
