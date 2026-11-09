/**
 * utils/assistant-ticket.js — l'assistant d'accueil dans les salons de tickets.
 *
 * Concept : Otaku ne gère pas les tickets (n'importe quel bot de tickets peut
 * les créer). On lui indique seulement LA CATÉGORIE des tickets dans /config.
 * Dès qu'un membre (non-staff) parle pour la première fois dans un salon de
 * cette catégorie, l'assistant prend le relais du staff arrivant :
 *
 *   1. il accueille et pose les questions utiles (celles réglées par l'admin,
 *      ou improvisées par l'IA si aucune n'est réglée) ;
 *   2. il demande à la fin « c'est tout, ou tu as autre chose à ajouter ? » ;
 *   3. il publie un RÉCAPITULATIF propre pour le staff (ce que la personne
 *      veut vraiment, en 2-3 lignes + le détail des réponses) ;
 *   4. le staff clique « 🙌 Je prends en charge » → l'assistant remercie,
 *      se retire et ne dit plus jamais rien dans ce ticket.
 *
 * Filet de sécurité : sans clé IA = questions fixes seulement (aucun crash) ;
 * membre qui réclame un humain = escalade immédiate au salon d'alerte ;
 * silence = rappel doux puis récapitulatif quand même ; jamais plus de
 * MAX_SESSIONS sessions ouvertes par serveur.
 *
 * La machine à états est pure (transport injecté) : testable sans Discord.
 */
const stockage = require('../utils/stockage');
const ia = require('./ia');
const journal = require('./journal');

