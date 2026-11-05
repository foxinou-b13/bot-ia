const assert = require('assert');
const chemin = require.resolve('../utils/ia');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

/** Recharge le module IA avec des clés précises (les clés sont lues au chargement). */
function chargerIA({ gemini = '', groq = '', ordre = null } = {}) {
  process.env.GEMINI_API_KEY = gemini;
  process.env.GROQ_API_KEY = groq;
  if (ordre) process.env.IA_ORDRE = ordre;
  else delete process.env.IA_ORDRE;
  delete require.cache[chemin];
  delete require.cache[require.resolve('../config')];
  return require('../utils/ia');
}

function reponseJson(data, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => data,
    text: async () => JSON.stringify(data),
  };
}

test('sans aucune clé, demander renvoie une erreur claire', async () => {
  const ia = chargerIA();
  await assert.rejects(
    () => ia.demander({ systeme: 'x', messages: [{ role: 'user', contenu: 'salut' }] }),
    (e) => e instanceof ia.ErreurIA,
  );
});

test('Gemini répond : on récupère le texte', async () => {
  const ia = chargerIA({ gemini: 'cle-gemini' });
  let urlAppelee = null;
  const fetchImpl = async (url) => {
    urlAppelee = url;
    return reponseJson({ candidates: [{ content: { parts: [{ text: 'Bonjour !' }] } }] });
  };
  const r = await ia.demander({ systeme: 'sois sympa', messages: [{ role: 'user', contenu: 'salut' }] }, { fetchImpl });
  assert.strictEqual(r.texte, 'Bonjour !');
  assert.strictEqual(r.fournisseur, 'gemini');
  assert.ok(urlAppelee.includes('generativelanguage.googleapis.com'));
});

test('Groq en panne → bascule sur Gemini sans erreur visible', async () => {
  const ia = chargerIA({ gemini: 'cle-gemini', groq: 'cle-groq', ordre: 'groq,gemini' });
  const appels = [];
  const fetchImpl = async (url) => {
    appels.push(url);
    if (url.includes('api.groq.com')) return reponseJson({ error: 'quota' }, false, 429);
    return reponseJson({ candidates: [{ content: { parts: [{ text: 'Réponse Gemini' }] } }] });
  };
  const r = await ia.demander({ systeme: 'x', messages: [{ role: 'user', contenu: 'salut' }] }, { fetchImpl });
  assert.strictEqual(r.texte, 'Réponse Gemini');
  assert.strictEqual(r.fournisseur, 'gemini');
  // Groq a essayé, puis Gemini (et peut-être plusieurs de ses modèles) : c'est voulu.
  assert.ok(appels.length >= 2, `seulement ${appels.length} appel(s)`);
  assert.ok(appels[0].includes('groq'), 'le premier essai doit être Groq (le plus rapide)');
});

test('Gemini : un modèle disparu → on essaie le suivant automatiquement', async () => {
  const ia = chargerIA({ gemini: 'cle-gemini' });
  const vus = [];
  const fetchImpl = async (url) => {
    const modele = url.match(/models\/([^:]+):/)?.[1];
    vus.push(modele);
    if (modele !== 'gemini-3.5-flash') return reponseJson({ error: 'not found' }, false, 404);
    return reponseJson({ candidates: [{ content: { parts: [{ text: 'OK secours' }] } }] });
  };
  const r = await ia.demander({ systeme: 'x', messages: [{ role: 'user', contenu: 'salut' }] }, { fetchImpl });
  assert.strictEqual(r.texte, 'OK secours');
  assert.ok(vus.length >= 2, 'un seul modèle essayé');
  assert.strictEqual(vus[0], 'gemini-flash-lite-latest', 'le rapide doit être essayé en premier');
  assert.ok(vus.includes('gemini-3.5-flash'), 'le secours quality doit être tenté');
});

