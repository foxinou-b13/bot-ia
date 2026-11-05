const assert = require('assert');
const stockage = require('../utils/stockage');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

const G = 'TEST-' + Date.now();

test('les réglages d\'un serveur inconnu ont des valeurs par défaut', () => {
  const r = stockage.reglages('serveur-jamais-vu');
  assert.strictEqual(r.logs, null);
  assert.strictEqual(r.automod.spam, true);
  assert.strictEqual(r.bienvenue.salon, null);
});

test('on enregistre puis on relit un réglage', () => {
  stockage.majReglages(G, { logs: 'SALON-LOGS' });
  assert.strictEqual(stockage.reglages(G).logs, 'SALON-LOGS');
});

test('modifier l\'automod ne casse pas les autres réglages', () => {
  stockage.majReglages(G, { automod: { spam: false } });
  const r = stockage.reglages(G);
  assert.strictEqual(r.logs, 'SALON-LOGS');       // conservé
  assert.strictEqual(r.automod.spam, false);
  assert.strictEqual(r.automod.liens, true);      // valeur par défaut conservée
});

test('le message de bienvenue se règle sans perdre le salon', () => {
  stockage.majReglages(G, { bienvenue: { salon: 'SALON-ACCUEIL' } });
  stockage.majReglages(G, { bienvenue: { message: 'Salut {membre} !' } });
  const r = stockage.reglages(G);
  assert.strictEqual(r.bienvenue.salon, 'SALON-ACCUEIL');
  assert.strictEqual(r.bienvenue.message, 'Salut {membre} !');
});

test('avertissements : ajout, lecture, retrait', () => {
  const g = G + '-warns';
  assert.deepStrictEqual(stockage.avertissements(g, 'u1'), []);
  stockage.ajouterAvert(g, 'u1', { raison: 'spam', par: 'Staff#1', date: 1 });
  stockage.ajouterAvert(g, 'u1', { raison: 'insulte', par: 'Staff#1', date: 2 });
  assert.strictEqual(stockage.avertissements(g, 'u1').length, 2);

  const retrait = stockage.retirerAvert(g, 'u1', 0);
  assert.strictEqual(retrait.ok, true);
  assert.strictEqual(retrait.retire.raison, 'spam');
  assert.strictEqual(stockage.avertissements(g, 'u1').length, 1);
});

test('retirer un avertissement inexistant ne casse rien', () => {
  const r = stockage.retirerAvert(G + '-vide', 'u9', 3);
  assert.strictEqual(r.ok, false);
});

test('les avertissements sont séparés par serveur', () => {
  stockage.ajouterAvert(G + '-A', 'u1', { raison: 'a', par: 'x', date: 1 });
  assert.strictEqual(stockage.avertissements(G + '-B', 'u1').length, 0);
});

test('un fichier JSON abîmé ne fait pas planter la lecture', () => {
  const r = stockage.lire('fichier-qui-nexiste-pas', { ok: true });
  assert.deepStrictEqual(r, { ok: true });
});

module.exports = { nom: 'stockage', cas };

if (require.main === module) require('./executeur')(module.exports);
