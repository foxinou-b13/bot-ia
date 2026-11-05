/**
 * tests/panneau.test.js — le panneau /config et la sanction automatique.
 */
const assert = require('assert');
const { membreMock, guildeMock, salonMock, interactionMock, texteReponses } = require('./aide');
const { chargerCommandes } = require('../utils/commandes');
const stockage = require('../utils/stockage');

const { commandes } = chargerCommandes();
const config = commandes.get('config');
const warn = commandes.get('warn');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

const G = `G-CFG-${Date.now()}`;

/** Faux menu déroulant. */
function menuFactice({ customId, values = [], channels = [], kind = 'string', guildId = G, membre = null }) {
  const liste = new Map(channels.map((c) => [c.id, c]));
  return {
    customId,
    guildId,
    values,
    channels: { first: () => channels[0] || null, size: liste.size },
    member: membre || membreMock({ permissions: ['ManageGuild'] }),
    memberPermissions: null,
    user: { id: 'u1', tag: 'Staff#0001' },
    isStringSelectMenu: () => kind === 'string',
    isChannelSelectMenu: () => kind === 'channel',
    isButton: () => kind === 'button',
    isChatInputCommand: () => false,
    inGuild: () => true,
    replied: false,
    deferred: false,
    journal: [],
    async reply(p) { this.journal.push(['reply', p]); this.replied = true; return {}; },
    async update(p) { this.journal.push(['update', p]); return {}; },
    async followUp(p) { this.journal.push(['followUp', p]); return {}; },
    async editReply(p) { this.journal.push(['editReply', p]); return {}; },
  };
}

// ─────────── la commande /config ───────────
test('/config : affiche le sélecteur de sections en première rangée', async () => {
  const inter = interactionMock({ commandName: 'config', guildId: G, membre: membreMock({ permissions: ['ManageGuild'] }) });
  await config.executer(inter);
  const paquet = inter.journal[0][1];
  assert.ok(paquet.embeds?.length, 'aucun embed');
  const json = paquet.components.map((c) => c.toJSON());
  assert.strictEqual(json[0].components[0].custom_id, 'cfg:section', 'le sélecteur de sections doit être en premier');
  assert.strictEqual(json[0].components[0].options.length, 5, '5 sections attendues');
  assert.strictEqual(json.length, 1, 'à la première ouverture : le sélecteur seul');
});

test('première ouverture : PAS les réglages d\'accueil, juste le menu', () => {
  const G2 = `G-CFG-PUR-${Date.now()}`;
  const paquet = config.panneauPrincipal(G2, 'C1');
  const ids = paquet.components.map((r) => r.toJSON().components[0].custom_id);
  assert.deepStrictEqual(ids, ['cfg:section']);
  assert.ok(/Choisis/.test(paquet.embeds[0].toJSON().description), 'le texte doit inviter à choisir');
});

test('la rubrique choisie se mémorise : la rouvrir retombe dessus', async () => {
  const G3 = `G-CFG-GARDE-${Date.now()}`;
  const s1 = menuFactice({ customId: 'cfg:section', values: ['salons'], guildId: G3 });
  await config.composant(s1);
  const rendu2 = config.panneauPrincipal(G3);
  assert.ok(rendu2.components.length > 1, 'la rubrique mémorisée doit réafficher sa carte');
  const ids = rendu2.components.map((r) => r.toJSON().components[0].custom_id);
  assert.deepStrictEqual(ids, ['cfg:item', 'cfg:racine']);
});

test('rubrique choisie : SA carte, avec un menu qui liste ses réglages (et rien d\'autre)', async () => {
  const inter = menuFactice({ customId: 'cfg:section', values: ['salons'] });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).cfgSection, 'salons');
  const update = inter.journal.find(([type]) => type === 'update');
  assert.ok(update, 'panneau non rafraîchi');
  const json = update[1].components.map((r) => r.toJSON());
  assert.deepStrictEqual(json.map((c) => c.components[0].custom_id), ['cfg:item', 'cfg:racine'],
    'la carte rubrique = menu des réglages + bouton changer de rubrique, rien de mélangé');
  const opts = json[0].components[0].options.map((o) => o.value);
  assert.deepStrictEqual(opts, ['salons:logs', 'salons:regles', 'salons:support']);
});

