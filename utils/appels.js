/**
 * utils/appels.js — « ota, appelle Jordan »
 *
 * Un membre en cherche un autre sur le serveur. Otaku joue l'intermédiaire poli :
 *   1. il note le prénom demandé ;
 *   2. il demande POURQUOI (une raison courte, obligatoire — pas de ping gratuit) ;
 *   3. il cherche les membres dont le nom ressemble, et s'il y en a plusieurs,
 *      il fait choisir la bonne personne dans un menu privé ;
 *   4. il ping la personne en expliquant qui la cherche et pourquoi.
 *
 * Aucun appel IA, aucun stockage durable : l'attente vit en mémoire (2 minutes),
 * le reste du serveur n'est jamais dérangé.
 */

const {
  EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, ComponentType, MessageFlags,
} = require('discord.js');

const COULEUR = 0x8e6fdf;
const DELAI_ETAT_MS = 2 * 60 * 1000;   // le demandeur a 2 min pour donner sa raison
const RAISON_MAX = 250;
const PAUSE_APPEL_MS = 30 * 1000;       // un seul appel par auteur et par salon pendant 30 s

/** cle `${guild}:${salon}:${auteur}` → { nom, raison, auteurTag, candidats, timer } */
const ETATS = new Map();
const DERNIER_APPEL = new Map();        // cle → timestamp (anti-spam)

