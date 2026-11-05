const assert = require('assert');
const { membreMock, guildeMock, interactionMock, texteReponses } = require('./aide');
const { chargerCommandes } = require('../utils/commandes');
const interactionCreate = require('../events/interactionCreate');
const stockage = require('../utils/stockage');

const { commandes } = chargerCommandes();
const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function clientFactice() {
  return { commands: commandes, user: { id: 'bot' } };
}

// ─────────── ban ───────────
test('ban : refus clair si la permission manque', async () => {
  const cible = membreMock({ id: 'u2', position: 1 });
  const inter = interactionMock({
    commandName: 'ban',
    membre: membreMock({ permissions: [] }),
    options: { membre: cible, raison: 'test' },
  });
  await commandes.get('ban').executer(inter);
  const texte = texteReponses(inter);
  assert.ok(/Bannir des membres/.test(texte), texte);
  assert.strictEqual(cible.actions.length, 0);
});

test('ban : refus si on vise soi-même', async () => {
  const auteur = membreMock({ id: 'u1', permissions: ['BanMembers'] });
  const inter = interactionMock({ commandName: 'ban', membre: auteur, options: { membre: auteur } });
  await commandes.get('ban').executer(inter);
  assert.ok(/toi-même/.test(texteReponses(inter)));
});

test('ban : fonctionne et prévient la personne', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['BanMembers'], position: 30 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  const inter = interactionMock({
    commandName: 'ban', guild: guilde, membre: auteur,
    options: { membre: cible, raison: 'règles non respectées' },
  });
  await commandes.get('ban').executer(inter);
  const ban = cible.actions.find((a) => a[0] === 'ban');
  assert.ok(ban, 'le ban n\'a pas été appelé');
  assert.ok(String(ban[1].reason).includes('règles non respectées'));
  assert.ok(/Membre banni/.test(texteReponses(inter)));
});

test('ban : la réponse reste correcte même si les MP sont fermés', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['BanMembers'], position: 30 });
  const cible = membreMock({ id: 'u2', position: 5, sendEchoue: true });
  cible.guild = guilde;
  const inter = interactionMock({ commandName: 'ban', guild: guilde, membre: auteur, options: { membre: cible } });
  await commandes.get('ban').executer(inter);
  assert.ok(/message privé/i.test(texteReponses(inter)));
});

// ─────────── kick ───────────
test('kick : refuse une cible plus haute que soi', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['KickMembers'], position: 5 });
  const cible = membreMock({ id: 'u2', position: 20 });
  cible.guild = guilde;
  const inter = interactionMock({ commandName: 'kick', guild: guilde, membre: auteur, options: { membre: cible } });
  await commandes.get('kick').executer(inter);
  assert.ok(/égal ou supérieur/.test(texteReponses(inter)));
  assert.strictEqual(cible.actions.length, 0);
});

test('kick : fonctionne sur une cible normale', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['KickMembers'], position: 30 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  const inter = interactionMock({ commandName: 'kick', guild: guilde, membre: auteur, options: { membre: cible, raison: 'pub' } });
  await commandes.get('kick').executer(inter);
  assert.ok(cible.actions.some((a) => a[0] === 'kick'));
});

// ─────────── mute ───────────
test('mute : durée mal écrite → explication en français', async () => {
  const guilde = guildeMock();
  const auteur = membreMock({ id: 'u1', permissions: ['ModerateMembers'], position: 30 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  const inter = interactionMock({
    commandName: 'mute', guild: guilde, membre: auteur,
    options: { membre: cible, duree: 'longtemps' },
  });
  await commandes.get('mute').executer(inter);
  assert.ok(/10m/.test(texteReponses(inter)));
  assert.strictEqual(cible.actions.length, 0);
});

test('mute : applique le timeout avec la bonne durée', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['ModerateMembers'], position: 30 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  const inter = interactionMock({
    commandName: 'mute', guild: guilde, membre: auteur,
    options: { membre: cible, duree: '10m', raison: 'flood' },
  });
  await commandes.get('mute').executer(inter);
  const timeout = cible.actions.find((a) => a[0] === 'timeout');
  assert.ok(timeout, 'timeout non appelé');
  assert.strictEqual(timeout[1], 600000);
  assert.ok(/10 min/.test(texteReponses(inter)));
});

// ─────────── warn ───────────
test('warn : enregistre l\'avertissement et annonce le total', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['ModerateMembers'], position: 30 });
  const cible = membreMock({ id: `u-warn-${Date.now()}`, position: 5 });
  cible.guild = guilde;
  guilde.id = `G-WARN-${Date.now()}`;
  const inter = interactionMock({
    commandName: 'warn', guildId: guilde.id, guild: guilde, membre: auteur,
    options: { membre: cible, raison: 'langage' },
  });
  await commandes.get('warn').executer(inter);
  const texte = texteReponses(inter);
  assert.ok(/Avertissement enregistré/.test(texte), texte);
  assert.ok(/1 avertissement/.test(texte), texte);
});