test('réglage choisi : sa carte propre avec SON seul contrôle + retour', async () => {
  stockage.majReglages(G, { cfgSection: 'accueil', cfgItem: null });
  const nav = menuFactice({ customId: 'cfg:item', values: ['accueil:salon'] });
  await config.composant(nav);
  const json = nav.journal.find(([t]) => t === 'update')[1].components.map((r) => r.toJSON());
  assert.deepStrictEqual(json.map((c) => c.components[0].custom_id), ['cfg:accueil:salon', 'cfg:retour'],
    'aucun autre réglage ne doit traîner sur la carte du salon');
  const desc = nav.journal.find(([t]) => t === 'update')[1].embeds[0].toJSON().description;
  assert.ok(/Le salon où Otaku envoie la carte/.test(desc), 'la carte doit expliquer à quoi sert le réglage');
});

test('bouton retour : on revient à la carte de la rubrique', async () => {
  stockage.majReglages(G, { cfgSection: 'accueil', cfgItem: 'salon' });
  const inter = menuFactice({ customId: 'cfg:retour', kind: 'button' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).cfgItem, null);
  const json = inter.journal.find(([t]) => t === 'update')[1].components.map((r) => r.toJSON());
  assert.deepStrictEqual(json.map((c) => c.components[0].custom_id), ['cfg:item', 'cfg:racine']);
});

test('chaque rubrique a sa carte et chaque réglage sa description', () => {
  for (const [sec, rub] of Object.entries(config.RUBRIQUES)) {
    const carte = config.carteRubrique(G, sec, 'C1', null);
    const embed = carte.embeds[0].toJSON();
    assert.ok(embed.title.includes(rub.label.replace(/^[^ ]+ /, '')), `${sec} : titre de rubrique manquant`);
    for (const cle of Object.keys(rub.items)) {
      const c2 = config.carteReglage(G, sec, cle, 'C1', null);
      assert.ok(c2.embeds[0].toJSON().description.length > 30, `${sec}:${cle} : pas de description`);
      const ids = c2.components.map((r) => r.toJSON().components[0].custom_id);
      assert.ok(ids.includes('cfg:retour'), `${sec}:${cle} : bouton retour manquant`);
    }
  }
});

test('accueil : le menu de la carte contient bien les 6 réglages', () => {
  const carte = config.carteRubrique(G, 'accueil', 'C1', null);
  const menu = carte.components[0].toJSON().components[0];
  assert.deepStrictEqual(menu.options.map((o) => o.value),
    ['accueil:salon', 'accueil:role', 'accueil:langue', 'accueil:fond', 'accueil:message', 'accueil:couper']);
});

test('/config : refusé sans la permission Gérer le serveur', async () => {
  const inter = interactionMock({ commandName: 'config', guildId: G, membre: membreMock({ permissions: [] }) });
  await config.executer(inter);
  assert.ok(/Gérer le serveur/.test(texteReponses(inter)));
});

test('/config : le menu des modules contient les 6 réglages', async () => {
  const carte = config.carteReglage(G, 'automod', 'modules', null, null);
  const menu = carte.components[0].toJSON().components[0];
  assert.strictEqual(menu.custom_id, 'cfg:modules');
  assert.strictEqual(menu.options.length, 6, `${menu.options.length} options`);
  for (const valeur of ['spam', 'liens', 'insultes', 'majuscules', 'raid', 'sanctionAuto']) {
    assert.ok(menu.options.some((o) => o.value === valeur), `${valeur} manquant`);
  }
});

// ─────────── interactions du panneau ───────────
test('menu Modules : décocher « spam » le désactive vraiment', async () => {
  stockage.majReglages(G, { automod: { spam: true, insultes: true } });
  const inter = menuFactice({ customId: 'cfg:modules', values: ['insultes', 'liens'] });
  await config.composant(inter);
  const r = stockage.reglages(G);
  assert.strictEqual(r.automod.spam, false);
  assert.strictEqual(r.automod.insultes, true);
  assert.strictEqual(r.automod.liens, true);
});

test('menu Modules : le panneau se rafraîchit après le changement', async () => {
  const inter = menuFactice({ customId: 'cfg:modules', values: ['spam'] });
  await config.composant(inter);
  const mise = inter.journal.find(([type]) => type === 'update');
  assert.ok(mise, 'le panneau n\'a pas été rafraîchi');
});

test('salons : enregistre le salon des logs, des règles et du support', async () => {
  const salon = { id: 'S-LOGS', name: 'logs' };
  let inter = menuFactice({ customId: 'cfg:salons:logs', channels: [salon], kind: 'channel' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).logs, 'S-LOGS');

  inter = menuFactice({ customId: 'cfg:salons:regles', channels: [{ id: 'S-REG' }], kind: 'channel' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).guide.regles, 'S-REG');

  inter = menuFactice({ customId: 'cfg:salons:support', channels: [{ id: 'S-SUP' }], kind: 'channel' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).guide.support, 'S-SUP');
});