function normaliser(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** « ota, tu peux appeler jordans » → « jordans ». Renvoie null si ce n'est pas une demande d'appel. */
function detecterAppel(texte) {
  let t = String(texte || '').replace(/<@!?\d+>/g, ' ').trim();
  t = t.replace(/^(?:salut|coucou|hello|yo|bg|slt)\b[ ,.;:!]*/i, '').trim();
  t = t.replace(/^(?:o ?tak ?u?|o ?ta['’]?)\b[ ,.;:!]*/i, '').trim();
  if (!t) return null;
  const m = t.match(/(?:^|\s)(?:appell(?:e|ez|e[- ]moi)|appeler|fais venir|fait venir|ram[eè]ne(?:[- ]moi)?|ramener)\s+(?:moi\s+)?([A-Za-zÀ-ÿ0-9_.']{2,32})(?=$|[ ,.;:!?])/i);
  if (!m) return null;
  let nom = m[1].trim();
  nom = nom.replace(/\b(?:s.il te plait|s.il te plaît|stp|svp|please|merci|de\s suite|maintenant)\b.*$/i, '').trim();
  return normaliser(nom).length >= 2 ? nom : null;
}

/** Membres du serveur dont le nom ressemble à `nom` (bots exclus, sans doublons). */
function chercheMembres(guild, nom) {
  const q = normaliser(nom);
  const singulier = q.length > 4 && q.endsWith('s') ? q.slice(0, -1) : q;
  const membres = [...(guild?.members?.cache?.values?.() || [])];
  const trouv = [];
  const vus = new Set();
  for (const m of membres) {
    if (!m || m.user?.bot || vus.has(m.id)) continue;
    for (const n of [m.displayName, m.user?.username].filter(Boolean)) {
      const c = normaliser(n);
      if (c.length < 2) continue;
      if (c === q || c === singulier
        || c.startsWith(q) || q.startsWith(c)
        || c.startsWith(singulier) || (singulier.length >= 4 && singulier.startsWith(c))) {
        trouv.push(m);
        vus.add(m.id);
        break;
      }
    }
  }
  return trouv;
}

/** Nettoie la raison : suppression des ping cachés, longueur bornée. */
function nettoyerRaison(texte) {
  return String(texte || '')
    .replace(/<@!\d+>/g, '@un membre').replace(/<@\d+>/g, '@un membre')
    .replace(/<@&\d+>/g, '@un rôle').replace(/<#\d+>/g, 'un salon')
    .replace(/@(?:everyone|here)/gi, '@…')
    .replace(/[ \t]+/g, ' ')
    .trim().slice(0, RAISON_MAX);
}

function repondre(message, texte) {
  return message.reply({
    embeds: [new EmbedBuilder().setColor(COULEUR).setDescription(texte)],
    allowedMentions: { repliedUser: false },
  }).catch(() => null);
}

function effacer(cle) {
  const etat = ETATS.get(cle);
  if (etat?.timer) clearTimeout(etat.timer);
  ETATS.delete(cle);
}

/** Envoie réellement le ping au membre choisi. */
async function envoyerAppel({ salon, demandeurTag, auteurId, cible, raison, guildId }) {
  const paquet = {
    content: `📣 <@${cible.id}> — **${demandeurTag}** te cherche et aimerait un moment : `
      + `« ${raison} ».\nC'est dans ce salon — réponds quand tu peux, personne n'est fâché.`,
    allowedMentions: { users: [cible.id], repliedUser: false },
  };
  await salon.send(paquet).catch(() => null);
  // trace légère au journal du staff (discrétion : juste qui a ping qui)
  try {
    require('./journal').journaliser({ id: guildId }, {
      type: 'auto',
      titre: '🫵 Appel entre membres via Otaku',
      auteur: demandeurTag,
      cible: `${cible.displayName || cible.user?.username || cible.id}`,
      raison: 'Ping transmis par Otaku à la demande d’un membre',
      details: raison.slice(0, 120),
    });
  } catch { /* journal optionnel */ }
}

/** Étape après la raison : chercher, et soit appeler direct, soit proposer le menu. */
async function lancerRecherche(message, etat, cle) {
  const candidats = chercheMembres(message.guild, etat.nom);
  if (candidats.length === 0) {
    effacer(cle);
    await repondre(message, `🤔 Personne sur ce serveur ne s'appelle **« ${etat.nom} »** (même de loin).\n`
      + 'Vérifie l’orthographe du pseudo et redemande : « ota, appelle le-bon-pseudo ».');
    return;
  }
  const seulementMoi = candidats.length === 1 && candidats[0].id === etat.auteurId;
  if (seulementMoi) {
    effacer(cle);
    await repondre(message, '🙃 …c’est **toi**, ce membre ! Je ne vais pas t’appeler toi-même.');
    return;
  }
  const sansMoi = candidats.filter((m) => m.id !== etat.auteurId);
  if (sansMoi.length === 1) {
    effacer(cle);
    await envoyerAppel({
      salon: message.channel,
      demandeurTag: etat.auteurTag,
      cible: sansMoi[0],
      raison: etat.raison,
      guildId: message.guild.id,
    });
    return;
  }
  // Plusieurs homonymes → menu privé pour le demandeur uniquement.
  etat.candidats = sansMoi.slice(0, 25);
  const menu = new StringSelectMenuBuilder()
    .setCustomId('app:sel')
    .setPlaceholder(`Qui appeler ? (${etat.candidats.length} personnes trouvées)`)
    .addOptions(etat.candidats.map((m) => ({
      label: String(m.displayName || m.user?.username || m.id).slice(0, 25),
      value: m.id,
      description: `@${(m.user?.username || m.id).slice(0, 25)}`.slice(0, 95),
    })));
  const annuler = new ButtonBuilder().setCustomId('app:x').setLabel('Annuler').setEmoji('🗑️').setStyle(ButtonStyle.Secondary);
  await message.channel.send({
    flags: MessageFlags.Ephemeral,
    embeds: [new EmbedBuilder().setColor(COULEUR).setDescription(
      `🫵 J'ai trouvé plusieurs personnes qui ressemblent à **« ${etat.nom} »**.\n`
      + 'Laquelle veux-tu que j’appelle ? (Pour la raison : « ' + etat.raison.slice(0, 80) + ' »)',
    )],
    components: [new ActionRowBuilder().addComponents(menu), new ActionRowBuilder().addComponents(annuler)],
  }).catch(() => null);
}

module.exports = {
  ETATS,
  viderEtats() {
    for (const cle of [...ETATS.keys()]) effacer(cle);
    DERNIER_APPEL.clear();
  },
  detecterAppel,
  chercheMembres,
  normaliser,
  nettoyerRaison,

  /**
   * Renvoie true si Otaku a « consommé » le message (flow d'appel en cours).
   * ctx.interpele : message adressé à Otaku (mention ou mot « ota »).
   */
  async traiterMessage(message, iaR = {}, ctx = {}) {
    if (!message.guild || message.author?.bot || !message.content) return false;
    const cle = `${message.guild.id}:${message.channel.id}:${message.author.id}`;
    const etat = ETATS.get(cle);

    if (etat) {
      if (/^(?:annuler|abandonne[rz]?|laisse[- ]tomber|jamais|non merci|stop)[\s.!]*$/i.test(String(message.content).trim())) {
        effacer(cle);
        await repondre(message, '🆗 Appel annulé, je ne dérange personne.');
        return true;
      }
      if (!etat.raison) {
        const raison = nettoyerRaison(message.content);
        if (raison.length < 3) {
          await repondre(message, `Il me faut une **raison courte** (3 à ${RAISON_MAX} caractères) pour prévenir « ${etat.nom} » — ou écris « annuler ».`);
          return true;
        }
        etat.raison = raison;
        if (etat.timer) clearTimeout(etat.timer);
        etat.timer = setTimeout(() => effacer(cle), DELAI_ETAT_MS);
        etat.timer.unref?.();
        await lancerRecherche(message, etat, cle);
        return true;
      }
      return false; // on attend un clic dans le menu : le reste du chat vit sa vie
    }

    if (iaR.appels === false || !ctx.interpele) return false;
    const nom = detecterAppel(message.content);
    if (!nom) return false;
    if (['quelquun', 'quelqu', 'unmembre', 'untel'].includes(normaliser(nom))) {
      await repondre(message, 'Qui veux-tu appeler ? Dis-le moi : **« ota, appelle Jordan »** par exemple.');
      return true;
    }
    const maintenant = Date.now();
    if (maintenant - (DERNIER_APPEL.get(cle) || 0) < PAUSE_APPEL_MS) {
      await repondre(message, '⏳ Un appel vient déjà de partir d’ici. Laisse le temps à la personne de répondre.');
      return true;
    }
    DERNIER_APPEL.set(cle, maintenant);
    const timer = setTimeout(() => effacer(cle), DELAI_ETAT_MS);
    timer.unref?.();
    ETATS.set(cle, {
      nom, raison: null, auteurId: message.author.id,
      auteurTag: message.author.tag || message.author.username,
      timer,
    });
    await repondre(message, `👂 **${nom}**, c'est noté.\n**Pour quelle raison** dois-je l’appeler ? `
      + `Écris ta raison ici (2 minutes, ou « annuler »).`);
    return true;
  },

  /** Boutons/menus « app: » — routés depuis events/interactionCreate.js. */
  async traiterBouton(interaction) {
    const id = String(interaction.customId || '');
    // L'état vit chez le DEMANDEUR : on le retrouve par salon, pas par le cliqueur.
    const prefix = `${interaction.guildId}:${interaction.channelId}:`;
    let cle = `${prefix}${interaction.user?.id}`;
    let etat = ETATS.get(cle);
    if (!etat?.candidats?.length) {
      for (const [c, e] of ETATS) {
        if (c.startsWith(prefix) && e.candidats?.length) { cle = c; etat = e; break; }
      }
    }

    if (id === 'app:x') {
      if (etat && etat.auteurId && etat.auteurId !== interaction.user.id) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COULEUR).setDescription('🙅 Seul celui qui demande l’appel peut l’annuler.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return true;
      }
      effacer(cle);
      await interaction.update({ embeds: [new EmbedBuilder().setColor(COULEUR).setDescription('🆗 Appel annulé.')], components: [] }).catch(() => null);
      return true;
    }
    if (id === 'app:sel' && interaction.isStringSelectMenu?.()) {
      if (!etat?.candidats?.length) {
        await interaction.update({ embeds: [new EmbedBuilder().setColor(COULEUR).setDescription('⌛ Cette attente d’appel a expiré. Redemande si besoin.')], components: [] }).catch(() => null);
        return true;
      }
      if (interaction.user.id !== etat.auteurId) {
        await interaction.reply({
          embeds: [new EmbedBuilder().setColor(COULEUR).setDescription('🙅 Seul celui qui demande l’appel peut choisir la personne.')],
          flags: MessageFlags.Ephemeral,
        }).catch(() => null);
        return true;
      }
      const cible = etat.candidats.find((m) => m.id === interaction.values[0]);
      if (!cible) {
        await interaction.update({ embeds: [new EmbedBuilder().setColor(COULEUR).setDescription('🤔 Ce choix n’est plus valide.')], components: [] }).catch(() => null);
        return true;
      }
      effacer(cle);
      const salon = interaction.channel
        || (interaction.client?.channels ? await interaction.client.channels.fetch(interaction.channelId).catch(() => null) : null);
      if (salon) {
        await envoyerAppel({
          salon,
          demandeurTag: etat.auteurTag,
          cible,
          raison: etat.raison,
          guildId: interaction.guildId,
        });
      }
      await interaction.update({
        embeds: [new EmbedBuilder().setColor(COULEUR).setDescription(`✅ **${cible.displayName || cible.user?.username}** est prévenu·e. Tu peux parler librement maintenant.`)],
        components: [],
      }).catch(() => null);
      return true;
    }
    return false;
  },
};
