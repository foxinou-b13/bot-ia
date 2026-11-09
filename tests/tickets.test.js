/**
 * tests/tickets.test.js — le système de tickets natif d'Otaku.
 * Faux canaux, faux membres : on vérifie les permissions, la marque dans le
 * topic, la transcription, et — exigence du patron — l'ABSENCE totale d'image
 * générée sous le panneau.
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stockage = require('../utils/stockage');
const tickets = require('../utils/tickets');
const asst = require('../utils/assistant-ticket');

const G = 'G-TICKETS-TEST';
const cas = [];
function test(nom, fn) { cas.push({ nom, fn }); }

tickets.__setDelaiSuppression(0);   // pas d'attente en test

function decor(sur = {}) {
  stockage.majReglages(G, {
    logs: null,
    journal: { suppressions: false, modifications: false, sorties: false },
    tickets: {
      actif: true, categorie: 'CAT-T', panneau: 'P-1', logs: 'LOGS-1',
      staffRole: 'R-STAFF', titre: null, texte: null, mode: 'bouton', types: [],
    },
    assistant: { actif: false, categorie: null, panneau: null, alerte: null, staffRole: null, questions: [] },
  });
  asst.sessions.clear();
  for (const k of [...asst.CLOS.keys()]) asst.CLOS.delete(k);
  return sur;
}

function monde(sur = {}) {
  const env = { created: [], sends: [] };
  const mkCanal = (id, props = {}) => {
    const c = {
      id, type: 0, name: `canal-${id}`, topic: '', parentId: null,
      send: async (p) => { env.sends.push({ a: id, p }); return { id: `m-${env.sends.length}`, edit: async () => {} }; },
      delete: async () => { c.supprime = true; return c; },
      setTopic: async (t) => { c.topic = t; },
      permissionOverwrites: {
        appels: [],
        create: async (id2, o) => { c.permissionOverwrites.appels.push(['create', id2, o]); },
        delete: async (id2) => { c.permissionOverwrites.appels.push(['delete', id2]); },
      },
      messages: { fetch: async () => ({ values: () => sur.messages || [] }) },
      ...props,
    };
    return c;
  };
  const pan = mkCanal('P-1');
  const logs = mkCanal('LOGS-1');
  const parId = { 'P-1': pan, 'LOGS-1': logs, 'CAT-T': { id: 'CAT-T', type: 4, name: '📩 Tickets' } };
  for (const c of env.created) parId[c.id] = c;
  const guild = {
    id: G,
    name: 'Le Repaire',
    roles: { everyone: { id: '@everyone' } },
    channels: {
      cache: {
        get: (id) => parId[id] || env.created.find((c) => c.id === id) || null,
        values: () => Object.values(parId).concat(env.created.filter((c) => !parId[c.id])),
      },
      create: async (opts) => {
        const c = mkCanal(`NEW-${env.created.length + 1}`, {
          name: opts.name, topic: opts.topic || '', parentId: opts.parent || null,
          permissionOverwritesInit: opts.permissionOverwrites,
        });
        c.parentId = opts.parent || null;
        env.created.push(c); parId[c.id] = c;
        return c;
      },
    },
    members: {
      fetch: async (id) => {
        if (sur.parti === String(id)) throw new Error('inconnu');
        return { id: String(id), username: `u${id}`, user: { id: String(id), username: `u${id}`, tag: `u${id}#1`, bot: false }, permissions: { has: () => false }, roles: { cache: { has: () => false } } };
      },
    },
  };
  env.guild = guild;
  env.pan = pan; env.logs = logs; env.mkCanal = mkCanal;
  env.inter = (over = {}) => {
    const i = {
      user: { id: 'U1', username: 'alice', tag: 'alice#1', bot: false },
      member: { id: 'U1', permissions: { has: () => false }, roles: { cache: { has: (r) => r === 'R-STAFF' && false } } },
      guild,
      guildId: G,
      channel: sur.canalCourant || mkCanal('X'),
      client: { user: { id: 'BOT' } },
      isButton: () => true,
      isModalSubmit: () => false,
      fields: { getTextInputValue: () => sur.raison || '' },
      showModal: async (m) => { i.modal = m.toJSON(); },
      replies: [],
      async reply(p) { this.replies.push(p); return { id: 'r1' }; },
      async followUp(p) { this.replies.push(p); },
      ...over,
    };
    return i;
  };
  env.staff = (i) => {
    i.member = { id: 'MOD1', permissions: { has: () => true }, roles: { cache: { has: () => true } } };
    i.user = { id: 'MOD1', username: 'modo', tag: 'modo#1', bot: false };
    return i;
  };
  return env;
}

// ─── panneau ───
test('panneau = carte + bouton, JAMAIS d’image ni pièce jointe', () => {
  decor();
  const r = tickets.reglages(G);
  const paquet = tickets.panneauMessage(r, 'Le Repaire');
  assert.strictEqual(paquet.components[0].components[0].data.custom_id, 'tik:ouvrir');
  assert.strictEqual(paquet.components[0].components[0].data.label, 'Ouvrir un ticket');
  assert.strictEqual(paquet.files, undefined, 'le panneau ne doit jamais porter de fichier');
  assert.strictEqual(paquet.embeds[0].toJSON().image, undefined, 'pas d’embed.image non plus');
});

test('interdit structurel : le moteur ne connaît ni bannière, ni canvas, ni PNG', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'utils', 'tickets.js'), 'utf8');
  for (const mot of ['banniere', 'canvas', 'toBuffer', 'AttachmentBuilder', 'setImage', 'attachement']) {
    assert.ok(!src.includes(mot), `Le moteur ne doit pas manipuler d'image (${mot} trouvé)`);
  }
});

// ─── ouvrir ───
test('clic du membre → salon privé créé sous la catégorie, permissions carrées, topic marqueur', async () => {
  decor();
  const env = monde();
  const i = env.inter();
  assert.strictEqual(await tickets.composant({ ...i, customId: 'tik:ouvrir' }), true);
  assert.strictEqual(env.created.length, 1, 'exactement un salon créé');
  const c = env.created[0];
  assert.strictEqual(c.parentId, 'CAT-T', 'sous la catégorie des tickets');
  assert.strictEqual(c.name, 'ticket-alice');
  assert.strictEqual(c.topic, 'otaku-ticket:U1', 'le topic porte la marque + l’auteur');
  const ow = c.permissionOverwritesInit;
  assert.deepStrictEqual(ow[0], { id: '@everyone', deny: [n('ViewChannel')] });
  assert.ok(ow.some((o) => o.id === 'U1' && o.allow.length >= 3), 'l’auteur a le droit d’écrire');
  assert.ok(ow.some((o) => o.id === 'R-STAFF'), 'le rôle staff a accès');
  assert.ok(ow.some((o) => o.id === 'BOT'), 'le bot garde la main');
  // carte d'accueil dans le ticket : deux boutons, pas d'image
  const envoiTicket = env.sends.find((s) => s.a === c.id);
  assert.ok(envoiTicket, 'le message d’accueil doit partir dans le nouveau salon');
  assert.deepStrictEqual(envoiTicket.p.components[0].components.map((b) => b.data.custom_id.split(':')[0] + ':' + b.data.custom_id.split(':')[1]), ['tik:claim', 'tik:fermer']);
  assert.strictEqual(envoiTicket.p.files, undefined);
  assert.strictEqual(i.replies[0].flags, 64, 'la réponse au clic est éphémère');
  assert.match(i.replies[0].content, /<#NEW-1>/);
});

function n(bit) {
  const { PermissionFlagsBits } = require('discord.js');
  return PermissionFlagsBits[bit];
}

test('sans configuration, le clic répond poliment et ne crée rien', async () => {
  stockage.majReglages(G, { tickets: { actif: false, categorie: null } });
  const env = monde();
  const i = env.inter();
  await tickets.composant({ ...i, customId: 'tik:ouvrir' });
  assert.strictEqual(env.created.length, 0);
  assert.match(i.replies[0].content, /\/tickets setup/);
});

test('un membre = un ticket : le doublon reçoit un lien vers son ticket existant', async () => {
  decor();
  const env = monde();
  await tickets.composant({ ...env.inter(), customId: 'tik:ouvrir' });
  const i2 = env.inter();
  await tickets.composant({ ...i2, customId: 'tik:ouvrir' });
  assert.strictEqual(env.created.length, 1, 'un seul salon créé au total');
  assert.match(i2.replies[0].content, /déjà un ticket ouvert : <#NEW-1>/);
});

test('nom du salon : accents et majuscules nettoyés', () => {
  assert.strictEqual(tickets.nomDuTicket({ username: 'Élodie♥92' }), 'ticket-elodie-92');
  assert.strictEqual(tickets.nomDuTicket({ username: 'A'.repeat(50) }).length <= 31, true);
});

// ─── claim ───
test('claim : réservé au staff, marque le topic, et fait taire l’assistant pour toujours', async () => {
  decor();
  const env = monde();
  const canal = env.mkCanal('T-CLAIM', { topic: 'otaku-ticket:U1', parentId: 'CAT-T' });
  const refus = env.inter({ channel: canal });
  await tickets.composant({ ...refus, customId: `tik:claim:${canal.id}` });
  assert.match(refus.replies[0].content, /Seuls les membres du staff/);

  // l'assistant tient une session ouverte sur ce salon : le claim doit la clôturer
  const s = { guildId: G, canalId: canal.id, auteurId: 'U1', phase: 'questions', questionIndex: 0, reponses: ['x'], dernierMessageId: null, dernierEnvoi: Date.now(), derniereActivite: Date.now() };
  asst.sessions.set(canal.id, s);
  const staff = env.staff(env.inter({ channel: canal }));
  await tickets.composant({ ...staff, customId: `tik:claim:${canal.id}` });
  assert.match(canal.topic, / · pris:MOD1$/);
  assert.match(staff.replies[0].content, /pris en charge/i);
  assert.strictEqual(asst.CLOS.has(canal.id), true, 'l’assistant doit être marqué clos');
  const brut = stockage.lire('assistant-sessions', {});
  assert.ok(brut[`clos:${canal.id}`], 'la clôture doit survivre au redémarrage');
});

test('claim hors ticket → refus courtois', async () => {
  decor();
  const env = monde();
  const i = env.staff(env.inter({ channel: env.mkCanal('JAMAIS', { topic: '' }) }));
  await tickets.composant({ ...i, customId: 'tik:claim:JAMAIS' });
  assert.match(i.replies[0].content, /n’est pas un ticket/);
});

// ─── fermer ───
test('fermer → demande la raison (modal), puis transcription au salon des logs, puis suppression', async () => {
  decor();
  const msgs = [
    { author: { username: 'alice' }, content: 'bonjour j’ai un souci', embeds: [] },
    { author: { username: 'Modo' }, content: 'on regarde ça', embeds: [] },
  ];
  const env = monde({ messages: msgs });
  const canal = env.mkCanal('T-CLOSE', { topic: 'otaku-ticket:U1 · pris:MOD1', parentId: 'CAT-T', messages: { fetch: async () => ({ values: () => msgs }) } });
  const i = env.staff(env.inter({ channel: canal, customId: `tik:fermer:${canal.id}` }));
  await tickets.composant({ ...i, customId: `tik:fermer:${canal.id}` });
  assert.ok(i.modal, 'le modal de raison doit être demandé');
  assert.strictEqual(i.modal.components[0].components[0].custom_id, 'raison');

  const ferme = env.staff(env.inter({ channel: canal, isModalSubmit: () => true, isButton: () => false, customId: `tik:raison:${canal.id}`, fields: { getTextInputValue: () => 'résolu par MP' } }));
  await tickets.composant(ferme);
  const versLogs = env.sends.find((s) => s.a === 'LOGS-1');
  assert.ok(versLogs, 'la transcription doit partir au salon des logs');
  const json = versLogs.p.embeds[0].toJSON();
  assert.match(json.description, /résolu par MP/);
  assert.match(json.description, /T-CLOSE/);
  assert.ok(json.fields.some((f) => /bonjour j’ai un souci/.test(f.value)), 'l’extrait doit montrer le début de la conversation');
  assert.strictEqual(versLogs.p.components[0].components[0].data.custom_id, 'tik:relancer:U1', 'le bouton “rouvrir” vit dans les logs');
  assert.strictEqual(versLogs.p.files, undefined, 'pas de fichier image, même en transcription');
  await new Promise(setImmediate);
  assert.strictEqual(canal.supprime, true, 'le salon doit être supprimé (délai 0 en test)');
});

test('fermer : le membre concerné a le droit, un tiers non-staff non plus', async () => {
  decor();
  const env = monde();
  const canal = env.mkCanal('T-DROIT', { topic: 'otaku-ticket:U1', parentId: 'CAT-T' });
  const intrus = env.inter({ channel: canal, user: { id: 'U9', username: 'intrus', tag: 'i#1', bot: false }, customId: `tik:fermer:${canal.id}` });
  await tickets.composant(intrus);
  assert.match(intrus.replies[0].content, /Seule la personne concernée/);
  const legit = env.inter({ channel: canal, customId: `tik:fermer:${canal.id}` });
  await tickets.composant(legit);
  assert.ok(legit.modal, 'l’auteur a bien droit au modal de fermeture');
});

// ─── relancer ───
test('bouton “rouvrir” des logs → nouveau salon pour l’auteur, par le staff', async () => {
  decor();
  const env = monde();
  const i = env.staff(env.inter({ customId: 'tik:relancer:U2' }));
  await tickets.composant({ ...i, customId: 'tik:relancer:U2' });
  assert.strictEqual(env.created.length, 1);
  assert.strictEqual(env.created[0].topic, 'otaku-ticket:U2');
  const accueil = env.sends.find((s) => s.a === env.created[0].id);
  assert.match(accueil.p.embeds[0].toJSON().title, /rouvert/);
  const parti = env.staff(env.inter({ customId: 'tik:relancer:404' }));
  const env2 = monde({ parti: '404' });
  const i2 = env2.staff(env2.inter({ customId: 'tik:relancer:404' }));
  await tickets.composant(i2);
  assert.match(i2.replies[0].content, /n’est plus sur le serveur/);
});

// ─── ajouter / retirer ───
test('ajouter / retirer un membre du ticket (jamais l’auteur)', async () => {
  decor();
  const env = monde();
  const canal = env.mkCanal('T-GROUP', { topic: 'otaku-ticket:U1', parentId: 'CAT-T' });
  const i = env.staff(env.inter({ channel: canal }));
  await tickets.ajouter(i, { id: 'AM1' });
  assert.deepStrictEqual(canal.permissionOverwrites.appels[0][0], 'create');
  await tickets.retirer(i, { id: 'AM1' });
  assert.deepStrictEqual(canal.permissionOverwrites.appels[1][0], 'delete');
  await tickets.retirer(i, { id: 'U1' });
  assert.match(i.replies.at(-1).content, /vire pas l’auteur/);
});

// ─── réparer ───
test('reparer : les fantômes (auteur parti) sautent, les vrais restent', async () => {
  decor();
  const env = monde({ parti: 'U9' });
  const fantome = env.mkCanal('T-FANTOME', { topic: 'otaku-ticket:U9', parentId: 'CAT-T' });
  const vrai = env.mkCanal('T-VRAI', { topic: 'otaku-ticket:U1', parentId: 'CAT-T' });
  env.guild.channels.cache.values = () => [fantome, vrai].values();
  const res = await tickets.reparer(env.guild);
  assert.strictEqual(res.supprimes, 1);
  assert.strictEqual(fantome.supprime, true);
  assert.strictEqual(vrai.supprime, undefined);
});

// ─── lien avec l'assistant ───
test('réglages partagés : la catégorie des tickets sert de socle à l’assistant', () => {
  stockage.majReglages(G, {
    assistant: { actif: true, categorie: null, staffRole: null, alerte: null },
    tickets: { actif: true, categorie: 'CAT-T', staffRole: 'R-STAFF', logs: 'LOGS-1' },
  });
  const a = asst.reglagesAssistant(G);
  assert.strictEqual(a.categorie, 'CAT-T', 'la catégorie remonte sans double réglage');
  assert.strictEqual(a.staffRole, 'R-STAFF');
  assert.strictEqual(a.alerte, 'LOGS-1');
  // et si les tickets sont coupés, l'assistant ne doit rien leur emprunter
  stockage.majReglages(G, { tickets: { actif: false } });
  assert.strictEqual(asst.reglagesAssistant(G).categorie, null, 'tickets coupés = pas d’emprunt');
});

// ─── branchement ───
test('interactionCreate route tik: avant les commandes', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'events', 'interactionCreate.js'), 'utf8');
  assert.ok(src.includes("startsWith('tik:')"), 'le routeur tik: doit exister');
  assert.ok(src.indexOf("startsWith('tik:')") < src.indexOf("startsWith('asst:')"), 'tik: avant asst:');
});

test('/tickets : schéma complet et permission staff par défaut', () => {
  const cmd = require('../commands/tickets');
  const json = cmd.data.toJSON();
  assert.strictEqual(json.name, 'tickets');
  const sous = json.options.map((o) => o.name);
  assert.deepStrictEqual(sous, ['setup', 'panneau', 'config', 'ouvrir', 'claim', 'fermer', 'ajouter', 'retirer', 'reparer', 'couper']);
  const { PermissionFlagsBits } = require('discord.js');
  assert.strictEqual(Number(json.default_member_permissions), Number(PermissionFlagsBits.ManageMessages), 'ManageMessages requis par défaut');
});

// ─── formats de panneau : boutons ou menu ───
test('parseTypes : emoji en tête séparé, slug propre, doublons évités', () => {
  const ts = tickets.parseTypes(['😀 Support', '  🤝 Partenariat ', 'Réclamation', 'support']);
  assert.deepStrictEqual(ts.map((t) => t.nom), ['Support', 'Partenariat', 'Réclamation', 'support']);
  assert.strictEqual(ts[0].emoji, '😀');
  assert.strictEqual(ts[2].emoji, null);
  assert.strictEqual(ts[2].slug, 'reclamation', 'accents retirés du slug');
  assert.notStrictEqual(ts[0].slug, ts[3].slug, 'deux « support » ne se marchent pas dessus');
});

test('mode boutons + types → un bouton par type, jusqu’à 5 par rangée', () => {
  decor();
  stockage.majReglages(G, { tickets: { mode: 'bouton', types: ['😀 Support', '🤝 Partenariat', 'A', 'B', 'C', 'D'] } });
  const paquet = tickets.panneauMessage(tickets.reglages(G), 'G');
  assert.strictEqual(paquet.components.length, 2, '6 types → rangées 5 + 1');
  const ids = paquet.components.flatMap((r) => r.components.map((b) => b.data.custom_id));
  assert.deepStrictEqual(ids.slice(0, 2), ['tik:ouvrir:support', 'tik:ouvrir:partenariat']);
  assert.strictEqual(paquet.components[0].components[0].data.emoji.name, '😀');
});

test('mode menu + types → UN menu déroulant « Choisis le type », valeurs = slugs', () => {
  decor();
  stockage.majReglages(G, { tickets: { mode: 'menu', types: ['😀 Support', '🤝 Partenariat'] } });
  const paquet = tickets.panneauMessage(tickets.reglages(G), 'G');
  assert.strictEqual(paquet.components.length, 1);
  const sel = paquet.components[0].components[0].toJSON();
  assert.strictEqual(sel.type, 3, 'un StringSelect');
  assert.strictEqual(sel.custom_id, 'tik:type');
  assert.deepStrictEqual(sel.options.map((o) => o.value), ['support', 'partenariat']);
});

test('mode menu sans types → retombe sur le bouton unique (jamais un menu vide)', () => {
  decor();
  stockage.majReglages(G, { tickets: { mode: 'menu', types: [] } });
  const paquet = tickets.panneauMessage(tickets.reglages(G), 'G');
  assert.strictEqual(paquet.components[0].components[0].toJSON().type, 2, 'un bouton');
  assert.strictEqual(paquet.components[0].components[0].toJSON().custom_id, 'tik:ouvrir');
});

test('clic sur un type (bouton ou menu) → le motif vit dans le topic et le titre', async () => {
  decor();
  stockage.majReglages(G, { tickets: { mode: 'menu', types: ['😀 Support', '🤝 Partenariat'] } });
  const env = monde();
  const i = env.inter({ isStringSelectMenu: () => true, isButton: () => false, values: ['partenariat'] });
  await tickets.composant({ ...i, customId: 'tik:type' });
  assert.strictEqual(env.created.length, 1);
  assert.strictEqual(env.created[0].topic, 'otaku-ticket:U1 · type:Partenariat');
  const accueil = env.sends.find((s) => s.a === env.created[0].id);
  assert.match(accueil.p.embeds[0].toJSON().title, /Partenariat/);
  assert.strictEqual(tickets.typeDe(env.created[0]), 'Partenariat');
});

test('bouton-type « tik:ouvrir:support » ouvre le même ticket marqué du motif', async () => {
  decor();
  stockage.majReglages(G, { tickets: { mode: 'bouton', types: ['😀 Support'] } });
  const env = monde();
  const i = env.inter();
  await tickets.composant({ ...i, customId: 'tik:ouvrir:support' });
  assert.strictEqual(env.created[0].topic, 'otaku-ticket:U1 · type:Support');
});

// ─── /config rubrique tickets ───
// ─── l'assistant /config : menus qui s'enchaînent (façon One Assist) ───
async function tikCfg(props) {
  const configCmd = require('../commands/config');
  const inter = {
    guildId: G, inGuild: () => true,
    isStringSelectMenu: () => Array.isArray(props.values),
    isModalSubmit: () => Boolean(props.fields),
    isButton: () => false, isChannelSelectMenu: () => false, isUserSelectMenu: () => false,
    member: { permissions: { has: () => true } },
    update: async (p) => { inter.last = p; }, reply: async (p) => { inter.last = p; },
    showModal: async (m) => { inter.modal = m.toJSON(); },
    ...props,
    fields: props.fields ? { getTextInputValue: (k) => props.fields[k] || '' } : undefined,
  };
  await configCmd.composant(inter);
  return inter;
}

test('étape 1 : la rubrique ouvre sur le choix Ticket Bouton / Ticket Menu, rien d\u2019autre', () => {
  const configCmd = require('../commands/config');
  stockage.majReglages(G, { tickets: { mode: null } });
  const carte = configCmd.carteRubrique(G, 'tickets', 'C1', null);
  assert.deepStrictEqual(carte.components.map((r) => r.toJSON().components[0].custom_id), ['cfg:tikw:mode', 'cfg:racine']);
  assert.deepStrictEqual(carte.components[0].toJSON().components[0].options.map((o) => o.value), ['bouton', 'menu']);
});

test('étape 2 : le style choisi fait apparaître le menu des actions', async () => {
  const configCmd = require('../commands/config');
  stockage.majReglages(G, { tickets: { mode: null } });
  const i = await tikCfg({ customId: 'cfg:tikw:mode', values: ['menu'], update: async () => {} });
  assert.strictEqual(stockage.reglages(G).tickets.mode, 'menu', 'le choix du style est enregistré');
  const carte = configCmd.carteRubrique(G, 'tickets', 'C1', null);
  assert.deepStrictEqual(carte.components.map((r) => r.toJSON().components[0].custom_id), ['cfg:tikw:mode', 'cfg:tikw:action', 'cfg:racine'], 'le menu des actions est apparu sous le choix');
  assert.deepStrictEqual(carte.components[1].toJSON().components[0].options.map((o) => o.value),
    ['nouveau', 'supprimer', 'textes', 'reset', 'finir']);
});

test('➕ Créer un nouveau bouton : la fenêtre s\u2019ouvre, le bouton est créé, on revient au menu', async () => {
  stockage.majReglages(G, { tickets: { mode: 'bouton', types: [] } });
  const a = await tikCfg({ customId: 'cfg:tikw:action', values: ['nouveau'] });
  assert.strictEqual(a.modal.custom_id, 'cfg:tikw:btn-modal');
  const champs = a.modal.components.map((r) => r.components[0]);
  assert.deepStrictEqual(champs.map((c) => c.custom_id), ['nom', 'emoji', 'desc']);
  assert.strictEqual(champs[0].required, true, 'le nom est obligatoire');

  await tikCfg({ customId: 'cfg:tikw:btn-modal', fields: { nom: '  Partenariat ', emoji: '🤝', desc: 'devenir partenaire' } });
  assert.deepStrictEqual(stockage.reglages(G).tickets.types, [{ nom: 'Partenariat', emoji: '🤝', desc: 'devenir partenaire' }]);

  await tikCfg({ customId: 'cfg:tikw:btn-modal', fields: { nom: 'Réclamation' } });
  assert.strictEqual(stockage.reglages(G).tickets.types[1].emoji, null, 'sans emoji, pas de emoji');

  // six max
  for (const x of ['a', 'b', 'c', 'd', 'e']) await tikCfg({ customId: 'cfg:tikw:btn-modal', fields: { nom: x } });
  assert.strictEqual(stockage.reglages(G).tickets.types.length, 6, 'le 7e doit être refusé');
  const plein = await tikCfg({ customId: 'cfg:tikw:action', values: ['nouveau'] });
  assert.match(plein.last.embeds[0].toJSON().description, /Déjà 6 boutons/);
});

test('🗑️ Supprimer un bouton : on le choisit dans la liste, il part, retour propre', async () => {
  stockage.majReglages(G, { tickets: { mode: 'bouton', types: [{ nom: 'Support', emoji: '😀', desc: 'technique' }, { nom: 'Partenariat' }] } });
  const a = await tikCfg({ customId: 'cfg:tikw:action', values: ['supprimer'] });
  const ids = a.last.components.map((r) => r.toJSON().components[0].custom_id);
  assert.deepStrictEqual(ids, ['cfg:tikw:btn-del', 'cfg:tikw:back']);
  const opts = a.last.components[0].toJSON().components[0].options;
  assert.deepStrictEqual(opts.map((o) => o.value), ['0', '1']);
  assert.strictEqual(opts[0].emoji.name, '😀');
  await tikCfg({ customId: 'cfg:tikw:btn-del', values: ['0'] });
  const reste = stockage.reglages(G).tickets.types;
  assert.strictEqual(reste.length, 1, 'un seul bouton survit');
  assert.strictEqual(reste[0].nom, 'Partenariat', 'c’est bien celui-là qui reste');
});

test('✏️ Modifier le panneau : la fenêtre, puis envoi direct dans le salon réglé — sans image', async () => {
  const sent = [];
  stockage.majReglages(G, { tickets: { actif: false, mode: 'menu', types: [{ nom: 'Support', desc: 'un souci technique' }], panneau: 'P-9', titre: null, texte: null } });
  const a = await tikCfg({ customId: 'cfg:tikw:action', values: ['textes'] });
  assert.strictEqual(a.modal.custom_id, 'cfg:tikw:pan-modal');
  const guild = { name: 'G', channels: { fetch: async () => ({ id: 'P-9', send: async (p) => sent.push(p) }) } };
  await tikCfg({ customId: 'cfg:tikw:pan-modal', guild, fields: { titre: 'Le Comptoir', texte: 'Viens comme tu es.' } });
  const t = stockage.reglages(G).tickets;
  assert.strictEqual(t.titre, 'Le Comptoir');
  assert.strictEqual(t.texte, 'Viens comme tu es.', 'les deux champs sont enregistrés');
  assert.strictEqual(sent.length, 1, 'le panneau est parti direct');
  assert.strictEqual(sent[0].files, undefined, 'toujours zéro image');
  const sel = sent[0].components[0].toJSON().components[0];
  assert.strictEqual(sel.options[0].description, 'un souci technique', 'la description du bouton vit sous le choix du menu');
  assert.strictEqual(t.actif, true, 'terminer/publier active les tickets');
});

test('🧹 Réinitialiser les textes et ✅ Terminer (sans salon → guidage, pas de crash)', async () => {
  stockage.majReglages(G, { tickets: { titre: 'X', texte: 'Y' } });
  await tikCfg({ customId: 'cfg:tikw:action', values: ['reset'] });
  assert.strictEqual(stockage.reglages(G).tickets.titre, null);
  stockage.majReglages(G, { tickets: { panneau: null, actif: false } });
  const f = await tikCfg({ customId: 'cfg:tikw:action', values: ['finir'], guild: { name: 'G', channels: { fetch: async () => null } } });
  assert.match(f.last.embeds[0].toJSON().description, /Aucun salon de panneau/, 'Terminer doit guider, pas planter');
  assert.strictEqual(stockage.reglages(G).tickets.actif, false, 'sans envoi possible, on n’active pas');
});

// ─── exécution ───
(async () => {
  let reussis = 0;
  const echecs = [];
  for (const c of cas) {
    try { await c.fn(); reussis++; console.log('  ✅ ' + c.nom); }
    catch (e) { echecs.push(c.nom); console.log('  ❌ ' + c.nom + ' → ' + String(e.message).split('\n').slice(0,4).join(' | ')); }
  }
  console.log(`\ntickets : ${reussis}/${cas.length}${echecs.length ? ` — ${echecs.length} ÉCHEC(S)` : ' OK ✅'}`);
  process.exit(echecs.length ? 1 : 0);
})();