test('boutons « retirer » des salons : remettent à zéro un par un', async () => {
  let inter = menuFactice({ customId: 'cfg:salons:regles-off', kind: 'button' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).guide.regles, null);
  assert.strictEqual(stockage.reglages(G).guide.support, 'S-SUP', 'le support ne doit pas être touché');
});

test('accueil : le sélecteur de rôle définit le rôle automatique des nouveaux', async () => {
  const role = { id: 'R-MEMBRES', name: 'Membre' };
  const inter = {
    customId: 'cfg:accueil:role',
    guildId: G, channelId: 'C1',
    roles: { first: () => role },
    isStringSelectMenu: () => false, isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => true, isButton: () => false, isModalSubmit: () => false,
    inGuild: () => true, replied: false, deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u1', tag: 'Staff#0001' },
    journal: [],
    async update(p) { this.journal.push(['update', p]); return {}; },
    async reply(p) { this.journal.push(['reply', p]); return {}; },
  };
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).bienvenue.role, 'R-MEMBRES');
});

test('menu Sanctions : règle 3 avertissements → 60 min', async () => {
  const inter = menuFactice({ customId: 'cfg:sanction', values: ['3:60'] });
  await config.composant(inter);
  const a = stockage.reglages(G).automod;
  assert.strictEqual(a.sanctionAuto, true);
  assert.strictEqual(a.seuilAvert, 3);
  assert.strictEqual(a.dureeSanction, 60);
});

test('menu Sanctions : « off » désactive la sanction automatique', async () => {
  const inter = menuFactice({ customId: 'cfg:sanction', values: ['off'] });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).automod.sanctionAuto, false);
});

test('bouton « retirer les logs » vide le réglage', async () => {
  stockage.majReglages(G, { logs: 'S-LOGS' });
  const inter = menuFactice({ customId: 'cfg:salons:logs-off', kind: 'button' });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages(G).logs, null);
});

test('un identifiant inconnu est ignoré (pas de crash)', async () => {
  const inter = menuFactice({ customId: 'autre:chose' });
  const pris = await config.composant(inter);
  assert.strictEqual(pris, false);
});

test('le panneau est refusé à un non-admin, même par le menu', async () => {
  const inter = menuFactice({ customId: 'cfg:modules', values: ['spam'], membre: membreMock({ permissions: [] }) });
  const pris = await config.composant(inter);
  assert.strictEqual(pris, true);
  assert.ok(/Gérer le serveur/.test(texteReponses(inter)));
});

// ─────────── sanction automatique sur /warn ───────────
test('warn : au 3ᵉ avertissement, le membre est mis en sourdine automatiquement', async () => {
  const guilde = guildeMock({ id: `G-AUTO-${Date.now()}`, moiPosition: 50 });
  stockage.majReglages(guilde.id, { automod: { sanctionAuto: true, seuilAvert: 3, dureeSanction: 60 } });

  const auteur = membreMock({ id: 'staff1', permissions: ['ModerateMembers'], position: 30 });
  const cible = membreMock({ id: `mute-${Date.now()}`, position: 5 });
  cible.guild = guilde;

  for (let i = 0; i < 3; i += 1) {
    const inter = interactionMock({
      commandName: 'warn', guildId: guilde.id, guild: guilde, membre: auteur,
      options: { membre: cible, raison: `faute ${i + 1}` },
    });
    await warn.executer(inter);
    if (i === 2) {
      const texte = texteReponses(inter);
      assert.ok(/Sanction automatique appliquée/.test(texte), texte);
    }
  }

  const timeout = cible.actions.find((a) => a[0] === 'timeout');
  assert.ok(timeout, 'aucun mute automatique');
  assert.strictEqual(timeout[1], 3600000);
});

test('warn : sans sanction automatique activée, aucun mute', async () => {
  const guilde = guildeMock({ id: `G-NOAUTO-${Date.now()}`, moiPosition: 50 });
  stockage.majReglages(guilde.id, { automod: { sanctionAuto: false } });
  const auteur = membreMock({ id: 'staff2', permissions: ['ModerateMembers'], position: 30 });
  const cible = membreMock({ id: `nomute-${Date.now()}`, position: 5 });
  cible.guild = guilde;

  for (let i = 0; i < 3; i += 1) {
    const inter = interactionMock({
      commandName: 'warn', guildId: guilde.id, guild: guilde, membre: auteur,
      options: { membre: cible, raison: 'test' },
    });
    await warn.executer(inter);
  }
  assert.strictEqual(cible.actions.filter((a) => a[0] === 'timeout').length, 0);
});

module.exports = { nom: 'panneau', cas };

if (require.main === module) require('./executeur')(module.exports);