test('Groq : un modèle retiré par Groq → on essaie le suivant', async () => {
  const ia = chargerIA({ groq: 'cle-groq' });
  let n = 0;
  const fetchImpl = async () => {
    n += 1;
    if (n === 1) return reponseJson({ error: 'model_not_found' }, false, 404);
    return reponseJson({ choices: [{ message: { content: 'Groq secours' } }] });
  };
  const r = await ia.demander({ systeme: 'x', messages: [{ role: 'user', contenu: 'salut' }] }, { fetchImpl });
  assert.strictEqual(r.texte, 'Groq secours');
  assert.strictEqual(n, 2);
});

test('les deux en panne → ErreurIA avec phrase française', async () => {
  const ia = chargerIA({ gemini: 'a', groq: 'b' });
  const fetchImpl = async () => reponseJson({ erreur: true }, false, 500);
  await assert.rejects(
    () => ia.demander({ systeme: 'x', messages: [{ role: 'user', contenu: 'salut' }] }, { fetchImpl }),
    (e) => e instanceof ia.ErreurIA && /fournisseurs d'IA/.test(e.message),
  );
});

test('une réponse vide est considérée comme un échec', async () => {
  const ia = chargerIA({ gemini: 'a' });
  const fetchImpl = async () => reponseJson({ candidates: [{ content: { parts: [] } }] });
  await assert.rejects(
    () => ia.demander({ systeme: 'x', messages: [] }, { fetchImpl }),
    (e) => e instanceof ia.ErreurIA,
  );
});

test('decouper respecte la limite Discord de 2000 caractères', () => {
  const ia = chargerIA({ gemini: 'a' });
  const long = 'mot '.repeat(1200);          // 4800 caractères
  const morceaux = ia.decouper(long);
  assert.ok(morceaux.length >= 3);
  for (const m of morceaux) assert.ok(m.length <= 1900, `morceau trop long : ${m.length}`);
  assert.ok(morceaux.join(' ').replace(/\s+/g, ' ').includes('mot mot'));
});

test('decouper ne renvoie jamais un tableau vide', () => {
  const ia = chargerIA({ gemini: 'a' });
  assert.deepStrictEqual(ia.decouper(''), ['…']);
});

test('la consigne système impose le français et évite de prétendre être humain', () => {
  const ia = chargerIA({ gemini: 'a' });
  const consigne = ia.consigneSysteme({ serveur: 'Mon Serveur', pseudo: 'Alex' });
  assert.ok(consigne.includes('français'));
  assert.ok(consigne.includes('Mon Serveur'));
  assert.ok(consigne.includes('Alex'));
  assert.ok(/jamais être un humain|ne prétends jamais/.test(consigne));
});

test('la mémoire garde les derniers messages et se vide sur demande', () => {
  const ia = chargerIA({ gemini: 'a' });
  for (let i = 0; i < 30; i += 1) ia.memoriser('G', 'C', 'user', `message ${i}`);
  const memoire = ia.memoire('G', 'C');
  assert.ok(memoire.length <= 12, `mémoire trop longue : ${memoire.length}`);
  assert.strictEqual(memoire[memoire.length - 1].contenu, 'message 29');
  ia.oublier('G', 'C');
  assert.deepStrictEqual(ia.memoire('G', 'C'), []);
});

test('anti-flood : deux questions d\'affilée sont bloquées', () => {
  const ia = chargerIA({ gemini: 'a' });
  ia.reinitialiserLimites();
  const base = Date.now();
  const premier = ia.tropRapide('u1', { pause: 5000, maintenant: base });
  assert.strictEqual(premier.bloque, false);
  const second = ia.tropRapide('u1', { pause: 5000, maintenant: base + 1000 });
  assert.strictEqual(second.bloque, true);
  assert.ok(second.resteSecondes > 0);
  const troisieme = ia.tropRapide('u1', { pause: 5000, maintenant: base + 6000 });
  assert.strictEqual(troisieme.bloque, false);
});

module.exports = { nom: 'ia', cas };

if (require.main === module) require('./executeur')(module.exports);
