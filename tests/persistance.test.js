/**
 * tests/persistance.test.js — le miroir MongoDB (avec un faux client,
 * aucun réseau pendant les tests).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const persistance = require('../utils/persistance');
const stockage = require('../utils/stockage');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

const DOSSIER = path.join(__dirname, '..', 'data');

function fauxClient(bilan) {
  const store = new Map();
  const coll = {
    find: () => ({ toArray: async () => [...store.entries()].map(([nom, contenu]) => ({ _id: nom, contenu })) }),
    replaceOne: async (filtre, doc) => {
      if (bilan.erreurProchaine) { bilan.erreurProchaine = false; throw new Error('réseau coupé'); }
      store.set(doc._id, doc.contenu);
      bilan.ecrits.push(doc._id);
    },
  };
  return { store, client: { db: () => ({ collection: () => coll }), close: async () => { bilan.ferme = true; } } };
}

test('sans MONGODB_URI : mode fichier, publier ne fait rien', async () => {
  persistance.injecterClient(null);
  const etat = await persistance.initialiser({ uri: '' });
  assert.strictEqual(etat, false);
  assert.strictEqual(persistance.etat().mode, 'fichier');
  assert.strictEqual(persistance.publier('x', {}), false);
});

test('initialiser avec un faux client → mode mongo', async () => {
  const bilan = { ecrits: [], ferme: false };
  const faux = fauxClient(bilan);
  const ok = await persistance.initialiser({ uri: 'mongodb://factice', client: faux.client });
  assert.strictEqual(ok, true);
  assert.strictEqual(persistance.etat().mode, 'mongo');
});

test('restaurer : les fichiers de la base sont écrits sur le disque', async () => {
  const bilan = { ecrits: [], ferme: false };
  const faux = fauxClient(bilan);
  faux.store.set('test-persist', { marque: 'OK' });
  await persistance.initialiser({ uri: 'x', client: faux.client });
  const n = await persistance.restaurer();
  assert.ok(n >= 1, 'rien restauré');
  const fichier = path.join(DOSSIER, 'test-persist.json');
  assert.ok(fs.existsSync(fichier), 'le fichier restauré est absent');
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(fichier, 'utf8')), { marque: 'OK' });
  fs.unlinkSync(fichier);
});

test('écriture stockage → miroir dans la base (via la file)', async () => {
  const bilan = { ecrits: [], ferme: false };
  const faux = fauxClient(bilan);
  await persistance.initialiser({ uri: 'x', client: faux.client });
  const G = `G-PERS-${Date.now()}`;
  stockage.majReglages(G, { logs: 'SALON-PERS' });
  await persistance.terminer();          // force la fin de la file
  assert.ok(bilan.ecrits.includes('config'), 'config pas poussé vers la base');
  assert.strictEqual(faux.store.get('config')[G].logs, 'SALON-PERS');
  assert.strictEqual(bilan.ferme, true, 'la connexion doit être proprement fermée');
});

test('panneau réseau sur une écriture → la donnée reste en file (pas perdue)', async () => {
  const bilan = { ecrits: [], ferme: false, erreurProchaine: true };
  const faux = fauxClient(bilan);
  await persistance.initialiser({ uri: 'x', client: faux.client });
  const G = `G-PERS2-${Date.now()}`;
  stockage.majReglages(G, { logs: 'SALON-2' });
  await persistance.terminer();
  assert.ok(persistance.etat().enAttente >= 1, 'la donnée aurait dû rester en file');
  // le bot n'est jamais mort : on relit nos réglages normalement
  assert.strictEqual(stockage.reglages(G).logs, 'SALON-2');
  assert.strictEqual(faux.store.get('config'), undefined, 'un échec ne doit rien écrire');
});

test('gros débit : 10 écritures d’affilée → une seule sauvegarde de la dernière', async () => {
  const bilan = { ecrits: [], ferme: false };
  const faux = fauxClient(bilan);
  await persistance.initialiser({ uri: 'x', client: faux.client });
  const G = `G-PERS3-${Date.now()}`;
  for (let i = 0; i < 10; i += 1) stockage.majReglages(G, { cfgSection: i % 2 ? 'salons' : 'ia' });
  await persistance.terminer();
  assert.strictEqual(bilan.ecrits.length, 1, `${bilan.ecrits.length} écritures au lieu d'une`);
  assert.strictEqual(faux.store.get('config')[G].cfgSection, 'salons');
});

test('après terminer() : retour mode fichier possible sans crash', async () => {
  persistance.injecterClient(null);
  assert.strictEqual(persistance.etat().mode, 'fichier');
  stockage.majReglages(`G-PERS4-${Date.now()}`, { logs: 'X' });   // doit juste écrire sur disque
});

module.exports = { nom: 'persistance', cas };
if (require.main === module) require('./executeur')(module.exports);
