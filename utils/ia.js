/**
 * utils/ia.js — le cerveau du bot.
 *
 * Deux fournisseurs gratuits, avec bascule automatique :
 *   1. Google Gemini   (GEMINI_API_KEY)
 *   2. Groq            (GROQ_API_KEY)
 *
 * Si le premier tombe (quota, panne, clé fausse), on essaie le suivant
 * sans que l'utilisateur voie d'erreur. Aucune dépendance : fetch natif.
 */
const { config, fournisseursIA } = require('../config');

const DELAI_MAX = 25000;          // 25 s maximum par appel
const PHRASE_ECHEC = "Je n'arrive pas à réfléchir pour l'instant (mes fournisseurs d'IA ne répondent pas). Réessaie dans une minute.";

/** Erreur lisible, jamais de détail technique côté Discord. */
class ErreurIA extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'ErreurIA';
    this.details = details;
  }
}

function avecDelai(promesse, ms) {
  const controleur = new AbortController();
  const minuteur = setTimeout(() => controleur.abort(), ms);
  return { controleur, minuteur, signal: controleur.signal };
}

// ─────────────────────────── Gemini ───────────────────────────
async function appelerGemini({ systeme, messages }, fetchImpl, signal) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/`
    + `${encodeURIComponent(config.gemini.modele)}:generateContent?key=${encodeURIComponent(config.gemini.cle)}`;

  const corps = {
    systemInstruction: { parts: [{ text: systeme }] },
    contents: messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.contenu }],
    })),
    generationConfig: {
      temperature: config.ia.temperature,
      maxOutputTokens: config.ia.maxTokens,
    },
  };

  const reponse = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(corps),
    signal,
  });

  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => '');
    throw new ErreurIA(`Gemini ${reponse.status}`, { statut: reponse.status, texte: texte.slice(0, 300) });
  }

  const data = await reponse.json();
  const parties = data?.candidates?.[0]?.content?.parts || [];
  const texte = parties.map((p) => p.text || '').join('').trim();
  if (!texte) throw new ErreurIA('Gemini : réponse vide');
  return texte;
}

// ─────────────────────────── Groq ───────────────────────────
async function appelerGroq({ systeme, messages }, fetchImpl, signal) {
  const reponse = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.groq.cle}`,
    },
    body: JSON.stringify({
      model: config.groq.modele,
      temperature: config.ia.temperature,
      max_tokens: config.ia.maxTokens,
      messages: [
        { role: 'system', content: systeme },
        ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.contenu })),
      ],
    }),
    signal,
  });

  if (!reponse.ok) {
    const texte = await reponse.text().catch(() => '');
    throw new ErreurIA(`Groq ${reponse.status}`, { statut: reponse.status, texte: texte.slice(0, 300) });
  }

  const data = await reponse.json();
  const texte = (data?.choices?.[0]?.message?.content || '').trim();
  if (!texte) throw new ErreurIA('Groq : réponse vide');
  return texte;
}

const APPELS = { gemini: appelerGemini, groq: appelerGroq };

/**
 * Pose une question à l'IA.
 * @param {{systeme:string, messages:Array<{role:string, contenu:string}>}} demande
 * @returns {Promise<{texte:string, fournisseur:string, essais:Array}>}
 */
async function demander(demande, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const ordre = options.fournisseurs || fournisseursIA();

  if (ordre.length === 0) {
    throw new ErreurIA('Aucune clé IA configurée', { essais: [] });
  }

  const essais = [];
  for (const nom of ordre) {
    const appel = APPELS[nom];
    if (!appel) continue;
    const { signal, minuteur } = avecDelai(null, options.delai || DELAI_MAX);
    try {
      const texte = await appel(demande, fetchImpl, signal);
      essais.push({ fournisseur: nom, ok: true });
      return { texte, fournisseur: nom, essais };
    } catch (erreur) {
      essais.push({ fournisseur: nom, ok: false, erreur: erreur.message });
      console.error(`⚠️ IA ${nom} indisponible : ${erreur.message}`);
    } finally {
      clearTimeout(minuteur);
    }
  }

  throw new ErreurIA(PHRASE_ECHEC, { essais });
}

