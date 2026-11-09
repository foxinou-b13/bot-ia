/**
 * utils/stockage.js — petite base de données en JSON (aucun service payant).
 *
 * Sur Render gratuit le disque est remis à zéro à chaque redéploiement :
 * les avertissements et réglages survivent aux redémarrages, pas aux mises
 * en ligne. C'est suffisant pour un serveur, et zéro dépendance.
 */
const fs = require('fs');
const path = require('path');
const persistance = require('./persistance');

const DOSSIER = path.join(__dirname, '..', 'data');

function chemin(nom) {
  return path.join(DOSSIER, `${nom}.json`);
}

function assurerDossier() {
  if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER, { recursive: true });
}

/** Lit un fichier JSON ; renvoie la valeur par défaut si absent ou abîmé. */
function lire(nom, defaut = {}) {
  try {
    assurerDossier();
    const f = chemin(nom);
    if (!fs.existsSync(f)) return defaut;
    const brut = fs.readFileSync(f, 'utf8').trim();
    if (!brut) return defaut;
    return JSON.parse(brut);
  } catch (erreur) {
    console.error(`⚠️ Lecture ${nom}.json impossible :`, erreur.message);
    return defaut;
  }
}

/** Écrit un JSON de façon sûre (fichier temporaire puis renommage). */
function ecrire(nom, donnees) {
  try {
    assurerDossier();
    const f = chemin(nom);
    const tmp = `${f}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(donnees, null, 1), 'utf8');
    fs.renameSync(tmp, f);
    try { persistance.publier(nom, donnees); } catch { /* la base ne doit jamais bloquer le bot */ }
    return true;
  } catch (erreur) {
    console.error(`⚠️ Écriture ${nom}.json impossible :`, erreur.message);
    return false;
  }
}

// ─── réglages par serveur ───
const REGLAGES_DEFAUT = {
  logs: null,
  guide: { regles: null, support: null },
  cfgSection: null,
  cfgItem: null,
  bienvenue: { salon: null, message: null, role: null, langue: 'fr', fond: null },
  automod: {
    spam: true,
    liens: true,
    insultes: true,
    majuscules: false,
    raid: true,
    salonExempt: null,
  },
  journal: { suppressions: true, modifications: true, sorties: true },
  assistant: { actif: false, categorie: null, panneau: null, alerte: null, staffRole: null, questions: [] },
  tickets: { actif: false, categorie: null, panneau: null, logs: null, staffRole: null, titre: null, texte: null, mode: 'bouton', types: [], vue: 'style' },
  muteRole: null,
  ia: { active: true, salonBloques: [], consigne: '' },
};

function tousLesReglages() {
  return lire('config', {});
}

function reglages(guildId) {
  const tous = tousLesReglages();
  const siens = tous[guildId] || {};
  return {
    ...REGLAGES_DEFAUT,
    ...siens,
    bienvenue: { ...REGLAGES_DEFAUT.bienvenue, ...(siens.bienvenue || {}) },
    guide: { ...REGLAGES_DEFAUT.guide, ...(siens.guide || {}) },
    automod: { ...REGLAGES_DEFAUT.automod, ...(siens.automod || {}) },
    ia: { ...REGLAGES_DEFAUT.ia, ...(siens.ia || {}), salonBloques: [...((siens.ia || {}).salonBloques || [])] },
    journal: { ...REGLAGES_DEFAUT.journal, ...(siens.journal || {}) },
    assistant: { ...REGLAGES_DEFAUT.assistant, ...(siens.assistant || {}), questions: [...((siens.assistant || {}).questions || [])] },
    tickets: { ...REGLAGES_DEFAUT.tickets, ...(siens.tickets || {}), types: [...((siens.tickets || {}).types || [])] },
  };
}

function majReglages(guildId, morceau) {
  const tous = tousLesReglages();
  const avant = tous[guildId] || {};
  tous[guildId] = {
    ...avant,
    ...morceau,
    bienvenue: { ...(avant.bienvenue || {}), ...(morceau.bienvenue || {}) },
    guide: { ...(avant.guide || {}), ...(morceau.guide || {}) },
    automod: { ...(avant.automod || {}), ...(morceau.automod || {}) },
    ia: { ...(avant.ia || {}), ...(morceau.ia || {}) },
    journal: { ...(avant.journal || {}), ...(morceau.journal || {}) },
    assistant: { ...(avant.assistant || {}), ...(morceau.assistant || {}) },
    tickets: { ...(avant.tickets || {}), ...(morceau.tickets || {}) },
  };
  if (morceau.bienvenue === undefined) tous[guildId].bienvenue = avant.bienvenue || REGLAGES_DEFAUT.bienvenue;
  if (morceau.automod === undefined) tous[guildId].automod = avant.automod || REGLAGES_DEFAUT.automod;
  return ecrire('config', tous);
}

// ─── avertissements ───
function cleAvert(guildId, userId) {
  return `${guildId}:${userId}`;
}

function avertissements(guildId, userId) {
  return lire('warns', {})[cleAvert(guildId, userId)] || [];
}

function ajouterAvert(guildId, userId, avert) {
  const tous = lire('warns', {});
  const cle = cleAvert(guildId, userId);
  tous[cle] = [...(tous[cle] || []), avert];
  ecrire('warns', tous);
  return tous[cle];
}

function retirerAvert(guildId, userId, index) {
  const tous = lire('warns', {});
  const cle = cleAvert(guildId, userId);
  const liste = tous[cle] || [];
  if (index < 0 || index >= liste.length) return { ok: false, liste };
  const [retire] = liste.splice(index, 1);
  tous[cle] = liste;
  ecrire('warns', tous);
  return { ok: true, retire, liste };
}

/** Texte des repères à injecter dans le prompt IA (chaîne vide si rien de réglé). */
function repereIA(guildId) {
  const r = reglages(guildId);
  const morceaux = [];
  if (r.guide.regles) morceaux.push(`les règles du serveur se lisent dans <#${r.guide.regles}>`);
  if (r.guide.support) morceaux.push(`pour contacter le staff, c'est dans <#${r.guide.support}>`);
  if (r.bienvenue.salon) morceaux.push(`les nouveaux membres sont accueillis dans <#${r.bienvenue.salon}>`);
  if (!morceaux.length) return '';
  return `Repères officiels du serveur (à communiquer poliment et avec le lien exact quand un membre cherche ça) : ${morceaux.join(' ; ')}. `
    + 'Si on te demande « où sont les règles », « qui contacter », « comment parler à un modo », réponds en une phrase avec le lien concerné. '
    + 'N\'INVENTE JAMAIS un salon ou un lien qui n\'est pas dans cette liste.';
}

module.exports = {
  repereIA,
  DOSSIER,
  lire,
  ecrire,
  reglages,
  majReglages,
  REGLAGES_DEFAUT,
  avertissements,
  ajouterAvert,
  retirerAvert,
  /** Supprime TOUS les avertissements d'un membre (droit à l'effacement). */
  effacerAvertissements(guildId, userId) {
    const tous = lire('warns', {});
    const cle = cleAvert(guildId, userId);
    const avant = (tous[cle] || []).length;
    delete tous[cle];
    ecrire('warns', tous);
    return avant;
  },
};
