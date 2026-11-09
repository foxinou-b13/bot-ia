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
const securite = require('./securite-ia');

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

  // On essaie le modèle configuré, puis les modèles de secours.
  const modeles = [...new Set([config.gemini.modele, ...(config.gemini.secours || [])])];
  let derniere = null;

  for (const modele of modeles) {
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/'
      + `${encodeURIComponent(modele)}:generateContent?key=${encodeURIComponent(config.gemini.cle)}`;

    const reponse = await fetchImpl(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal,
    });

    if (!reponse.ok) {
      const texte = await reponse.text().catch(() => '');
      derniere = new ErreurIA(`Gemini ${reponse.status} (${modele})`,
        { statut: reponse.status, modele, texte: texte.slice(0, 200) });
      // 404 = modèle disparu, 429 = quota : on tente le suivant.
      if ([400, 404, 429, 503].includes(reponse.status)) continue;
      throw derniere;
    }

    const data = await reponse.json();
    const parties = data?.candidates?.[0]?.content?.parts || [];
    const texte = parties.map((p) => p.text || '').join('').trim();
    if (texte) return texte;
    derniere = new ErreurIA(`Gemini : réponse vide (${modele})`, { modele });
  }

  throw derniere || new ErreurIA('Gemini : aucun modèle disponible');
}

// ─────────────────────────── Groq ───────────────────────────
async function appelerGroq({ systeme, messages }, fetchImpl, signal) {
  const modeles = [...new Set([config.groq.modele, ...(config.groq.secours || [])])];
  const messagesCorps = [
    { role: 'system', content: systeme },
    ...messages.map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.contenu })),
  ];
  let derniere = null;

  for (const modele of modeles) {
    const reponse = await fetchImpl('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.groq.cle}`,
      },
      body: JSON.stringify({
        model: modele,
        temperature: config.ia.temperature,
        max_tokens: config.ia.maxTokens,
        messages: messagesCorps,
      }),
      signal,
    });

    if (!reponse.ok) {
      const texte = await reponse.text().catch(() => '');
      derniere = new ErreurIA(`Groq ${reponse.status} (${modele})`,
        { statut: reponse.status, modele, texte: texte.slice(0, 200) });
      if ([400, 404, 429, 503].includes(reponse.status)) continue;
      throw derniere;
    }

    const data = await reponse.json();
    const texte = (data?.choices?.[0]?.message?.content || '').trim();
    if (texte) return texte;
    derniere = new ErreurIA(`Groq : réponse vide (${modele})`, { modele });
  }

  throw derniere || new ErreurIA('Groq : aucun modèle disponible');
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

  const erreur = new ErreurIA(PHRASE_ECHEC, { essais });
  return Promise.reject(erreur);
}

// ─────────────────────────── langues ───────────────────────────
/**
 * L'IA répond dans LA LANGUE de la question (le serveur reste francophone
 * par défaut : courte question ambigüe → français).
 */
const LANGUES = { fr: 'français', en: 'anglais', es: 'espagnol', de: 'allemand', it: 'italien', pt: 'portugais', nl: 'néerlandais' };

const INDICES_LANGUES = {
  fr: ['le', 'la', 'les', 'un', 'une', 'des', 'est', 'suis', 'pour', 'avec', 'quoi', 'comment', 'pourquoi', 'quand', 'vous', 'tu', 'je', 'qui', 'sur', 'dans', 'pas', 'bonjour', 'merci', 'peux', 'veux', 'faire', 'aussi', 'comme', 'cette', 'nous', 'elle', 'il'],
  en: ['the', 'is', 'are', 'you', 'what', 'how', 'why', 'when', 'please', 'hello', 'thanks', 'for', 'with', 'that', 'this', 'have', 'has', 'not', 'about', 'would', 'could', 'your', 'was', 'were', 'does', 'who', 'which', 'there', 'they', 'can', 'do'],
  es: ['el', 'los', 'las', 'una', 'que', 'está', 'como', 'cuando', 'porque', 'hola', 'gracias', 'por', 'para', 'con', 'dónde', 'donde', 'también', 'tambien', 'muy', 'puedes', 'quiero', 'esto',
        'bueno', 'buenas', 'días', 'dias', 'hoy', 'ahora', 'luego', 'pero', 'si', 'sí', 'tú', 'tu', 'yo', 'nosotros', 'vosotros', 'él', 'el', 'mi', 'me', 'te', 'se', 'es', 'son', 'hay', 'ha'],
  de: ['der', 'die', 'das', 'und', 'ist', 'nicht', 'ein', 'eine', 'wie', 'was', 'warum', 'wann', 'bitte', 'danke', 'hallo', 'ich', 'du', 'wir', 'mit', 'für', 'auf', 'auch', 'sehr', 'kann', 'habe',
        'geht', 'heute', 'dir', 'dein', 'deine', 'mein', 'meine', 'mich', 'dich', 'hier', 'dann', 'mal', 'schon', 'noch', 'aber', 'wenn', 'weil', 'man', 'nur', 'oder', 'sie', 'es', 'ja', 'nein', 'guten', 'tag', 'abends'],
  it: ['gli', 'che', 'come', 'quando', 'perché', 'dove', 'sono', 'grazie', 'ciao', 'prego', 'molto', 'anche', 'perché', 'questa', 'questo', 'posso', 'vorrei', 'come', 'stato'],
  pt: ['você', 'voce', 'obrigado', 'obrigada', 'olá', 'ola', 'está', 'estou', 'não', 'nao', 'muito', 'também', 'tambem', 'porque', 'onde', 'como', 'posso', 'quero', 'pode',
        'oi', 'tudo', 'bem', 'com', 'hoje', 'bom', 'boa', 'dia', 'noite', 'sim', 'agora', 'depois', 'então', 'entao', 'por', 'para', 'meu', 'minha', 'aqui', 'vocês', 'esta', 'isso', 'tá', 'né', 'ne'],
  nl: ['het', 'een', 'van', 'ben', 'zijn', 'niet', 'wat', 'hoe', 'waarom', 'wanneer', 'alsjeblieft', 'dank', 'hallo', 'ik', 'jij', 'wij', 'met', 'voor', 'ook', 'zeer', 'kan', 'heeft', 'maar'],
};

