/**
 * config.js — réglages lus depuis le fichier .env
 * Rien n'est codé en dur : tout se règle sur Render sans toucher au code.
 */
require('dotenv').config();

function nombre(valeur, defaut) {
  const n = parseInt(valeur, 10);
  return Number.isFinite(n) ? n : defaut;
}

const config = {
  // ─── identité du bot ───
  token: process.env.DISCORD_TOKEN || '',
  botId: process.env.BOT_ID || '',
  prefixe: process.env.PREFIXE || '!',

  // ─── endpoints de diagnostic ───
  sante: {
    // Renseigne JETON_SANTE dans Render pour verrouiller /test-ia et /diagnostic
    // (personne d'autre ne pourra brûler ton quota IA). Vide = limites horaires.
    jeton: process.env.JETON_SANTE || '',
  },

  // ─── IA ───
  gemini: {
    cle: process.env.GEMINI_API_KEY || '',
    modele: process.env.GEMINI_MODEL || 'gemini-flash-lite-latest',
    // Le « lite » répond en ~1 s. Si un modèle disparaît, on glisse au suivant.
    secours: ['gemini-flash-lite-latest', 'gemini-3.5-flash', 'gemini-2.5-flash'],
  },
  groq: {
    cle: process.env.GROQ_API_KEY || '',
    modele: process.env.GROQ_MODEL || 'qwen/qwen3.8-27b',
    // Idem chez Groq : la liste des modèles change souvent.
    secours: ['qwen/qwen3.8-27b', 'openai/gpt-oss-120b', 'allam-2-7b'],
  },
  ia: {
    temperature: parseFloat(process.env.IA_TEMPERATURE || '0.7'),
    maxTokens: nombre(process.env.IA_MAX_TOKENS, 900),
    memoire: nombre(process.env.IA_MEMOIRE, 12),          // messages gardés par salon
    limiteParMinute: nombre(process.env.IA_LIMITE_MINUTE, 6),
    pause: nombre(process.env.IA_PAUSE_MS, 15000),        // anti-flood côté utilisateur
  },

  // ─── modération ───
  modo: {
    spamMessages: nombre(process.env.AUTOMOD_SPAM_MESSAGES, 6),
    spamSecondes: nombre(process.env.AUTOMOD_SPAM_SECONDES, 8),
    majusculesMin: nombre(process.env.AUTOMOD_MAJUSCULES_MIN, 12),
    raidInscrits: nombre(process.env.AUTOMOD_RAID_INSCRITS, 6),
    raidSecondes: nombre(process.env.AUTOMOD_RAID_SECONDES, 20),
  },

  // ─── hébergement ───
  port: nombre(process.env.PORT, 3000),
  version: '1.8.0',
  debut: Date.now(),
};

/** Quels fournisseurs d'IA ont une clé ? (dans l'ordre de préférence)
 *  Groq d'abord : il répond en moins d'une seconde. Réglable avec IA_ORDRE=gemini,groq
 */
function fournisseursIA() {
  const disponibles = new Set();
  if (config.gemini.cle) disponibles.add('gemini');
  if (config.groq.cle) disponibles.add('groq');
  const ordre = (process.env.IA_ORDRE || 'groq,gemini')
    .split(',').map((x) => x.trim().toLowerCase()).filter((x) => disponibles.has(x));
  // Les clés actives non citées dans IA_ORDRE sont quand même essayées en secours.
  for (const cle of disponibles) if (!ordre.includes(cle)) ordre.push(cle);
  return ordre;
}

/** Vérification au démarrage : on prévient clairement de ce qui manque. */
function verifierConfig() {
  const problemes = [];
  if (!config.token) problemes.push('DISCORD_TOKEN manquant');
  if (fournisseursIA().length === 0) {
    problemes.push('Aucune clé IA (GEMINI_API_KEY ou GROQ_API_KEY)');
  }
  return { ok: problemes.length === 0, problemes };
}

module.exports = { config, fournisseursIA, verifierConfig };
