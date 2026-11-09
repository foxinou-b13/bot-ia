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
const securite = require('../utils/securite-ia');
const panneaux = require('../utils/panneaux');
const sanctions = require('../utils/sanctions');

// anti-spam de MP : on notifie la personne en privé au plus une fois toutes les
// 5 minutes — mais CHAQUE retrait compte dans ses avertissements (le seuil reste
// atteignable même en cas de rafale d'insultes).
const DERNIER_MP = new Map();    // `guildId:userId` → horodatage du dernier MP envoyé
const PAUSE_MP_MS = 5 * 60 * 1000;

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
  const analyse = automod.analyser(message.content, { reglages });

  if (analyse.action !== 'supprimer') return null;

  try {
    journal.taireMessage(message.id);   // déjà raconté joliment ci-dessous : pas de double ligne
    await message.delete();
  } catch {
    return null;                     // pas la permission : on n'insiste pas
  }

  // ─── la sanction promise par le panneau : avertissement compté + MP + seuil automatique ───
  let note = `<@${message.author.id}>, ton message a été retiré : **${analyse.raison}**.`;
  const cle = `${message.guild.id}:${message.author.id}`;
  const maintenant = Date.now();
  const liste = stockage.ajouterAvert(message.guild.id, message.author.id, {
    raison: `Auto-modération : ${analyse.raison}`,
    par: 'Otaku (automatique)',
    date: maintenant,
  });
  const seuil = reglages.seuilAvert || 3;
  note += ` Avertissement n°${liste.length} enregistré`;
  if (reglages.sanctionAuto) note += ` (sourdine automatique à ${seuil})`;
  note += '.';
  const cible = message.member
    || (message.guild.members?.fetch ? await message.guild.members.fetch(message.author.id).catch(() => null) : null);
  if (cible) {
    const peutMp = maintenant - (DERNIER_MP.get(cle) || 0) >= PAUSE_MP_MS;
    if (peutMp) {
      DERNIER_MP.set(cle, maintenant);
      const recu = await sanctions.avertir(cible, {                       // MP (si accepté) + ligne au journal
        raison: `Message retiré automatiquement : ${analyse.raison}`,
        auteur: 'Auto-modération',
        nombre: liste.length,
      });
      if (recu && recu.mp === false) {
        note += ' Impossible de t\u2019écrire en MP (réglages de confidentialité fermés) : le staff voit tout au journal.';
      }
    } else {
      await journal.journaliser(message.guild, {
        type: 'warn', titre: '⚠️ Avertissement automatique',
        cible: `${message.author.tag} (${message.author.id})`,
        raison: `${analyse.raison} — n°${liste.length} (MP en pause anti-spam de 5 min)`,
      });
    }
    if (reglages.sanctionAuto && liste.length >= seuil) {
      const minutes = reglages.dureeSanction || 60;
      const muet = await sanctions.rendreMuet(cible, {                   // MP + journal inclus dedans
        raison: `Sanction automatique : ${liste.length} avertissements`,
        auteur: `Automatique (seuil ${seuil})`,
        ms: minutes * 60000,
        dureeLisible: `${minutes} min`,
      });
      if (muet.ok) note += ` Te voilà **en sourdine ${minutes} min**.`;
      else note += ` (sourdine impossible : ${muet.erreur || 'rôle du bot trop bas dans la liste'})`;
    }
  }

  const avertissement = await message.channel.send({
    embeds: [panneaux.attention('🛡️ Message supprimé', note)],
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

// Salutations « je suis là » : une rotation, jamais la même deux fois de suite.
const SALUTS = [
  'Je suis là ! Pose ta question juste après mon prénom : « ota, explique-moi les threads ».',
  'Présent. Question, conseil, résumé, traduction — demande, je réponds.',
  'À ton écoute ! Écris « ota » + ta question, ou passe par /ask.',
  'Salut ! Je réponds aux questions du serveur, dans ta langue. Qu’est-ce que tu veux savoir ?',
  'Mode écoute activé 🎧 — vas-y, pose ta question.',
  'Pas besoin de mention : « ota, … » et je débarque. Qu’est-ce que je peux faire pour toi ?',
];
const DERNIER_SALUT = new Map();
function salutVariation(guildId) {
  let idx = Math.floor(Math.random() * SALUTS.length);
  if (idx === DERNIER_SALUT.get(guildId)) idx = (idx + 1) % SALUTS.length;
  DERNIER_SALUT.set(guildId, idx);
  return SALUTS[idx];
}
module.exports = {
  nom: Events.MessageCreate,

  async executer(client, message) {
    if (!message || message.author?.bot) return;
    if (!message.guild) return;                       // on ignore les MP

    // réponse attendue au message-invitation « envoie ton image de fond » ?
    const choixFond = require('../utils/choix-fond');
    if (await choixFond.traiterReponse(message)) return;

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
        spam: reglages.automod.spam,
        liens: reglages.automod.liens,
        insultes: reglages.automod.insultes,
        majuscules: reglages.automod.majuscules,
      };
      const analyse = await modererAutomatiquement(message, reglagesActifs);
      if (analyse) return;
    }

    // ─── 2. On l'appelle ou on se tait : mention obligatoire, ou le mot « ota » au début ───
    const texteNu = message.content.replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim();
    const estMention = Boolean(client.user && message.mentions.has(client.user.id));
    const motCle = /^o ?ta(?:ku|k|['’])?\b/i.test(texteNu);
    const interpele = estMention || motCle;
    if (!interpele) return; // on ne l'appelle pas : il ne coupe pas la conversation

    const question = estMention
      ? message.content.replace(/<@!?\d+>/g, ' ').replace(/\s+/g, ' ').trim()
      : texteNu.replace(/^o ?ta(?:ku|k|['’])?\b[ ,.;:!]*/i, '').trim();
    if (!question) {
      // juste « ota » ou une mention seule : il répond, et JAMAIS deux fois la même phrase
      return message.reply({ embeds: [panneaux.info('👋 Je suis là', salutVariation(message.guild.id))] })
        .catch(() => null);
    }

    // ─── sécurité pro : filtre avant appel IA (réglages + salon + sujet) ───
    const acces = securite.verifierAcces(message.guild.id, message.channel.id, question);
    if (!acces.ok) {
      if (acces.bloc) {
        await journal.journaliser(message.guild, {
          type: 'auto',
          titre: '🛡️ Question IA bloquée par le filtre',
          auteur: message.author.tag,
          cible: `#${message.channel.name}`,
          raison: acces.bloc,
          details: question.slice(0, 180),
        });
      }
      return message.reply({
        embeds: [panneaux.attention('🛡️ Je ne peux pas répondre là-dessus', acces.raison)],
        allowedMentions: { repliedUser: false },
      }).catch(() => null);
    }

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

    try {
      let { texte, fournisseur } = await ia.demander({
        systeme: ia.consigneSysteme({
          serveur: message.guild.name,
          pseudo: message.member?.displayName || message.author.username,
          consigneServeur: (stockage.reglages(message.guild.id).ia || {}).consigne,
          guide: stockage.repereIA(message.guild.id),
          langue: ia.detecterLangue(question),
        }),
        messages: [
          ...ia.historiquePourPrompt(message.guild.id, message.channel.id),
          { role: 'user', contenu: question },
        ],
      });

      ia.memoriser(message.guild.id, message.channel.id, 'user', question,
        message.member?.displayName || message.author.username);
      ia.memoriser(message.guild.id, message.channel.id, 'assistant', texte);

      // ─── filtrage SORTANT ───
      const propre = securite.filtrerSortie(texte);
      if (propre === null) {
        await journal.journaliser(message.guild, {
          type: 'auto',
          titre: '🛡️ Réponse IA bloquée avant publication',
          auteur: `${fournisseur} (${message.author.tag})`,
          cible: `#${message.channel.name}`,
          raison: 'contenu hors limites',
        });
        return null;
      }
      texte = propre;

      const morceaux = ia.decouper(texte);

      const carte = new (require('discord.js').EmbedBuilder)()
        .setColor(panneaux.COULEUR)
        .setDescription(morceaux[0])
        .setTimestamp();
      // la réponse ping en retour celui qui a posé la question
      await message.reply({ embeds: [carte] }).catch(() => null);
      for (const suite of morceaux.slice(1)) {
        await message.channel.send({
          embeds: [new (require('discord.js').EmbedBuilder)()
            .setColor(panneaux.COULEUR).setDescription(suite)],
        }).catch(() => null);
      }
      return { ok: true };
    } catch (erreur) {
      console.error('⚠️ IA (mention) :', erreur.message);
      return message.reply({ embeds: [panneaux.attention('🤖 Panne temporaire', ia.PHRASE_ECHEC)] }).catch(() => null);
    }
  },
};
