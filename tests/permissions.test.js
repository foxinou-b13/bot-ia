const assert = require('assert');
const perms = require('../utils/permissions');
const { membreMock, guildeMock, interactionMock } = require('./aide');
const { PermissionsBitField } = require('discord.js');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

test('« 10m » = 10 minutes, « 2h » = 2 heures, « 3j » = 3 jours', () => {
  assert.strictEqual(perms.dureeEnMs('10m'), 600000);
  assert.strictEqual(perms.dureeEnMs('2h'), 7200000);
  assert.strictEqual(perms.dureeEnMs('3j'), 259200000);
  assert.strictEqual(perms.dureeEnMs('45s'), 45000);
});

test('une durée impossible est refusée', () => {
  assert.strictEqual(perms.dureeEnMs('abc'), null);
  assert.strictEqual(perms.dureeEnMs('1s'), null);      // trop court
  assert.strictEqual(perms.dureeEnMs(''), null);
});

test('la durée est plafonnée à 28 jours', () => {
  assert.strictEqual(perms.dureeEnMs('365j'), 28 * 24 * 60 * 60 * 1000);
});

test('durée lisible en français', () => {
  assert.strictEqual(perms.dureeLisible(600000), '10 min');
  assert.strictEqual(perms.dureeLisible(7200000), '2 h');
  assert.strictEqual(perms.dureeLisible(259200000), '3 jour(s)');
});

test('une raison vide devient « Aucune raison donnée »', () => {
  assert.strictEqual(perms.propreRaison(''), 'Aucune raison donnée');
  assert.strictEqual(perms.propreRaison('   '), 'Aucune raison donnée');
  assert.strictEqual(perms.propreRaison('  trop   de\nsauts '), 'trop de sauts');
});

test('refus en message privé (pas de serveur)', () => {
  const inter = interactionMock({ guild: null });
  inter.inGuild = () => false;
  const refus = perms.verifier(inter, PermissionsBitField.Flags.BanMembers);
  assert.ok(/serveur/.test(refus));
});

test('refus clair quand la permission manque', () => {
  const inter = interactionMock({ membre: membreMock({ permissions: [] }) });
  const refus = perms.verifier(inter, PermissionsBitField.Flags.BanMembers);
  assert.ok(refus.includes('Bannir des membres'), refus);
});

test('aucun refus quand la permission est présente', () => {
  const inter = interactionMock({ membre: membreMock({ permissions: ['BanMembers'] }) });
  assert.strictEqual(perms.verifier(inter, PermissionsBitField.Flags.BanMembers), null);
});

test('impossible de se sanctionner soi-même', () => {
  const auteur = membreMock({ id: 'u1' });
  assert.ok(/toi-même/.test(perms.peutSanctionner(auteur, auteur)));
});

test('impossible de sanctionner un bot', () => {
  const auteur = membreMock({ id: 'u1', position: 10 });
  const cible = membreMock({ id: 'b1', bot: true });
  assert.ok(/bots/.test(perms.peutSanctionner(auteur, cible)));
});

test('impossible de sanctionner plus haut que soi', () => {
  const guilde = guildeMock();
  const auteur = membreMock({ id: 'u1', position: 5 });
  const cible = membreMock({ id: 'u2', position: 20 });
  cible.guild = guilde;
  const refus = perms.peutSanctionner(auteur, cible);
  assert.ok(/égal ou supérieur/.test(refus), refus);
});

test('impossible si le rôle du bot est trop bas', () => {
  const guilde = guildeMock({ moiPosition: 3 });
  const auteur = membreMock({ id: 'u1', position: 30 });
  const cible = membreMock({ id: 'u2', position: 10 });
  cible.guild = guilde;
  const refus = perms.peutSanctionner(auteur, cible);
  assert.ok(/Mon rôle est en dessous/.test(refus), refus);
});

test('autorise une cible normale', () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', position: 30 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  assert.strictEqual(perms.peutSanctionner(auteur, cible), null);
});

test('le propriétaire du serveur est intouchable', () => {
  const guilde = guildeMock({ ownerId: 'proprio' });
  const auteur = membreMock({ id: 'u1', position: 30 });
  const cible = membreMock({ id: 'proprio', position: 5 });
  cible.guild = guilde;
  assert.ok(/propriétaire/.test(perms.peutSanctionner(auteur, cible)));
});

module.exports = { nom: 'permissions', cas };

if (require.main === module) require('./executeur')(module.exports);
