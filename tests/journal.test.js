/**
 * tests/journal.test.js — le « Journal du staff » : suppressions, modifications
 * et départs de membres. Chaque ligne doit partir au bon endroit, une seule
 * fois, sans jamais casser l'embed ni mentionner qui que ce soit.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stockage = require('../utils/stockage');
const journal = require('../utils/journal');
const suppr = require('../events/messageDelete');
const modif = require('../events/messageUpdate');
const depart = require('../events/guildMemberRemove');

const G = 'G-JOURNAL-TEST';

function guildAvec(envoyes, id = G) {
  const salon = { send: async (p) => { envoyes.push(p); } };
  return { id, channels: { cache: { get: (cid) => (cid === 'LOGS' ? salon : null) } } };
}

let compteur = 0;
function messageSur(g, over = {}) {
  const n = ++compteur;
  return {
    id: `m-${n}`,
    guild: g,
    channelId: `C-${n}`,   // un canal unique par test : aucune fenêtre de silence ne déborde d'un test à l'autre
    channel: { name: 'general' },
    partial: false,
    author: { id: 'u1', tag: 'pseudo#1', bot: false },
    content: 'salut les amis',
    attachments: new Map(),
    ...over,
  };
}

let okCount = 0;
const cas = [];
function test(nom, fn) { cas.push({ nom, fn }); }

function descDe(envoye) {
  const embed = envoye.embeds[0];
  return (embed.toJSON ? embed.toJSON() : embed).description || '';
}
function titreDe(envoye) {
  const embed = envoye.embeds[0];
  return (embed.toJSON ? embed.toJSON() : embed).title || '';
}

// ─── suppressions ───
test('suppression simple → UNE ligne au journal, auteur + salon + extrait', async () => {
  stockage.majReglages(G, { logs: 'LOGS', journal: { suppressions: true, modifications: true, sorties: true } });
  const envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes)));
  assert.strictEqual(envoyes.length, 1, `attendu 1 ligne, reçu ${envoyes.length}`);
  assert.match(titreDe(envoyes[0]), /Message supprimé/);
  assert.match(descDe(envoyes[0]), /pseudo#1/);
  assert.match(descDe(envoyes[0]), /#general/);
  assert.match(descDe(envoyes[0]), /salut les amis/);
});

test('retrait marqué par le bot lui-même (auto-mod, clear) → JAMAIS de doublon', async () => {
  const g = guildAvec([]);
  const m = messageSur(g);
  const envoyes = [];
  m.guild = guildAvec(envoyes);
  journal.taireMessage(m.id);
  await suppr.executer(null, m);
  assert.strictEqual(envoyes.length, 0, 'la marque de silence a été ignorée');
});

test('suppression groupée /clear → salon marqué silencieux, rien au journal', async () => {
  const envoyes = [];
  const m = messageSur(guildAvec(envoyes));
  journal.taireSalon(m.channelId);
  await suppr.executer(null, m);
  assert.strictEqual(envoyes.length, 0);
});

test('message de bot, message partiel, salon des logs lui-même → silence', async () => {
  let envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes), { author: { id: 'b', tag: 'bot', bot: true } }));
  assert.strictEqual(envoyes.length, 0, 'le bot ne doit pas se journaliser lui-même');

  envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes), { partial: true }));
  assert.strictEqual(envoyes.length, 0, 'message partiel (oublié par Discord) ignoré');

  envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes), { channelId: 'LOGS' }));
  assert.strictEqual(envoyes.length, 0, 'le journal ne se consigne pas lui-même');
});

test('module « suppressions » coupé dans /config → plus aucune ligne', async () => {
  stockage.majReglages(G, { journal: { suppressions: false } });
  const envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes)));
  assert.strictEqual(envoyes.length, 0);
  stockage.majReglages(G, { journal: { suppressions: true } });
});

test('sans salon de logs réglé → le bot travaille quand même, zéro trace, zéro crash', async () => {
  stockage.majReglages(G, { logs: null });
  await suppr.executer(null, messageSur(guildAvec([])));
  stockage.majReglages(G, { logs: 'LOGS' });
});

test('extrait piégé : backticks neutralisés, @everyone jamais mentionné, zéro ping autorisé', async () => {
  const envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes), {
    content: '`````@everyone suivez @HERE`````',
  }));
  assert.strictEqual(envoyes.length, 1);
  const d = descDe(envoyes[0]);
  assert.ok(!/``/.test(d), 'des backticks nudus ont survécu : ' + d);
  assert.ok(!/@(everyone|here)\b/.test(d), 'mention @everyone/@here échappée attendue : ' + d);
  assert.deepStrictEqual(envoyes[0].allowedMentions, { parse: [] }, 'le journal ne doit pinguer personne');
});

test('extrait trop long → tronqué avec … (jamais au-dessus de la limite de l\u2019embed)', async () => {
  const envoyes = [];
  await suppr.executer(null, messageSur(guildAvec(envoyes), { content: 'a'.repeat(2000) }));
  const d = descDe(envoyes[0]);
  assert.match(d, /aaa…/);
  assert.ok(d.length < 1900, `description trop longue : ${d.length}`);
});

// ─── modifications ───
test('modification réelle → l\u2019avant ET l\u2019après sont notés', async () => {
  const envoyes = [];
  const g = guildAvec(envoyes);
  await modif.executer(null, messageSur(g, { content: 'j\u2019aime les croissants', url: undefined }),
    messageSur(g, { content: 'j\u2019aime les pâtisseries', url: 'https://discord.com/channels/1/2/3' }));
  assert.strictEqual(envoyes.length, 1);
  assert.match(titreDe(envoyes[0]), /Message modifié/);
  assert.match(descDe(envoyes[0]), /croissants/);
  assert.match(descDe(envoyes[0]), /pâtisseries/);
  assert.match(descDe(envoyes[0]), /Lien :/);
});

test('fausse modification (mêmes mots, espacements différents) → rien au journal', async () => {
  const envoyes = [];
  const g = guildAvec(envoyes);
  await modif.executer(null, messageSur(g, { content: 'salut   toi' }), messageSur(g, { content: 'salut toi' }));
  assert.strictEqual(envoyes.length, 0);
});

test('module « modifications » coupé → plus aucune ligne', async () => {
  stockage.majReglages(G, { journal: { modifications: false } });
  const envoyes = [];
  const g = guildAvec(envoyes);
  await modif.executer(null, messageSur(g, { content: 'un' }), messageSur(g, { content: 'deux' }));
  assert.strictEqual(envoyes.length, 0);
  stockage.majReglages(G, { journal: { modifications: true } });
});

// ─── départs ───
test('départ normal → ligne sobre avec compte daté en format natif Discord', async () => {
  const envoyes = [];
  const vieux = Date.now() - 400 * 86400000;
  await depart.executer(null, {
    guild: guildAvec(envoyes), id: 'u9',
    user: { id: 'u9', tag: 'Vieux#1', bot: false, createdTimestamp: vieux },
    roles: { cache: { size: 2 } }, displayName: 'Vieux',
  });
  assert.strictEqual(envoyes.length, 1);
  assert.match(titreDe(envoyes[0]), /Vieux a quitté le serveur/);
  assert.match(descDe(envoyes[0]), /<t:\d+:D>/);
  assert.ok(!/⚠️/.test(descDe(envoyes[0])), 'compte ancien : pas d\u2019alerte');
});

test('départ d\u2019un compte tout jeune → signalé (possible raid-éclair)', async () => {
  const envoyes = [];
  await depart.executer(null, {
    guild: guildAvec(envoyes), id: 'u8',
    user: { id: 'u8', tag: 'Jeune#0001', bot: false, createdTimestamp: Date.now() - 2 * 86400000 },
    roles: { cache: { size: 1 } }, displayName: 'Jeune',
  });
  assert.strictEqual(envoyes.length, 1);
  assert.match(descDe(envoyes[0]), /⚠️ .*moins de 7 jours/);
});

test('bot qui part / module sorties coupé → silence', async () => {
  const envoyes = [];
  await depart.executer(null, {
    guild: guildAvec(envoyes), id: 'b1',
    user: { id: 'b1', tag: 'Bot', bot: true, createdTimestamp: Date.now() },
  });
  assert.strictEqual(envoyes.length, 0);
  stockage.majReglages(G, { journal: { sorties: false } });
  await depart.executer(null, {
    guild: guildAvec(envoyes), id: 'u7',
    user: { id: 'u7', tag: 'Quelquun#2', bot: false, createdTimestamp: Date.now() - 86400000 * 30 },
    roles: { cache: { size: 1 } },
  });
  assert.strictEqual(envoyes.length, 0);
  stockage.majReglages(G, { journal: { sorties: true } });
});

// ─── branchement général ───
test('index.js enregistre les trois événements du journal', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'index.js'), 'utf8');
  for (const f of ['messageDelete', 'messageUpdate', 'guildMemberRemove']) {
    assert.ok(src.includes(`require('./events/${f}')`), `${f} non enregistré dans index.js`);
  }
});

test('events : le retrait auto-mod marque le silence AVANT de supprimer', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'events', 'messageCreate.js'), 'utf8');
  const i = src.indexOf('taireMessage');
  const j = src.indexOf('await message.delete()');
  assert.ok(i > 0 && j > 0 && i < j, 'taireMessage doit précéder la suppression du message');
});

test('clear.js : les deux chemins de purge marquent le silence', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'commands', 'clear.js'), 'utf8');
  assert.ok(src.includes('taireMessage'), 'silence par liste manquant');
  assert.ok(src.includes('taireSalon'), 'silence par salon manquant');
});

// ─── /config ───
test('/config rubrique salons : le menu propose bien le nouveau réglage journal', () => {
  const configCmd = require('../commands/config');
  const carte = configCmd.carteRubrique(G, 'salons', 'C1', null);
  const menu = carte.components[0].toJSON().components[0];
  assert.deepStrictEqual(menu.options.map((o) => o.value),
    ['salons:logs', 'salons:regles', 'salons:support', 'salons:journal']);
});

test('/config carte journal : valeur actuelle unifiée + menu à 3 coches, toutes par défaut', () => {
  const configCmd = require('../commands/config');
  const embed = configCmd.carteReglage(G, 'salons', 'journal', 'C1', null).embeds[0].toJSON();
  const champ = (embed.fields || []).find((f) => f.name === '\u{1F4CC} Valeur actuelle');
  assert.ok(champ && /tout/.test(champ.value), 'état du journal absent : ' + JSON.stringify(embed.fields));
  const menu = configCmd.carteReglage(G, 'salons', 'journal', 'C1', null).components[0].toJSON().components[0];
  assert.strictEqual(menu.options.length, 3);
  assert.ok(menu.options.every((o) => o.default === true), 'les 3 traces doivent être actives par défaut');
});

test('/config : cocher le journal enregistre vraiment les valeurs', async () => {
  const configCmd = require('../commands/config');
  let rendu = null;
  const inter = {
    customId: 'cfg:journal',
    values: ['suppressions', 'sorties'],
    guildId: G,
    inGuild: () => true,
    isStringSelectMenu: () => true,
    isChannelSelectMenu: () => false,
    isButton: () => false,
    member: { permissions: { has: () => true } },
    update: async (p) => { rendu = p; },
    reply: async (p) => { rendu = p; },
  };
  await configCmd.composant(inter);
  const j = stockage.reglages(G).journal;
  assert.strictEqual(j.suppressions, true);
  assert.strictEqual(j.sorties, true);
  assert.strictEqual(j.modifications, false);
  assert.ok(rendu, 'aucun retour à l\u2019écran après le choix');
  stockage.majReglages(G, { journal: { suppressions: true, modifications: true, sorties: true } });
});

// ─── exécution ───
(async () => {
  let echecs = 0;
  for (const c of cas) {
    try {
      await c.fn();
      okCount++;
      console.log('  ✅ ' + c.nom);
    } catch (e) {
      echecs++;
      console.log('  ❌ ' + c.nom + ' → ' + e.message);
    }
  }
  console.log(`\njournal : ${okCount}/${cas.length} OK${echecs ? ' — ÉCHECS' : ' ✅'}`);
  process.exit(echecs ? 1 : 0);
})();