const FICHIER_SESSIONS = 'assistant-sessions';
const SILENCE_MS = 15 * 60 * 1000;      // 15 min sans réponse → rappel doux
const ABANDON_MS = 30 * 60 * 1000;      // 30 min → récapitulatif + staff prévenu
const MAX_SESSIONS_PAR_SERVEUR = 8;
const MAX_MOTS_REPONSE = 500;
const Q_FINALE = "C'est tout, ou tu as autre chose à ajouter ? (réponds « c'est tout » quand tu as fini)";
const REPONSE_FIN = /^(non\.?|c('|’)?est tout|cest tout|rien|rien d[\u2019']autre|ok\.?|oui c('|’)?est tout|c\s?est ok)\b/i;
const DEMANDE_HUMAIN = /\b(humain|staff|mod[oé]rateur|admin|personne|r[ée]el|qql|quelqu'un|quelqu’un)\b/i;

const sessions = new Map();             // channelId → session
const CLOS = new Map();                 // channelId → horodatage de prise en charge (jamais de redémarrage)
const CLOS_EXPIRE_MS = 7 * 24 * 60 * 60 * 1000;
let IA_DE_TEST = null;                  // injectée par les tests uniquement

/** L'IA du module : vraie par défaut, fausse en test. */
async function iaDemande(systeme, question) {
  try {
    if (IA_DE_TEST) return await IA_DE_TEST(systeme, question);
    return await ia.demander({ systeme, messages: [{ role: 'user', contenu: question }] });
  } catch {
    return null;                        // aucune clé / panne / IA muette : les questions fixes prennent le relais
  }
}

const CONSIGNE_ASSISTANT = [
  "Tu es Otaku, l'assistant d'accueil d'un salon de ticket d'entraide Discord. Tu n'es PAS le staff : tu prépares son arrivée.",
  "Ton unique objectif : poser au membre, une par une, les questions qu'un staff poserait pour comprendre la demande (contexte, ce qui a déjà été essayé, ce qui est attendu, délai, preuves…).",
  "Règles strictes : une seule question à la fois, courte (2 phrases max), chaleureuse, dans la langue du membre ; tu ne réponds JAMAIS à la demande toi-même et tu ne promets JAMAIS rien au nom du staff.",
  "Si le membre semble vouloir arrêter, se fâcher ou parle directement à un humain, n'insiste pas.",
  "Réponds UNIQUEMENT dans ce format, sans autre texte :",
  "QUESTION: <ta prochaine question>",
  "ou, quand tu estimes avoir tout ce qu'il faut pour résumer la demande :",
  "FIN: <résumé de la demande en 2-3 lignes pour le staff>",
].join('\n');

// ─────────────────────────── réglages ───────────────────────────
function reglagesAssistant(guildId) {
  const a = stockage.reglages(guildId).assistant || {};
  const r = { ...a };
  // Le système de tickets natif d'Otaku sert de socle : pas besoin de régler deux fois.
  try {
    const t = stockage.reglages(guildId).tickets || {};
    if (t.actif) {
      if (!r.categorie) r.categorie = t.categorie || null;
      if (!r.staffRole) r.staffRole = t.staffRole || null;
      if (!r.alerte) r.alerte = t.logs || null;
    }
  } catch { /* stockage indisponible : on garde les réglages bruts */ }
  return r;
}

function estChannelTicket(channel, a) {
  return Boolean(a.categorie) && channel?.parentId === a.categorie && channel?.type === 0;
}

function estStaff(membre, a) {
  if (!membre) return false;
  try {
    if (membre.permissions?.has?.(0x8)) return true;          // ManageMessages
  } catch { /* membreMock sans permissions */ }
  if (a.staffRole && membre.roles?.cache?.has?.(a.staffRole)) return true;
  return false;
}

// ─────────────────────────── persistance ───────────────────────────
function toutes() {
  return stockage.lire(FICHIER_SESSIONS, {});
}

function estClos(canalId) {
  const quand = CLOS.get(canalId);
  if (quand === undefined) return false;
  if (Date.now() - quand > CLOS_EXPIRE_MS) { CLOS.delete(canalId); return false; }
  return true;
}

function sauvegarder() {
  const brut = {};
  for (const [canal, s] of sessions) {
    const { _guild, ...reste } = s;   // le client Discord ne se sérialise pas
    brut[canal] = reste;
  }
  for (const [canal, quand] of CLOS) brut[`clos:${canal}`] = { fermeA: quand };
  stockage.ecrire(FICHIER_SESSIONS, brut);
}

/** Au redémarrage : on reprend les sessions en cours (un serveur ne s'arrête pas pour autant). */
function recharger(client) {
  const brut = toutes();
  for (const [canal, s] of Object.entries(brut)) {
    if (canal.startsWith('clos:')) {
      const quand = s && s.fermeA || 0;
      if (Date.now() - quand <= CLOS_EXPIRE_MS) CLOS.set(canal.slice(4), quand);
      continue;
    }
    if (!s || s.phase === 'termine' || Date.now() - (s.derniereActivite || 0) > 2 * 60 * 60 * 1000) continue;
    sessions.set(canal, s);
  }
  if (client) demarrerVeille(client);
  return sessions.size;
}

function supprimerSession(canalId) {
  sessions.delete(canalId);
  const brut = toutes();
  if (brut[canalId]) {
    delete brut[canalId];
    stockage.ecrire(FICHIER_SESSIONS, brut);
  }
}

// ─────────────────────────── machine à états ───────────────────────────
function nbParServeur(guildId) {
  let n = 0;
  for (const s of sessions.values()) if (s.guildId === guildId && s.phase !== 'termine') n++;
  return n;
}

/** Le point d'entrée : vrai si l'assistant s'occupe de ce message, faux sinon. */
async function traiterMessage(message) {
  if (!message?.guild || message.author?.bot) return false;
  const a = reglagesAssistant(message.guild.id);
  if (!a.actif || !estChannelTicket(message.channel, a)) return false;

  const session = sessions.get(message.channel.id);

  // Un membre (ré)ouvre le sujet : première parole d'un non-staff → accueil.
  if (!session) {
    if (estStaff(message.member, a)) return false;            // le staff ne lance pas l'assistant
    return demarrer(message);
  }
  if (session.phase === 'termine') return false;             // retiré pour toujours de ce ticket

  const aFait = await surActivite(session, message, a);
  return aFait;
}

async function demarrer(message) {
  const canal = message.channel;
  const guildId = message.guild.id;
  const a = reglagesAssistant(guildId);
  if (estClos(canal.id)) return false;                    // staff déjà passé par là : on ne rouvre jamais
  if (nbParServeur(guildId) >= MAX_SESSIONS_PAR_SERVEUR) return false;

  const session = {
    guildId,
    canalId: canal.id,
    createurId: message.author.id,
    createurTag: message.author.tag,
    phase: 'questions',
    questionIndex: 0,
    reponses: [],
    derniereActivite: Date.now(),
    relanceFaite: false,
    questionEnvoyee: false,
  };
  session._guild = message.guild;
  sessions.set(canal.id, session);
  sauvegarder();

  const questions = listeQuestions(a);
  const accueil = [
    `👋 **Bonjour ${pseudo(message.author)}**, bienvenue dans ce ticket.`,
    'Je suis **Otaku**, l\u2019assistant du serveur : je prépare l\u2019arrivée du staff en te posant quelques questions.',
    'Tu peux dire « un humain, s\u2019il te plaît » à tout moment pour passer directement au staff.',
    '',
    `📌 **Première chose :** ${questions.length ? questions[0] : 'décris-moi ta demande en quelques phrases : que se passe-t-il, depuis quand, et qu\u2019attendrais-tu du staff ?'}`,
  ].join('\n');

  await envoyer(canal, accueil);
  session.questionEnvoyee = true;
  sauvegarder();
  return true;
}

function listeQuestions(a) {
  return (a.questions || []).map((q) => String(q).trim()).filter(Boolean).slice(0, 6);
}

function pseudo(user) {
  return String(user?.username || 'toi').slice(0, 32);
}

async function envoyer(canal, texte, extra = {}) {
  try {
    return await canal.send({
      content: texte.slice(0, 1800),
      allowedMentions: { parse: [] },
      ...extra,
    });
  } catch {
    return null;
  }
}

/** Un message vient d'arriver dans un salon suivi : que faire selon qui parle. */
async function surActivite(session, message, a) {
  const canal = message.channel;
  session.derniereActivite = Date.now();
  session.relanceFaite = false;
  sauvegarder();

  // Le staff est arrivé → récapitulatif immédiat, l'assistant s'efface.
  if (estStaff(message.member, a)) {
    if (session.phase === 'questions') {
      await finaliser(session, canal, { raison: 'Le staff est arrivé pendant l\u2019entretien.' });
      return true;
    }
    return false;                                            // le staff parle au membre : on ne sert à rien
  }

  // Un tiers ni staff ni demandeur : on ne l'interroge pas.
  if (message.author.id !== session.createurId) return false;

  const texte = String(message.content || '').trim();
  if (!texte) return false;

  // Le membre réclame un humain → on arrête l'interrogatoire et on alerte.
  if (DEMANDE_HUMAIN.test(texte) && session.phase === 'questions') {
    await finaliser(session, canal, { raison: 'Le membre a demandé un humain.', escalader: true });
    return true;
  }

  if (session.phase === 'reponse_finale') {
    // Réponse à « c'est tout ? »
    if (REPONSE_FIN.test(texte)) {
      await finaliser(session, canal, {});
    } else {
      session.reponses.push(courte(texte));
      await poursuiteApresAjout(session, message, a, canal);
    }
    sauvegarder();
    return true;
  }

  if (session.phase !== 'questions') return false;

  session.reponses.push(courte(texte));
  await prochaineQuestion(session, message, a, canal);
  sauvegarder();
  return true;
}

function courte(texte) {
  const t = String(texte).replace(/\s+/g, ' ').trim();
  return journal.chapper(t).slice(0, MAX_MOTS_REPONSE);
}

/** Enchaîne : question suivante (liste fixe) ou relais par l'IA. */
async function prochaineQuestion(session, message, a, canal) {
  const questions = listeQuestions(a);

  if (questions.length) {
    session.questionIndex += 1;
    if (session.questionIndex < questions.length) {
      await envoyer(canal, `📌 ${questions[session.questionIndex]}`);
      return;
    }
  } else {
    // Pas de liste fixe : c'est l'IA qui mène (et qui décide de la fin).
    const resume = session.reponses.map((r, i) => `R${i + 1} : ${r}`).join('\n').slice(0, 1500);
    const langue = ia.detecterLangue(session.reponses.join(' '));
    const r = await iaDemande(`${CONSIGNE_ASSISTANT}\nOn t'écrit en : ${langue}`,
      `Le membre a déjà répondu :\n${resume}\n\nPose la prochaine question utile (format QUESTION: …) ou conclus (format FIN: …).`);
    const texte = r && String(r.texte || '').trim();
    const question = texte && texte.match(/^QUESTION:\s*([\s\S]+)$/i);
    if (question) {
      await envoyer(canal, `📌 ${question[1].trim().slice(0, 300)}`);
      return;
    }
    // FIN explicite, réponse hors format ou IA muette → on passe à la question de clôture.
  }

  // Toutes les questions fixes sont épuisées (ou l'IA a conclu) : demande de clôture.
  session.phase = 'reponse_finale';
  await envoyer(canal, `💬 ${Q_FINALE}`);
}

/** Le membre a ajouté quelque chose après « c'est tout ? » : une question de plus puis re-clôture. */
async function poursuiteApresAjout(session, message, a, canal) {
  const r = await iaDemande(CONSIGNE_ASSISTANT,
    `Le membre vient d'ajouter : « ${courte(message.content)} ».\nSoit une question complémentaire utile (QUESTION: …), soit conclus (FIN: …).`);
  const question = r && String(r.texte || '').match(/^QUESTION:\s*([\s\S]+)$/i);
  if (question) {
    session.phase = 'questions';
    await envoyer(canal, `📌 ${question[1].trim().slice(0, 300)}`);
    session.phase = 'reponse_finale';                       // après cette réponse-là, on re-clôture
    return;
  }
  await finaliser(session, canal, {});
}

/** Fabrique le récapitulatif pour le staff et rend l'assistant muet dans ce ticket. */
async function finaliser(session, canal, options = {}) {
  session.phase = 'synthese';
  const recap = await construireRecap(session, options);
  const boutons = [
    { type: 2, style: 3, label: '🙌 Je prends en charge', custom_id: `asst:prendre:${canal.id}` },
    { type: 2, style: 2, label: '🔁 Continuer à questionner', custom_id: `asst:relancer:${canal.id}` },
  ];
  const msg = await envoyer(canal, recap.texte, { components: [{ type: 1, components: boutons }] });
  session.messageSynthese = msg?.id || null;
  session.phase = 'synthese';
  sauvegarder();

  if (options.escalader) {
    const a = reglagesAssistant(session.guildId);
    if (a.alerte) {
      const salonAlerte = canal.guild?.channels?.cache?.get?.(a.alerte);
      if (salonAlerte) {
        await envoyer(salonAlerte,
          `🤝 Le membre du ticket <#${canal.id}> demande un humain : ${recap.resumeCourts.join(' · ').slice(0, 300)}`);
      }
    }
  }
  await journal.journaliser(canal.guild, {
    type: 'ok',
    titre: '🤝 Assistant de ticket : récapitulatif publié',
    cible: `<#${canal.id}>`,
    details: `${session.createurTag || session.createurId} — ${recap.resumeCourts.length} réponse(s). ${options.raison || ''}`.trim(),
  });
  return recap;
}

/** Le texte du récapitulatif (résumé IA si dispo, sinon enchaînement des réponses). */
async function construireRecap(session, options = {}) {
  const reponses = session.reponses.length ? session.reponses : ['(le membre n\u2019a rien répondu)'];
  const detail = reponses.map((r, i) => `• ${r}`).join('\n').slice(0, 1400);
  return {
    resumeCourts: reponses.map((r) => r.slice(0, 60)),
    texte: [
      `## 📋 Récapitulatif pour le staff — ${session.createurTag || 'membre'}`,
      options.raison ? `_${options.raison}_` : '_Le membre a terminé son tour de questions._',
      '',
      `**Ce qu\u2019il/elle souhaite (résumé de ses réponses) :**`,
      resumeSimple(reponses),
      '',
      `**Le détail recueilli :**`,
      detail,
      '',
      '-# Clic « 🙌 Je prends en charge » et je me retire définitivement de ce ticket. « 🔁 » si tu préfères que je continue à creuser avec lui.',
    ].join('\n'),
  };
}

function resumeSimple(reponses) {
  return `> ${reponses[0]}${reponses.length > 1 ? `\n> (+ ${reponses.length - 1} précision(s) ci-dessous)` : ''}`;
}

/** Boutons du récapitulatif. */
async function traiterBouton(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('asst:')) return false;
  const [, action, canalId] = id.split(':');
  const session = sessions.get(canalId);

  if (action === 'prendre') {
    if (!session || session.phase === 'termine') {
      return interaction.reply({ content: 'Ce ticket est déjà pris en charge 👍', flags: 64 }).catch(() => null) || true;
    }
    session.phase = 'termine';
    CLOS.set(canalId, Date.now());
    sauvegarder();
    await interaction.reply({
      content: `🙌 C\u2019est noté, **${interaction.user.username}** prend la main. Je me retire de ce ticket — je n'y dirai plus rien. Bonne discussion !`,
    }).catch(() => null);
    supprimerSession(canalId);
    return true;
  }

  if (action === 'relancer') {
    if (!session) {
      return interaction.reply({ content: 'Cet entretien est terminé (session expirée).', flags: 64 }).catch(() => null) || true;
    }
    session.phase = 'questions';
    session.derniereActivite = Date.now();
    sauvegarder();
    await interaction.reply({ content: '🔁 OK, je reprends doucement avec lui.', flags: 64 }).catch(() => null);
    const canal = interaction.message?.channel || interaction.guild?.channels?.cache?.get(canalId);
    if (canal) await envoyer(canal, '🙂 Petit complément ! Le staff préfère que je creuse encore un peu avec toi :');
    if (interaction.message) {
      await interaction.message.edit({
        content: `${interaction.message.content}\n\n-# Relancé par ${interaction.user.username}.`,
      }).catch(() => null);
    }
    return true;
  }

  return false;
}

// ─────────────────────────── veille silence ───────────────────────────
function demarrerVeille() {
  if (typeof setInterval !== 'function') return;
  tick();                                   // rattrape ce qui a traîné pendant un arrêt
  setInterval(tick, 60 * 1000).unref?.();   // puis une fois par minute
}

/** Un tour d'horloge (exposable pour les tests) : rappels puis abandon poli. */
function tick(maintenant = Date.now()) {
  const promesses = [];
  for (const [canalId, s] of [...sessions]) {
    if (s.phase !== 'questions' && s.phase !== 'reponse_finale') continue;
    const silence = maintenant - (s.derniereActivite || 0);
    const guild = s._guild;                                  // fourni par le bot au démarrage (cache)
    if (!guild) continue;
    const canal = guild.channels?.cache?.get(canalId);
    if (!canal) continue;
    if (silence > ABANDON_MS) {
      promesses.push(finaliser(s, canal, { raison: 'Silence du membre : je transmets déjà ce que j\u2019ai collecté.' }));
    } else if (silence > SILENCE_MS && !s.relanceFaite) {
      s.relanceFaite = true;
      s.derniereActivite = maintenant - SILENCE_MS;            // évite le rappel en boucle
      sauvegarder();
      promesses.push(envoyer(canal, '🙂 Pas de pression ! Réponds quand tu veux — je reste là. (Si tu préfères attendre un humain, dis-le, je préviens le staff.)'));
    }
  }
  return Promise.all(promesses);
}

/** Le bot donne son client (cache des guilds) au module pour la veille. */
function marquerClos(canalId) {
  CLOS.set(canalId, Date.now());
  sauvegarder();
}

function fournirClient(client) {
  CLIENT = client;
  for (const s of sessions.values()) s._guild = client.guilds?.cache?.get(s.guildId) || null;
  const brut = toutes();
  for (const [canalId, s] of Object.entries(brut)) {
    if (!sessions.has(canalId) && s && s.phase !== 'termine') sessions.set(canalId, s);
    if (CLIENT) s._guild = CLIENT.guilds?.cache?.get(s.guildId) || null;
  }
}

let CLIENT = null;

module.exports = {
  traiterMessage,
  traiterBouton,
  demarrer,
  finaliser,
  estChannelTicket,
  reglagesAssistant,
  recharger,
  fournirClient,
  demarrerVeille,
  tick,
  listeQuestions,
  sessions,
  CLOS,
  Q_FINALE,
  marquerClos,
  // pour les tests uniquement :
  __setIA(fn) { IA_DE_TEST = fn; },
};
