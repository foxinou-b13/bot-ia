/**
 * utils/automod.js — la détection automatique.
 * Uniquement des fonctions pures : faciles à tester, aucune surprise.
 */
const { config } = require('../config');

// ─── insultes : racines ascii (texte normalisé avant comparaison). FR + EN + abréviations SMS. ───
// Choix mûrs : rien qui soit un mot courant (« retard » = retard de bus en français,
// « douche » = la douche, « violent », « coucou »… — tous écartés, vérifiés en test).
const INSULTES = [
  // français
  'abruti', 'abrutie', 'andouille', 'batard', 'batarde', 'bite', 'bouffon', 'connard',
  'connasse', 'connerie', 'conne', 'couille', 'cretin', 'debile', 'emmerde', 'encule',
  'enfoire', 'enflure', 'fdp', 'ferme ta gueule', 'ftg', 'gatte', 'idiot', 'imbecile',
  'lopette', 'merdeux', 'mrd', 'nique', 'shitty', 'nq', 'ntm', 'pd', 'pede',
  'pedophile', 'pedo', 'petasse', 'putain', 'pute', 'ptn', 'ptnk', 'sg', 'suce', 'salop',
  'salaud', 'ta gueule', 'teub', 'teubon', 'tg', 'trouduc', 'trouducul', 'va te faire',
  'viol', 'violeur', 'zgueg', 'zob',
  // expressions
  'fils de pute', 'fille de pute', 'trou du cul', 'vas y encule', 'sale ordure', 'sales ordures',
  // anglais (les mêmes mots reviennent dans les serves FR gaming)
  'arse', 'arsehole', 'asshole', 'asshat', 'asswipe', 'bastard', 'bitch', 'btch',
  'bullshit', 'cunt', 'dick', 'dickhead', 'dickwad', 'dipshit', 'douchebag', 'dumbass',
  'fuck', 'fucking', 'fucker', 'fucking', 'shitting', 'motherfuck', 'jackass', 'kys', 'kill yourself', 'loser',
  'moron', 'nigga', 'nigger', 'fag', 'faggot', 'nonce', 'prick', 'retarded', 'scumbag',
  'shit', 'shithead', 'skank', 'slut', 'spic', 'tosser', 'tranny', 'turd', 'twat',
  'wanker', 'whore',
];

// Terminaisons tolérées autour d'une racine : pluriels, féminin, formes verbales.
const VARIANTS = ['s', 'es', 'ed', 'er', 'r', 'ers', 'ez', 'ee', 'ees', 'eur', 'euse', 'euses'];

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

/** Motifs d'arnaques connues (nitro gratuit, steam gift, faux supports Discord…). */
const LIENS_MALVEILLANTS = [
  { regex: /\b(nitro|n1tro)\b.{0,30}\b(gratuit|free|gift|cadeau|offert|claim)\b/i, raison: 'arnaque Nitro' },
  { regex: /\b(gratuit|free|gift|cadeau|offert|claim)\b.{0,30}\bnitro\b/i, raison: 'arnaque Nitro' },
  { regex: /\bsteam\b.{0,25}\b(gift|cadeau|credit|crédit|argent)\b/i, raison: 'arnaque Steam' },
  { regex: /\b(gift|cadeau)\b.{0,25}\bsteam\b/i, raison: 'arnaque Steam' },
  { regex: /discord?app\.(com|net)\/(gift|giveaway)|dliscord|dsicord|qnitro|gift-?gg|g1ft/i, raison: 'faux lien Discord' },
  { regex: /airdrop.{0,20}(crypto|token|wallet)|connect.{0,12}wallet|reconnect.{0,12}(your )?account/i, raison: 'arnaque crypto' },
  { regex: /(vérifie|verifie|confirme).{0,18}(compte|account).{0,40}(nitro|banni|suspendu|interdit)/i, raison: 'fausse vérification de compte' },
];

/** Motif d'arnaque seulement s'il y a un lien ou un domaine douteux à côté. */
function lienMalveillant(texte) {
  const contenu = String(texte || '');
  const aUnLien = /(?:https?:\/\/|www\.)\S+/i.test(contenu)
    || /\b[a-z0-9-]+\.(?:tk|ml|ga|cf|gq|xyz|top|click|icu|sbs)\b/i.test(contenu)
    // lien écrit en clair, sans http:// (fréquent dans les spams) :
    || /\b[a-z0-9-]+(?:-[a-z0-9-]+)*\.(?:com|net|org|gg|io|fr|shop|store|site|online|live)\b/i.test(contenu);
  if (!aUnLien) return null;
  for (const motif of LIENS_MALVEILLANTS) {
    if (motif.regex.test(contenu)) return motif.raison;
  }
  return null;
}

function contientInvitation(texte) {
  return INVITATION.test(String(texte || ''));
}

/** Nombre de liens (hors pièces jointes Discord). */
function compteLiens(texte) {
  const trouve = String(texte || '').match(URL_MOTIF);
  return trouve ? trouve.length : 0;
}

/** Renvoie la racine d'insulte trouvée, ou null. Gère pluriels/féminin/verbes sans faux positifs. */
function insulteTrouvee(texte) {
  const propre = normaliser(texte);
  if (!propre) return null;
  const mots = propre.split(' ');
  for (const racine of INSULTES) {
    if (racine.includes(' ')) {                       // expression en plusieurs mots
      if (propre.includes(racine)) return racine;
      continue;
    }
    if (racine.length < 4) {                          // sigles (fdp, ntm…) : mot entier seulement
      if (mots.includes(racine)) return racine;
      continue;
    }
    for (const mot of mots) {
      if (mot === racine) return racine;
      if (mot.startsWith(racine) && VARIANTS.includes(mot.slice(racine.length))) return racine;
      if (racine.length >= 5 && mot.endsWith(racine) && VARIANTS.includes(mot.slice(0, mot.length - racine.length))) return racine;
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
  // Un module n'est actif que si le serveur l'a laissé activé (panneau /config).
  const liensActifs = reglages.liens !== false;
  const insultesActives = reglages.insultes !== false;
  const contenu = String(texte || '');

  if (liensActifs) {
    if (contientInvitation(contenu)) {
      return { action: 'supprimer', raison: 'invitation Discord', details: {} };
    }
    const malveillant = lienMalveillant(contenu);
    if (malveillant) {
      return { action: 'supprimer', raison: `lien malveillant probable (${malveillant})`, details: {} };
    }
    const liensMax = options.liensMax ?? 2;
    if (compteLiens(contenu) > liensMax) {
      return { action: 'supprimer', raison: 'trop de liens', details: { liens: compteLiens(contenu) } };
    }
  }

  if (insultesActives) {
    const insulte = insulteTrouvee(contenu);
    if (insulte) {
      return { action: 'supprimer', raison: 'propos insultants', details: { mot: insulte } };
    }
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
  lienMalveillant,
  compteLiens,
  insulteTrouvee,
  tropDeMajuscules,
  estSpam,
  analyser,
  salonExempt,
};
