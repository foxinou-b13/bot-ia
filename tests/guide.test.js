/**
 * tests/guide.test.js — repères du serveur (règles/support), /guide,
 * injection dans l'IA et rôle automatique à l'arrivée.
 */
const assert = require('assert');
const { guildeMock, salonMock } = require('./aide');
const stockage = require('../utils/stockage');
const ia = require('../utils/ia');
const { chargerCommandes } = require('../utils/commandes');

const { commandes } = chargerCommandes();
const guide = commandes.get('guide');
const guildMemberAdd = require('../events/guildMemberAdd');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function interactionGuide(guildId) {
  const journal = [];
  return {
    journal,
    guildId,
    guild: guildeMock({ id: guildId }),
    channelId: 'C1',
    user: { id: 'u1', tag: 'Jean#0001' },
    replied: false,
    deferred: false,
    async reply(p) { journal.push(p); return {}; },
    async followUp(p) { journal.push(p); return {}; },
  };
}

test('aucun repère réglé → le texte IA est vide (rien d\'inventé)', () => {
  const G = `G-VIDE-${Date.now()}`;
  assert.strictEqual(stockage.repereIA(G), '');
  assert.strictEqual(ia.consigneSysteme({ guide: stockage.repereIA(G) }).includes('Repères officiels'), false);
});

test('règles + support réglés → l\'IA reçoit les liens exacts', () => {
  const G = `G-REP-${Date.now()}`;
  stockage.majReglages(G, { guide: { regles: 'S-REG', support: 'S-SUP' } });
  const texte = stockage.repereIA(G);
  assert.ok(texte.includes('<#S-REG>'), 'lien des règles manquant');
  assert.ok(texte.includes('<#S-SUP>'), 'lien du support manquant');
  assert.ok(/N'INVENTE JAMAIS/.test(texte), 'la consigne anti-invention doit être là');
  const conso = ia.consigneSysteme({ guide: texte });
  assert.ok(conso.includes('<#S-REG>'), 'consigne système pas injectée');
});

test('/guide : affiche les salons configurés (visible par tous)', async () => {
  const G = `G-GUIDE-${Date.now()}`;
  stockage.majReglages(G, { guide: { regles: 'S-REG', support: 'S-SUP' } });
  const inter = interactionGuide(G);
  await guide.executer(inter);
  const json = inter.journal[0].embeds[0].toJSON();
  assert.strictEqual(inter.journal[0].ephemeral, undefined, 'le guide doit être public (sans option éphémère)');
  const valeur = json.fields.map((f) => f.value).join(' ');
  assert.ok(valeur.includes('<#S-REG>'), 'le lien des règles doit être dans la carte');
  assert.ok(valeur.includes('<#S-SUP>'), 'le lien du support doit être dans la carte');
});

test('/guide : rien de réglé → carte discrète pour l\'admin, sans erreur', async () => {
  const G = `G-GUIDE-VIDE-${Date.now()}`;
  const inter = interactionGuide(G);
  await guide.executer(inter);
  const json = inter.journal[0].embeds[0].toJSON();
  assert.ok(/config/.test(json.description), 'il doit orienter vers /config');
});

test('arrivée d\'un membre : le rôle automatique est donné', async () => {
  const G = `G-ROLE-${Date.now()}`;
  stockage.majReglages(G, { bienvenue: { salon: null, role: 'R-BIENVENUE' } });
  const donne = [];
  const membre = {
    id: 'nouveau1', user: { bot: false, tag: 'Zoe#0001' },
    roles: { add: async (r, raison) => { donne.push({ r, raison }); } },
  };
  const guilde = guildeMock({ id: G });
  membre.guild = guilde;
  await guildMemberAdd.executer({ user: {} }, membre);
  assert.strictEqual(donne.length, 1, 'le rôle n\'a pas été donné');
  assert.strictEqual(donne[0].r, 'R-BIENVENUE');
});

test('arrivée : message de bienvenue ET rôle, dans le bon ordre', async () => {
  const G = `G-ROLE2-${Date.now()}`;
  const guilde = guildeMock({ id: G, nom: 'Serveur Rôle' });
  const salon = salonMock({ id: 'S-WEL' });
  guilde.salonsDeTest.set('S-WEL', salon);
  stockage.majReglages(G, { bienvenue: { salon: 'S-WEL', message: 'Salut {membre} !', role: 'R-2' } });
  const donne = [];
  const membre = {
    id: 'nouveau2', user: { bot: false, tag: 'Leo#0002' },
    roles: { add: async (r) => { donne.push(r); } },
  };
  membre.guild = guilde;
  await guildMemberAdd.executer({ user: {} }, membre);
  assert.strictEqual(donne[0], 'R-2');
  assert.ok(salon.messagesEnvoyes.length >= 1, 'le message de bienvenue doit partir aussi');
});

test('rôle automatique : silencieusement ignoré si le bot ne peut pas (pas de crash)', async () => {
  const G = `G-ROLE3-${Date.now()}`;
  stockage.majReglages(G, { bienvenue: { salon: null, role: 'R-BOSS' } });
  const membre = {
    id: 'nouveau3', user: { bot: false, tag: 'Max#0003' },
    roles: { add: async () => { throw new Error('hiérarchie des rôles'); } },
  };
  membre.guild = guildeMock({ id: G });
  const r = await guildMemberAdd.executer({ user: {} }, membre);
  assert.ok(!r || r === null || r === false, 'ne doit pas pretendre un succes');
});

test('les bots qui arrivent ne reçoivent pas le rôle d\'accueil', async () => {
  const G = `G-ROLE4-${Date.now()}`;
  stockage.majReglages(G, { bienvenue: { salon: null, role: 'R-X' } });
  const donne = [];
  const membre = {
    id: 'bot1', user: { bot: true, tag: 'BotAmi#0001' },
    roles: { add: async (r) => { donne.push(r); } },
  };
  membre.guild = guildeMock({ id: G });
  await guildMemberAdd.executer({ user: {} }, membre);
  assert.strictEqual(donne.length, 0);
});

module.exports = { nom: 'guide', cas };

if (require.main === module) require('./executeur')(module.exports);
