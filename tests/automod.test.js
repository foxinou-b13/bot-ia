const assert = require('assert');
const automod = require('../utils/automod');

const cas = [];

function test(nom, fn) {
  cas.push({ nom, fn });
}

test('détecte une invitation Discord classique', () => {
  assert.strictEqual(automod.contientInvitation('viens sur discord.gg/abc123'), true);
  assert.strictEqual(automod.contientInvitation('discord.com/invite/xyz'), true);
  assert.strictEqual(automod.contientInvitation('salut ça va ?'), false);
});

test('compte les liens', () => {
  assert.strictEqual(automod.compteLiens('va voir https://a.fr'), 1);
  assert.strictEqual(automod.compteLiens('https://a.fr et https://b.fr et https://c.fr'), 3);
  assert.strictEqual(automod.compteLiens('aucun lien ici'), 0);
});

test('trouve une insulte simple, avec accents ou majuscules', () => {
  assert.strictEqual(automod.insulteTrouvee('espèce de connard'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('CONNARD'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('c0nnard'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('bonjour tout le monde'), null);
});

test('ne confond pas un mot contenant une insulte', () => {
  // « constitution » ne doit pas déclencher « con »
  assert.strictEqual(automod.insulteTrouvee('la constitution française'), null);
});

test('détecte les majuscules excessives mais pas une phrase normale', () => {
  assert.strictEqual(automod.tropDeMajuscules('ARRETE TOUT DE SUITE MAINTENANT'), true);
  assert.strictEqual(automod.tropDeMajuscules('Bonjour, comment ça va aujourd’hui ?'), false);
  assert.strictEqual(automod.tropDeMajuscules('OK'), false);
});

test('détecte le spam : 6 messages en 8 secondes', () => {
  const maintenant = 1_000_000;
  const horodatages = [maintenant - 1000, maintenant - 2000, maintenant - 3000, maintenant - 4000, maintenant - 5000, maintenant - 6000];
  const resultat = automod.estSpam(horodatages, maintenant);
  assert.strictEqual(resultat.spam, true);
  assert.ok(resultat.nombre >= 6);
});

test('pas de spam si les messages sont espacés', () => {
  const maintenant = 1_000_000;
  const horodatages = [maintenant - 60000, maintenant - 50000, maintenant - 40000];
  const resultat = automod.estSpam(horodatages, maintenant);
  assert.strictEqual(resultat.spam, false);
});

test('analyse : invitation → suppression', () => {
  const r = automod.analyser('rejoins discord.gg/teststp');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'invitation Discord');
});

test('analyse : message normal → aucune action', () => {
  const r = automod.analyser('Quelqu\'un peut m\'aider avec le bot ?');
  assert.strictEqual(r.action, 'aucune');
});

test('analyse : trop de liens → suppression', () => {
  const r = automod.analyser('https://a.fr https://b.fr https://c.fr https://d.fr');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'trop de liens');
});

test('analyze : insulte → suppression', () => {
  const r = automod.analyser('ta gueule sale conne');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'propos insultants');
});

test('salon exempté correctement repéré', () => {
  assert.strictEqual(automod.salonExempt('C1', { salonExempt: 'C1' }), true);
  assert.strictEqual(automod.salonExempt('C2', { salonExempt: 'C1' }), false);
  assert.strictEqual(automod.salonExempt('C2', {}), false);
});

// ─── liens malveillants (arnaques connues) ───
test('arnaque nitro avec lien → supprimé', () => {
  const r = automod.analyser('gagne un nitro gratuit https://discord-nitro.xyz/go');
  assert.strictEqual(r.action, 'supprimer');
  assert.match(r.raison, /arnaque Nitro/);
});
test('arnaque steam gift → supprimé, même un seul lien', () => {
  const r = automod.analyser('steam gift ici http://steam-cadeau.tk');
  assert.strictEqual(r.action, 'supprimer');
});
test('faux lien discord (dliscord) → supprimé', () => {
  assert.strictEqual(automod.analyser('clique sur dliscord-app.com/gift').action, 'supprimer');
});
test('nitro mentionné sans lien → rien (discussion normale)', () => {
  assert.strictEqual(automod.analyser('j\'ai pris nitro gratuit le mois dernier sur le store officiel').action, 'aucune');
});
test('module liens désactivé → invitation ignorée', () => {
  const r = automod.analyser('va sur discord.gg/x', { reglages: { liens: false } });
  assert.strictEqual(r.action, 'aucune');
});
test('module insultes désactivé → insulte ignorée', () => {
  const r = automod.analyser('ta gueule', { reglages: { insultes: false } });
  assert.strictEqual(r.action, 'aucune');
});

module.exports = { nom: 'automod', cas };

if (require.main === module) require('./executeur')(module.exports);