// ─────────── role ───────────
test('role : refuse un rôle au-dessus de soi', async () => {
  const guilde = guildeMock({ moiPosition: 50 });
  const auteur = membreMock({ id: 'u1', permissions: ['ManageRoles'], position: 10 });
  const cible = membreMock({ id: 'u2', position: 5 });
  cible.guild = guilde;
  const role = { id: 'r1', name: 'Admin', position: 40, managed: false };
  const inter = interactionMock({
    commandName: 'role', guild: guilde, membre: auteur,
    options: { action: 'ajouter', membre: cible, role },
  });
  await commandes.get('role').executer(inter);
  assert.ok(/trop haut/.test(texteReponses(inter)));
});

// ─────────── /aide, /automod ───────────
test('aide : liste les commandes principales', async () => {
  const inter = interactionMock({ commandName: 'aide' });
  await commandes.get('aide').executer(inter);
  const texte = texteReponses(inter);
  for (const c of ['/ask', '/ban', '/automod', '/logs']) {
    assert.ok(texte.includes(c), `/${c} absent de l'aide`);
  }
});

test('automod : affiche l\'état complet avec les 5 modules', async () => {
  const inter = interactionMock({ commandName: 'automod', options: { module: 'voir' } });
  await commandes.get('automod').executer(inter);
  const texte = texteReponses(inter);
  for (const mot of ['Spam', 'Insultes', 'Raid', 'MAJUSCULES', 'Liens']) {
    assert.ok(texte.includes(mot), `${mot} absent`);
  }
});

// ─────────── routeur ───────────
test('routeur : commande inconnue → réponse aimable, pas de silence', async () => {
  const inter = interactionMock({ commandName: 'commande-qui-nexiste-pas' });
  await interactionCreate.executer(clientFactice(), inter);
  const texte = texteReponses(inter);
  assert.ok(/inconnue/i.test(texte), texte);
});

test('routeur : une commande qui plante renvoie quand même un message', async () => {
  const inter = interactionMock({ commandName: 'boom' });
  const faux = { ...clientFactice(), commands: new Map([['boom', { executer: async () => { throw new Error('boum'); } }]]) };
  await interactionCreate.executer(faux, inter);
  assert.ok(/erreur est survenue/i.test(texteReponses(inter)));
});

test('routeur : le sélecteur de RÔLE est bien acheminé (correction du « n\'a pas répondu à temps »)', async () => {
  const G = `G-ROUTE-ROLE-${Date.now()}`;
  const role = { id: 'R-OUVERT', name: 'Ouvert' };
  const inter = {
    customId: 'cfg:accueil:role',
    guildId: G, channelId: 'C1',
    isMessageComponent: () => true,
    isRoleSelectMenu: () => true,
    roles: { first: () => role },
    inGuild: () => true, replied: false, deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u1', tag: 'Staff#0001' },
    journal: [],
    async update(p) { this.journal.push(['update', p]); return {}; },
    async reply(p) { this.journal.push(['reply', p]); return {}; },
  };
  await interactionCreate.executer(clientFactice(), inter);
  assert.ok(inter.journal.some(([t]) => t === 'update'), 'aucune réponse envoyée au sélecteur de rôle');
  assert.strictEqual(stockage.reglages(G).bienvenue.role, 'R-OUVERT', "le rôle n'a pas été enregistré");
});

test('routeur : ignore les interactions qui ne sont pas des commandes', async () => {
  const inter = interactionMock({ commandName: 'x' });
  inter.isChatInputCommand = () => false;
  await interactionCreate.executer(clientFactice(), inter);
  assert.strictEqual(inter.journal.length, 0);
});

module.exports = { nom: 'interactions', cas };

if (require.main === module) require('./executeur')(module.exports);
