/**
 * tests/assistant-ticket.test.js — l'assistant d'accueil dans les tickets.
 * Machine à états testée SANS Discord ni réseau : transport fictif, IA fausse
 * injectée. Ce qui est vérifié ici est exactement ce qui se passera en vrai.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stockage = require('../utils/stockage');
const asst = require('../utils/assistant-ticket');

const G = 'G-ASSISTANT-TEST';
const cas = [];
function test(nom, fn) { cas.push({ nom, fn }); }

function decor() {
  asst.sessions.clear();
  for (const k of [...asst.CLOS.keys()]) asst.CLOS.delete(k);
  stockage.ecrire('assistant-sessions', {});
  asst.__setIA(null);
  stockage.majReglages(G, {
    logs: null,
    assistant: {
      actif: true, categorie: 'CAT', panneau: null, alerte: 'AL', staffRole: 'R-STAFF',
      questions: ['Quel est le problème exactement ?', 'Depuis quand ça dure ?'],
    },
  });
}

function monde() {
  const env = { sent: [], alerte: [] };
  const canal = {
    id: 'T1', name: 'ticket-alice', parentId: 'CAT', type: 0,
    send: async (p) => { env.sent.push(p); return { id: `m${env.sent.length}`, edit: async () => {} }; },
  };
  const canalAlerte = {
    id: 'AL', name: 'alerte-staff',
    send: async (p) => { env.alerte.push(p); return { id: 'a1', edit: async () => {} }; },
  };
  const guild = {
    id: G,
    channels: { cache: { get: (cid) => (cid === 'T1' ? canal : cid === 'AL' ? canalAlerte : null) } },
  };
  canal.guild = guild;
  env.guild = guild;
  env.canal = canal;
  env.membre = (over = {}) => ({
    id: 'U1',
    user: { id: 'U1', username: 'alice', tag: 'alice#0001', bot: false },
    permissions: { has: () => false },
    roles: { cache: { has: () => false } },
    ...over,
  });
  env.staff = () => env.membre({
    id: 'MOD1',
    user: { id: 'MOD1', username: 'modo', tag: 'modo#0001', bot: false },
    roles: { cache: { has: (r) => r === 'R-STAFF' } },
  });
  env.message = (content, membre) => ({
    content, author: membre.user, member: membre, channel: env.canal, guild,
  });
  return env;
}

// ─── déclenchement ───
test('coupé ou hors catégorie → Otaku ne dit rien', async () => {
  decor();
  stockage.majReglages(G, { assistant: { actif: false } });
  let env = monde();
  assert.strictEqual(await asst.traiterMessage(env.message('salut', env.membre())), false, 'coupé mais réagit');

  stockage.majReglages(G, { assistant: { actif: true } });
  env = monde();
  const autre = { ...env.canal, parentId: 'AUTRE-CAT' };
  assert.strictEqual(await asst.traiterMessage({ content: 'salut', author: env.membre().user, member: env.membre(), channel: autre, guild: env.guild }), false, 'hors catégorie mais réagit');
});

test('première parole du créateur → accueil + première question', async () => {
  decor();
  const env = monde();
  assert.strictEqual(await asst.traiterMessage(env.message('saatut j ai un bug', env.membre())), true);
  assert.strictEqual(env.sent.length, 1, 'un seul message : ' + JSON.stringify(env.sent));
  assert.match(env.sent[0].content, /bienvenue dans ce ticket/i);
  assert.ok(env.sent[0].content.includes('Quel est le problème exactement ?'), 'la 1re question réglée par l\u2019admin doit être posée');
  assert.deepStrictEqual(env.sent[0].allowedMentions, { parse: [] }, 'jamais de ping');
});

test('les réponses défilent sur les questions fixes, puis « c\u2019est tout ? »', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  await asst.traiterMessage(env.message('le son coupe', env.membre()));
  assert.match(env.sent.at(-1).content, /Depuis quand/);
  await asst.traiterMessage(env.message('depuis hier', env.membre()));
  assert.match(env.sent.at(-1).content, /C'est tout, ou tu as autre chose/);
});

test('« c\u2019est tout \u00bb → récap pour le staff avec les 2 boutons', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  await asst.traiterMessage(env.message('le son coupe', env.membre()));
  await asst.traiterMessage(env.message('depuis hier', env.membre()));
  await asst.traiterMessage(env.message("non c'est tout", env.membre()));
  const recap = env.sent.at(-1);
  assert.match(recap.content, /Récapitulatif pour le staff/);
  assert.ok(recap.content.includes('le son coupe'), 'les réponses recueillies doivent être dans le récap');
  const boutons = recap.components[0].components;
  assert.deepStrictEqual(boutons.map((b) => b.custom_id), ['asst:prendre:T1', 'asst:relancer:T1']);
});

test('bouton « Je prends en charge » → l\u2019assistant remercie et se tait POUR TOUJOURS dans ce ticket', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const s = asst.sessions.get('T1');
  await asst.finaliser(s, env.canal, {});
  let rendu = null;
  await asst.traiterBouton({
    customId: 'asst:prendre:T1', user: { username: 'Modo' }, guild: env.guild,
    message: null,
    reply: async (p) => { rendu = p; },
  });
  assert.match(rendu.content, /je me retire/i);
  assert.strictEqual(asst.sessions.get('T1'), undefined, 'la session doit être effacée');
  assert.strictEqual(await asst.traiterMessage(env.message('et là ?', env.membre())), false, 'l\u2019assistant doit être définitivement muet ici');
});

test('bouton « Continuer à questionner » → relance polie, puis silence de l\u2019assistant après la prise en charge', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const s = asst.sessions.get('T1');
  await asst.finaliser(s, env.canal, {});
  let rendu = null;
  await asst.traiterBouton({
    customId: 'asst:relancer:T1', user: { username: 'Modo' }, guild: env.guild,
    message: { content: 'récap', channel: env.canal, edit: async () => {} },
    reply: async (p) => { rendu = p; },
  });
  assert.strictEqual(rendu.flags, 64, 'la réponse au clic staff reste éphémère');
  assert.strictEqual(asst.sessions.get('T1').phase, 'questions', 'l\u2019entretien reprend');
});

// ─── le monde réel autour ───
test('le staff qui arrive en plein entretien → récap immédiat, pas d\u2019interrogatoire de plus', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const avant = env.sent.length;
  assert.strictEqual(await asst.traiterMessage(env.message('coucou, je suis là', env.staff())), true);
  assert.strictEqual(env.sent.length, avant + 1, 'exactement le récapitulatif, rien de plus');
  assert.match(env.sent.at(-1).content, /Le staff est arrivé/);
});

test('le membre réclame un humain → récap + alerte au salon d\u2019alerte', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  await asst.traiterMessage(env.message('je préfère parler à un humain en fait', env.membre()));
  assert.match(env.sent.at(-1).content, /Récapitulatif pour le staff/);
  assert.strictEqual(env.alerte.length, 1, 'le salon d\u2019alerte doit être prévenu');
  assert.match(env.alerte[0].content, /demande un humain/);
});

test('un tiers ni staff ni créateur → ignoré (pas de harcèlement du copain qui passe)', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const copain = env.membre({ id: 'U2', user: { id: 'U2', username: 'copain', tag: 'copain#1', bot: false } });
  assert.strictEqual(await asst.traiterMessage(env.message('mdr', copain)), false);
  assert.strictEqual(env.sent.length, 1, 'aucun message de plus');
});

test('message d\u2019un bot (l\u2019autre bot de tickets) → jamais traité', async () => {
  decor();
  const env = monde();
  const bot = { id: 'B1', user: { id: 'B1', username: 'TicketBot', tag: 'tb', bot: true }, permissions: { has: () => false }, roles: { cache: { has: () => false } } };
  assert.strictEqual(await asst.traiterMessage({ content: 'Ticket créé', author: bot.user, member: bot, channel: env.canal, guild: env.guild }), false);
});

// ─── IA ───
test('sans questions fixes, l\u2019IA mène et peut conclure (FIN)', async () => {
  decor();
  stockage.majReglages(G, { assistant: { questions: [] } });
  const relances = [];
  asst.__setIA(async (systeme, question) => {
    relances.push(question);
    return { texte: relances.length === 1 ? 'QUESTION: depuis quand ?' : 'FIN: le son coupe depuis des jours' };
  });
  const env = monde();
  await asst.traiterMessage(env.message('salut j\u2019ai un souci son', env.membre()));   // accueil
  await asst.traiterMessage(env.message('le son coupe', env.membre()));                    // → QUESTION IA
  assert.match(env.sent.at(-1).content, /depuis quand/);
  await asst.traiterMessage(env.message('depuis 3 jours', env.membre()));                  // → FIN → clôture
  assert.match(env.sent.at(-1).content, /C'est tout, ou tu as autre chose/);
  await asst.traiterMessage(env.message('non c\u2019est tout', env.membre()));
  assert.match(env.sent.at(-1).content, /Récapitulatif pour le staff/);
  assert.ok(env.sent.at(-1).content.includes('depuis 3 jours'));
});

test('IA en panne (exception) → aucune question posée, le fil continue sans crash', async () => {
  decor();
  stockage.majReglages(G, { assistant: { questions: [] } });
  asst.__setIA(async () => { throw new Error('réseau KO'); });
  const env = monde();
  await asst.traiterMessage(env.message('salut', env.membre()));
  await asst.traiterMessage(env.message('un truc marche pas', env.membre()));
  assert.ok(env.sent.length >= 2, 'l\u2019entretien ne meurt pas si l\u2019IA tombe');
  assert.match(env.sent.at(-1).content, /C'est tout, ou tu as autre chose/);
});

// ─── garde-fous ───
test('silence 16 min → rappel doux, une seule fois ; 31 min → récap transmises quand même', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const s = asst.sessions.get('T1');
  const t0 = Date.now();
  s.derniereActivite = t0 - 16 * 60 * 1000;
  await asst.tick(t0);
  assert.match(env.sent.at(-1).content, /Pas de pression/);
  await asst.tick(t0 + 1000);
  assert.strictEqual(env.sent.filter((m) => /Pas de pression/.test(m.content)).length, 1, 'rappel en boucle !');
  s.derniereActivite = t0 - 31 * 60 * 1000;
  await asst.tick(t0);
  assert.match(env.sent.at(-1).content, /Récapitulatif pour le staff/);
  assert.match(env.sent.at(-1).content, /Silence du membre/);
});

test('jamais plus de 8 entretiens ouverts par serveur (anti-explosion de coûts)', async () => {
  decor();
  const env = monde();
  const guild = env.guild;
  for (let i = 0; i < 8; i++) {
    const canal = {
      id: `T${100 + i}`, parentId: 'CAT', type: 0, guild,
      send: async () => ({ id: 'x', edit: async () => {} }),
    };
    const m = env.membre({ id: `U${i}` });
    await asst.demarrer({ author: m.user, member: m, channel: canal, guild });
  }
  assert.strictEqual(asst.sessions.size, 8);
  const canal = { id: 'T999', parentId: 'CAT', type: 0, guild, send: async () => ({ id: 'x', edit: async () => {} }) };
  const s9 = await asst.traiterMessage({ content: 'moi aussi', author: env.membre().user, member: env.membre(), channel: canal, guild });
  assert.strictEqual(s9, false, 'la 9e session ne doit pas démarrer');
});

// ─── persistance ───
test('redémarrage du bot → les entretiens en cours sont repris, les morts sont jetés', async () => {
  decor();
  const env = monde();
  await asst.traiterMessage(env.message('bug', env.membre()));
  const vivant = asst.sessions.get('T1');
  const vieux = { ...vivant };
  delete vieux.derniereActivite;
  stockage.ecrire('assistant-sessions', {
    T1: { ...vivant },
    TV: { ...vieux, derniereActivite: Date.now() - 5 * 60 * 60 * 1000 },
  });
  asst.sessions.clear();
  const n = asst.recharger();
  assert.strictEqual(n, 1, 'le vivant revient, le périmé disparaît');
  assert.strictEqual(asst.sessions.get('TV'), undefined);
});

// ─── /config ───
test('/config assistant : rubrique avec 6 réglages et carte d\u2019état cohérente', () => {
  const configCmd = require('../commands/config');
  const carte = configCmd.carteRubrique(G, 'assistant', 'C1', null);
  const menu = carte.components[0].toJSON().components[0];
  assert.deepStrictEqual(menu.options.map((o) => o.value),
    ['assistant:couper', 'assistant:categorie', 'assistant:panneau', 'assistant:staff', 'assistant:alerte', 'assistant:questions']);
  const fields = carte.embeds[0].toJSON().fields.map((f) => f.name);
  assert.ok(fields.includes('🎛️ Interrupteur') && fields.includes('📁 Catégorie'), fields.join('|'));
});

test('/config assistant : l\u2019interrupteur, la catégorie et les questions enregistrent vraiment', async () => {
  const configCmd = require('../commands/config');
  const inter = (customId, over = {}) => {
    let rendu = null;
    return {
      objet: {
        customId, guildId: G, inGuild: () => true,
        isStringSelectMenu: () => false, isChannelSelectMenu: () => customId.includes('categorie') || customId.includes('panneau') || customId.includes('alerte'),
        isButton: () => !customId.includes('modal'),
        member: { permissions: { has: () => true } },
        update: async (p) => { rendu = p; }, reply: async (p) => { rendu = p; },
        showModal: async () => {},
        fields: { getTextInputValue: () => over.brut || '' },
        channels: over.channels || [],
        roles: over.roles || { first: () => null },
        _rendu: () => rendu,
      },
    };
  };
  let i = inter('cfg:asst:toggle');
  await configCmd.composant(i.objet);
  assert.strictEqual(stockage.reglages(G).assistant.actif, false, 'toggle doit couper');

  const cat = { id: 'CA-1', name: 'tickets' };
  i = inter('cfg:asst:categorie', { channels: [cat] });
  i.objet.channels = { first: () => cat };
  await configCmd.composant(i.objet);
  assert.strictEqual(stockage.reglages(G).assistant.categorie, 'CA-1');

  i = inter('cfg:asst:questions-modal', { brut: 'q1\nq2\n\nq3   \nq4\nq5\nq6\nq7\nq8' });
  await configCmd.composant(i.objet);
  assert.deepStrictEqual(stockage.reglages(G).assistant.questions, ['q1', 'q2', 'q3', 'q4', 'q5', 'q6'], '6 max, coupées nettes');
});

// ─── branchement dans le vrai flux ───
test('messageCreate : l\u2019assistant passe APRÈS l\u2019auto-mod (un message bloqué ne nourrit pas l\u2019IA)', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'events', 'messageCreate.js'), 'utf8');
  const i = src.indexOf('assistant-ticket');
  const j = src.indexOf('modérer\|1. modération automatique');
  const k = src.indexOf('1. modération automatique');
  assert.ok(i > 0, 'hook absent de messageCreate');
  assert.ok(k > 0 && i > k, 'le hook doit venir après la section auto-mod');
});

test('interactionCreate : les boutons asst: sont routés en priorité', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'events', 'interactionCreate.js'), 'utf8');
  assert.ok(src.includes("startsWith('asst:')"), 'routage asst: manquant');
});

// ─── exécution ───
(async () => {
  let reussis = 0;
  const echecs = [];
  for (const c of cas) {
    try {
      await c.fn();
      reussis++;
      console.log('  ✅ ' + c.nom);
    } catch (e) {
      echecs.push(c.nom);
      console.log('  ❌ ' + c.nom + ' → ' + e.message);
    }
  }
  console.log(`\nassistant-ticket : ${reussis}/${cas.length}${echecs.length ? ` — ${echecs.length} ÉCHEC(S)` : ' OK ✅'}`);
  process.exit(echecs.length ? 1 : 0);
})();