// ─────────────────────────── mémoire par salon ───────────────────────────
const memoires = new Map();            // `${guildId}:${channelId}` → messages
const derniersAppels = new Map();      // userId → horodatage (anti-flood)

function cleMemoire(guildId, channelId) {
  return `${guildId || 'mp'}:${channelId}`;
}

function memoire(guildId, channelId) {
  return memoires.get(cleMemoire(guildId, channelId)) || [];
}

function memoriser(guildId, channelId, role, contenu) {
  const cle = cleMemoire(guildId, channelId);
  const liste = memoires.get(cle) || [];
  liste.push({ role, contenu: String(contenu).slice(0, 2000) });
  while (liste.length > config.ia.memoire) liste.shift();
  memoires.set(cle, liste);
  return liste;
}

function oublier(guildId, channelId) {
  memoires.delete(cleMemoire(guildId, channelId));
}

/** true si l'utilisateur doit patienter encore (anti-flood). */
function tropRapide(userId, options = {}) {
  const pause = options.pause ?? config.ia.pause;
  const maintenant = options.maintenant ?? Date.now();
  const dernier = derniersAppels.get(userId) || 0;
  if (maintenant - dernier < pause) {
    return { bloque: true, resteSecondes: Math.ceil((pause - (maintenant - dernier)) / 1000) };
  }
  derniersAppels.set(userId, maintenant);
  return { bloque: false, resteSecondes: 0 };
}

function reinitialiserLimites() {
  derniersAppels.clear();
  memoires.clear();
}

// ─────────────────────────── texte pour Discord ───────────────────────────
/** Découpe proprement un texte trop long (limite Discord : 2000 caractères). */
function decouper(texte, limite = 1900) {
  const morceaux = [];
  let reste = String(texte || '').trim();
  while (reste.length > limite) {
    let coupe = reste.lastIndexOf('\n', limite);
    if (coupe < limite * 0.5) coupe = reste.lastIndexOf(' ', limite);
    if (coupe < limite * 0.5) coupe = limite;
    morceaux.push(reste.slice(0, coupe).trim());
    reste = reste.slice(coupe).trim();
  }
  if (reste) morceaux.push(reste);
  return morceaux.length ? morceaux : ['…'];
}

/** Consigne de comportement envoyée à l'IA (personnalité du bot). */
function consigneSysteme(contexte = {}) {
  const serveur = contexte.serveur ? `Tu discutes sur le serveur Discord « ${contexte.serveur} ».` : '';
  const pseudo = contexte.pseudo ? `Ton interlocuteur s'appelle ${contexte.pseudo}.` : '';
  return [
    "Tu es Otaku, un assistant Discord francophone, sympa et direct.",
    "Tu réponds TOUJOURS en français, avec un ton chaleureux mais sans excès d'emojis (2 maximum).",
    "Tes réponses sont courtes : 1 à 4 phrases, sauf si on te demande un texte long.",
    "Tu ne prétends jamais être un humain : si on te demande, tu dis que tu es le bot du serveur.",
    "Tu n'inventes pas de commandes : les commandes du bot sont /ask, /aide, /ban, /kick, /mute, /warn, /avertissements, /clear, /slowmode, /lock, /unlock, /role, /automod, /logs, /bienvenue, /ia-reset.",
    "Si une question sort de ton domaine ou demande une action de modération, tu invites poliment à utiliser la commande adaptée.",
    serveur,
    pseudo,
  ].filter(Boolean).join(' ');
}

module.exports = {
  ErreurIA,
  PHRASE_ECHEC,
  demander,
  decouper,
  consigneSysteme,
  memoire,
  memoriser,
  oublier,
  tropRapide,
  reinitialiserLimites,
  quatre: fournisseursIA,
};
