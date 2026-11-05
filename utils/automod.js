/**
 * utils/automod.js — la détection automatique.
 * Uniquement des fonctions pures : faciles à tester, aucune surprise.
 */
const { config } = require('../config');

// ─── insultes (français courant, sans les pires : on reste utilisable) ───
const INSULTES = [
  'abruti', 'abrutie', 'batard', 'bâtard', 'bouffon', 'connard', 'connarde',
  'conne', 'cretin', 'crétin', 'crétine', 'debile', 'débile', 'encule', 'enculé',
  'enculer', 'fdp', 'ferme ta gueule', 'ftg', 'merdeux', 'nique', 'niquer',
  'ntm', 'pd', 'putain', 'pute', 'salope', 'salaud', 'sg', 'suce', 'tg',
  'ta gueule', 'trouduc', 'va te faire', 'viol', 'zgueg',
];

// ─── liens autorisés / motif ───
const INVITATION = /(?:discord\.(?:gg|me|io)|discordapp\.com\/invite|discord\.com\/invite)\/[a-z0-9-]+/i;
const URL_MOTIF = /(?:https?:\/\/|www\.)[^\s]+/gi;

/** Minuscules + accents retirés, pour comparer sans se faire piéger. */
function normaliser(texte) {
  return String(texte || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[0@]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/3/g, 'e')
    .replace(/4/g, 'a')
    .replace(/5|\$/g, 's')
    .replace(/7/g, 't')
    .replace(/[^a-z0-9\s']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function contientInvitation(texte) {
  return INVITATION.test(String(texte || ''));
}

/** Nombre de liens (hors pièces jointes Discord). */
function compteLiens(texte) {
  const trouve = String(texte || '').match(URL_MOTIF);
  return trouve ? trouve.length : 0;
}

/** Renvoie l'insulte trouvée, ou null. */
function insulteTrouvee(texte) {
  const propre = normaliser(texte);
  if (!propre) return null;
  const mots = propre.split(' ');
  for (const insulte of INSULTES) {
    if (insulte.includes(' ')) {
      if (propre.includes(insulte)) return insulte;
    } else if (mots.includes(insulte)) {
      return insulte;
    }
  }
  return null;
}

/** Trop de majuscules ? (on ignore les messages sans lettres) */
function tropDeMajuscules(texte, minimum = config.modo.majusculesMin) {
  const lettres = String(texte || '').replace(/[^a-zA-ZÀ-ÿ]/g, '');
  if (lettres.length < minimum) return false;
  const majuscules = lettres.replace(/[^A-ZÀ-Þ]/g, '').length;
  return majuscules / lettres.length > 0.7;
}

/**
 * Spam : trop de messages dans une fenêtre courte.
 * @param {number[]} horodatages messages précédents de la personne (ms)
 * @param {number} maintenant
 */
function estSpam(horodatages, maintenant = Date.now(), reglages = {}) {
  const max = reglages.messages ?? config.modo.spamMessages;
  const fenetre = (reglages.secondes ?? config.modo.spamSecondes) * 1000;
  const recents = [...horodatages, maintenant].filter((t) => maintenant - t <= fenetre);
  return { spam: recents.length >= max, nombre: recents.length, recents };
}

/**
 * Analyse complète d'un message.
 * @returns {{action: 'aucune'|'supprimer'|'alerter', raison: string|null, details: object}}
 */
function analyser(texte, options = {}) {
  const reglages = options.reglages || {};
  const contenu = String(texte || '');

  if (contientInvitation(contenu)) {
    return { action: 'supprimer', raison: 'invitation Discord', details: {} };
  }

  const liensMax = options.liensMax ?? 2;
  if (compteLiens(contenu) > liensMax) {
    return { action: 'supprimer', raison: 'trop de liens', details: { liens: compteLiens(contenu) } };
  }

  const insulte = insulteTrouvee(contenu);
  if (insulte) {
    return { action: 'supprimer', raison: 'propos insultants', details: { mot: insulte } };
  }

  if (reglages.majuscules && tropDeMajuscules(contenu)) {
    return { action: 'alerter', raison: 'trop de majuscules', details: {} };
  }

  return { action: 'aucune', raison: null, details: {} };
}

/** Vrai si le salon est exempté (réglage automatique ignoré). */
function salonExempt(channelId, reglagesAutomod = {}) {
  return Boolean(reglagesAutomod.salonExempt && reglagesAutomod.salonExempt === channelId);
}

module.exports = {
  INSULTES,
  normaliser,
  contientInvitation,
  compteLiens,
  insulteTrouvee,
  tropDeMajuscules,
  estSpam,
  analyser,
  salonExempt,
};