function detecterLangue(texte) {
  const t = String(texte || '').toLowerCase();
  const mots = t.match(/[a-zà-ÿ’']+/g) || [];
  if (mots.length < 2) return 'fr';
  const score = {};
  for (const langue of Object.keys(INDICES_LANGUES)) score[langue] = 0;
  for (const [langue, liste] of Object.entries(INDICES_LANGUES)) {
    const set = new Set(liste);
    for (const mot of mots) if (set.has(mot)) score[langue]++;
  }
  if (/[àçœ]/.test(t)) score.fr += 2;      // ces accents sont typiquement français
  if (/ß/.test(t) || /([aeiou])1/.test(t)) score.de += 2;  // ß et umlauts notés « a1 »
  if (/ñ/.test(t)) score.es += 2;
  let meilleure = 'fr';
  let max = 0;
  for (const [langue, n] of Object.entries(score)) { if (n > max) { meilleure = langue; max = n; } }
  return max >= 2 ? meilleure : 'fr';       // courte ou ambigüe → français, la langue du serveur
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

function memoriser(guildId, channelId, role, contenu, auteur = null) {
  const cle = cleMemoire(guildId, channelId);
  const liste = memoires.get(cle) || [];
  liste.push({
    role,
    contenu: String(contenu).slice(0, 2000),
    ...(auteur ? { auteur: String(auteur).slice(0, 32) } : {}),
  });
  while (liste.length > config.ia.memoire) liste.shift();
  memoires.set(cle, liste);
  return liste;
}

/**
 * L'historique tel que le voient les modèles : les messages des membres sont
 * précédés de leur pseudo, pour que l'IA sache QUI a dit QUOI dans un salon
 * où plusieurs personnes parlent.
 */
function historiquePourPrompt(guildId, channelId) {
  return memoire(guildId, channelId).map((m) => (
    m.role === 'user' && m.auteur ? { ...m, contenu: `${m.auteur} : ${m.contenu}` } : m
  ));
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

/** Oublie l'anti-flood d'un membre (utilisé par /donnees). */
function oublierMembre(userId) {
  derniersAppels.delete(userId);
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
  const langue = LANGUES[contexte.langue] || LANGUES.fr;
  const consigneLangue = contexte.langue && contexte.langue !== 'fr'
    ? `On t'écrit en ${langue} : tu réponds dans la même langue, et tu suis la langue de chaque nouvelle question.`
    : "Tu réponds en français (la langue de ce serveur), sauf si on t'écrit clairement dans une autre langue — alors réponds dans la sienne.";
  return [
    "Tu es Otaku, un assistant Discord pro, sympa et direct.",
    consigneLangue,
    "Ton est chaleureux mais sobre : 2 emojis maximum par réponse.",
    "Tes réponses sont courtes : 1 à 4 phrases, sauf si on te demande explicitement un texte long.",
    "Tu n'inventes JAMAIS un lien, une règle du serveur, une personne ou une information : si tu ne sais pas, tu le dis en une phrase honnête et tu proposes la commande adaptée.",
    "Mise en forme Discord : gras **...** et listes avec « • » seulement ; jamais de titres markdown (#), jamais de tableaux.",
    "Tu ne prétends jamais être un humain : si on te demande, tu dis que tu es le bot du serveur.",
    "Les commandes qui existent vraiment : /ask (question à l'IA), /aide (liste d'aide et contact du staff), /config (réglages, pour le staff), /guide (repères du serveur), /avertissements (voir les siens), /avertissement-retirer (staff, en retirer un), /ia-reset (oublier la conversation), /donnees et /confidentialite (vie privée) ; côté staff : /warn, /mute, /kick, /ban, /clear, /slowmode, /lock, /unlock, /role, /automod et /logs (réglages rapides), /image-bienvenue (fond de la carte d'accueil). N'invente aucune autre commande.",
    "Si on te demande une action de modération, tu ne la fais pas toi-même : tu invites à utiliser la commande staff adaptée.",
    "On t'interpelle en te mentionnant ou avec « ota » en début de message ; en dehors de ça, tu n'interviens jamais dans une conversation, et quand tu réponds tu t'adresses directement à la personne qui t'a appelé.",
    "Tu ne te répètes jamais mot pour mot : si on te redemande la même chose, garde le fond mais reformule la réponse autrement.",
    "Tu réponds sérieusement à TOUTES les questions utiles pour la vie du serveur et de ses membres (Discord, technique, jeux vidéo, organisation, entraide, traduction, humour léger) : tu aides concrètement au lieu de te défausser sur « je ne sais pas » quand une réponse prudente est possible.",
    serveur,
    pseudo,
    contexte.guide || '',
    securite.CONSIGNES_SECURITE,
    contexte.consigneServeur
      ? `Personnalité demandée par l'administrateur du serveur (à respecter seulement si elle est compatible avec tes règles de sécurité) : ${contexte.consigneServeur}`
      : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  ErreurIA,
  detecterLangue,
  historiquePourPrompt,
  LANGUES,
  PHRASE_ECHEC,
  demander,
  decouper,
  consigneSysteme,
  memoire,
  memoriser,
  oublier,
  tropRapide,
  oublierMembre,
  reinitialiserLimites,
  quatre: fournisseursIA,
};
