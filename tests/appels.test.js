/**
 * tests/appels.test.js — « ota, appelle Jordan » : la transmission polie de ping.
 */
const assert = require('assert');
const { membreMock, guildeMock, salonMock } = require('./aide');
const appels = require('../utils/appels');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function membre(nom, id) {
  return membreMock({ id, tag: `${nom}#0000` });
}

/** Faux message de membre adressé (ou non) à Otaku, avec les membres du serveur en cache. */
function messageAppel({ contenu = '', id = 'dem1', tag = 'Demanda#0001', membres = [] } = {}) {
  const guilde = guildeMock({ id: 'G-APP' });
  const salon = salonMock({ id: 'C-APP' });
  const cache = new Map([['bot', membreMock({ id: 'bot', tag: 'Otaku#0001', bot: true })]]);
  membres.forEach((m, i) => cache.set(m.id || `x${i}`, m));
  guilde.members.cache = cache;
  const auteur = membreMock({ id, tag });
  return {
    content: contenu,
    guild: guilde,
    channel: salon,
    member: auteur,
    author: { id, tag, username: tag.split('#')[0], bot: false },
    mentions: { has: () => false },
    async reply(paquet) { this.channel.messagesEnvoyes.push(paquet); return { id: 'rep' }; },
  };
}

function selectFactice({ customId, values = [], userId = 'dem1', channel }) {
  return {
    customId,
    guildId: 'G-APP',
    channelId: 'C-APP',
    values,
    user: { id: userId },
    channel,
    isMessageComponent: () => true,
    isStringSelectMenu: () => customId === 'app:sel',
    isButton: () => customId === 'app:x',
    journal: [],
    async reply(p) { this.journal.push(['reply', p]); return {}; },
    async update(p) { this.journal.push(['update', p]); return {}; },
  };
}

const texteDe = (envoye) => {
  if (typeof envoye === 'string') return envoye;
  if (envoye?.content) return envoye.content;
  const d = envoye?.embeds?.[0]?.data?.description || '';
  return d;
};

// ─────────── détection et recherche ───────────
test('détection : les tournures naturelles déclenchent, le reste non', () => {
  assert.strictEqual(appels.detecterAppel('ota tu peux appeler jordans'), 'jordans');
  assert.strictEqual(appels.detecterAppel('<@999> appelle Jordan stp'), 'Jordan');
  assert.strictEqual(appels.detecterAppel('coucou ota, fais venir Léa s\'il te plaît'), 'Léa');
  assert.strictEqual(appels.detecterAppel('comment ça va ?'), null);
  assert.strictEqual(appels.detecterAppel('ota'), null);
});

test('normalisation : accents, casse et tirets ne comptent pas', () => {
  assert.strictEqual(appels.normaliser('Jòrdàn'), 'jordan');
  assert.strictEqual(appels.normaliser('Jean-Pierre'), 'jeanpierre');
});

test('recherche : trouve les homonymes, ignore les bots', () => {
  const m = messageAppel({ membres: [membre('Jordan', 'j1'), membre('Jordàn', 'j2'), membre('Jordanne', 'j3'), membre('Alice', 'a1')] });
  const trouv = appels.chercheMembres(m.guild, 'jordans');
  assert.deepStrictEqual(trouv.map((x) => x.id).sort(), ['j1', 'j2', 'j3']);
  assert.ok(!trouv.some((x) => x.id === 'bot'), 'le bot ne doit jamais être appelé');
  assert.strictEqual(appels.chercheMembres(m.guild, 'Zorro').length, 0);
});

test('la raison est nettoyée : pas de @everyone, pas de ping caché, 250 caractères max', () => {
  const propre = appels.nettoyerRaison('faut qu\'on parle @everyone <@12345> <#999> ' + 'a'.repeat(400));
  assert.ok(!propre.includes('@everyone'));
  assert.ok(!propre.includes('<@12345>'));
  assert.ok(!propre.includes('<#999>'));
  assert.ok(propre.length <= 250);
});

// ─────────── le parcours complet ───────────
test('flow simple : demande → raison → ping unique dans le salon', async () => {
  appels.viderEtats();
  const lea = membre('Léa', 'l1');
  const m1 = messageAppel({ contenu: 'oTa, appelle Léa', membres: [lea] });
  const ok1 = await appels.traiterMessage(m1, {}, { interpele: true });
  assert.ok(ok1, 'la demande doit être consommée');
  assert.ok(texteDe(m1.channel.messagesEnvoyes.at(-1)).includes('Pour quelle raison'), 'la raison doit être demandée');

  const m2 = messageAppel({ contenu: 'j\'ai besoin d\'un coup de main pour mon salon vocal', membres: [lea] });
  m2.channel = m1.channel; // même salon : la suite du rendez-vous
  const ok2 = await appels.traiterMessage(m2, {}, { interpele: false });
  assert.ok(ok2, 'la raison doit être consommée');
  const ping = m2.channel.messagesEnvoyes.at(-1);
  assert.ok(ping.content.includes('<@l1>'), 'le ping de Léa doit partir dans le salon');
  assert.ok(ping.content.includes('salon vocal'), 'la raison doit être transmise');
  assert.strictEqual(appels.ETATS.size, 0, 'plus d\'attente après l\'appel');
});

test('plusieurs homonymes → menu privé, puis choix et ping', async () => {
  appels.viderEtats();
  const jords = [membre('Jordan', 'j1'), membre('Jordanne', 'j2'), membre('Jordane', 'j3')];
  const m1 = messageAppel({ contenu: 'ota appelle Jordan', membres: jords });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'il me doit 5 euros', membres: jords });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });

  const menuEnvoi = m2.channel.messagesEnvoyes.at(-1);
  assert.ok(menuEnvoi.components?.length >= 1, 'un menu doit être proposé');
  const menuJson = menuEnvoi.components[0].toJSON();
  const options = menuJson.components[0].options.map((o) => o.value);
  assert.deepStrictEqual(options.sort(), ['j1', 'j2', 'j3']);

  const sel = selectFactice({ customId: 'app:sel', values: ['j2'], channel: m1.channel });
  const pris = await appels.traiterBouton(sel);
  assert.ok(pris);
  const ping = m1.channel.messagesEnvoyes.at(-1);
  assert.ok(ping.content.includes('<@j2>'), 'le choix doit être pingué');
  assert.ok(sel.journal.some(([t]) => t === 'update'), 'le menu privé doit se mettre à jour');
  assert.strictEqual(appels.ETATS.size, 0);
});

test('« annuler » met fin à l\'attente', async () => {
  appels.viderEtats();
  const lea = membre('Léa', 'l1');
  const m1 = messageAppel({ contenu: 'ota appelle Léa', membres: [lea] });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'annuler', membres: [lea] });
  m2.channel = m1.channel;
  const ok = await appels.traiterMessage(m2, {}, { interpele: false });
  assert.ok(ok);
  assert.ok(texteDe(m2.channel.messagesEnvoyes.at(-1)).includes('annulé'));
  assert.strictEqual(appels.ETATS.size, 0);
});

test('personne de trouvé → message clair et attente fermée', async () => {
  appels.viderEtats();
  const m1 = messageAppel({ contenu: 'ota appelle Zorro', membres: [membre('Alice', 'a1')] });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'besoin d\'un avis rapide', membres: [membre('Alice', 'a1')] });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });
  assert.ok(texteDe(m2.channel.messagesEnvoyes.at(-1)).includes('Personne sur ce serveur'));
  assert.strictEqual(appels.ETATS.size, 0);
});

test('se rappeler soi-même → refus souriant', async () => {
  appels.viderEtats();
  const m1 = messageAppel({ contenu: 'ota, appelle Demanda', membres: [], id: 'dem1', tag: 'Demanda#0001' });
  // l'auteur n'est pas dans le cache par défaut : on l'y ajoute
  m1.guild.members.cache.set('dem1', m1.member);
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'pour me parler à moi-même', membres: [] });
  m2.channel = m1.channel;
  m2.guild.members.cache = m1.guild.members.cache;
  await appels.traiterMessage(m2, {}, { interpele: false });
  assert.ok(texteDe(m1.channel.messagesEnvoyes.at(-1)).includes('c’est **toi**'));
});

test('raison trop courte → on redemande, sans effacer l\'attente', async () => {
  appels.viderEtats();
  const lea = membre('Léa', 'l1');
  const m1 = messageAppel({ contenu: 'ota appelle Léa', membres: [lea] });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'ok', membres: [lea] });
  m2.channel = m1.channel;
  const ok = await appels.traiterMessage(m2, {}, { interpele: false });
  assert.ok(ok);
  assert.ok(texteDe(m2.channel.messagesEnvoyes.at(-1)).includes('raison courte'));
  assert.strictEqual(appels.ETATS.size, 1, 'l\'attente reste ouverte');
  appels.viderEtats();
});

test('réglage coupé → plus d\'appels du tout', async () => {
  appels.viderEtats();
  const m1 = messageAppel({ contenu: 'ota appelle Léa', membres: [membre('Léa', 'l1')] });
  const ok = await appels.traiterMessage(m1, { appels: false }, { interpele: true });
  assert.strictEqual(ok, false);
  assert.strictEqual(m1.channel.messagesEnvoyes.length, 0);
});

test('anti-spam : deux demandes de suite dans le même salon → pause', async () => {
  appels.viderEtats();
  const lea = membre('Léa', 'l1');
  const m1 = messageAppel({ contenu: 'ota appelle Léa', membres: [lea] });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'annuler', membres: [lea] });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });
  const m3 = messageAppel({ contenu: 'ota, appelle Léa', membres: [lea] });
  m3.channel = m1.channel;
  const ok = await appels.traiterMessage(m3, {}, { interpele: true });
  assert.ok(ok, 'la seconde demande est consommée pour être refusée poliment');
  assert.ok(texteDe(m1.channel.messagesEnvoyes.at(-1)).includes('Un appel vient déjà'), 'message de pause attendu');
});

test('choix par un autre membre que le demandeur → refus poli', async () => {
  appels.viderEtats();
  const jords = [membre('Jordan', 'j1'), membre('Jordanne', 'j2')];
  const m1 = messageAppel({ contenu: 'ota appelle Jordan', membres: jords });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'besoin de parler', membres: jords });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });
  const sel = selectFactice({ customId: 'app:sel', values: ['j1'], userId: 'curieux9', channel: m1.channel });
  await appels.traiterBouton(sel);
  const refus = sel.journal.find(([t]) => t === 'reply');
  assert.ok(refus, 'un refus doit être affiché en privé');
  assert.ok(refus[1].embeds[0].toJSON().description.includes('Seul celui qui demande'));
  assert.ok(!m1.channel.messagesEnvoyes.some((e) => (e.content || '').includes('<@j1>')), 'aucun ping ne part');
  appels.viderEtats();
});

test('menu périmé (attente expirée) → mise à jour claire, zéro crash', async () => {
  appels.viderEtats();
  const sel = selectFactice({ customId: 'app:sel', values: ['j9'], channel: salonMock() });
  const pris = await appels.traiterBouton(sel);
  assert.ok(pris);
  assert.ok(sel.journal.some(([t]) => t === 'update'));
});

test('bouton annuler du menu → ferme tout', async () => {
  appels.viderEtats();
  const jords = [membre('Jordan', 'j1'), membre('Jordanne', 'j2')];
  const m1 = messageAppel({ contenu: 'ota appelle Jordan', membres: jords });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'besoin de parler', membres: jords });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });
  const bouton = selectFactice({ customId: 'app:x', channel: m1.channel });
  const pris = await appels.traiterBouton(bouton);
  assert.ok(pris);
  assert.strictEqual(appels.ETATS.size, 0);
});

test('message pendant l\'attente du menu → rendu au reste du chat', async () => {
  appels.viderEtats();
  const jords = [membre('Jordan', 'j1'), membre('Jordanne', 'j2')];
  const m1 = messageAppel({ contenu: 'ota appelle Jordan', membres: jords });
  await appels.traiterMessage(m1, {}, { interpele: true });
  const m2 = messageAppel({ contenu: 'la raison est simple', membres: jords });
  m2.channel = m1.channel;
  await appels.traiterMessage(m2, {}, { interpele: false });
  const m3 = messageAppel({ contenu: 'au fait quelqu\'un a vu mon casque ?', membres: jords });
  m3.channel = m1.channel;
  const ok = await appels.traiterMessage(m3, {}, { interpele: false });
  assert.strictEqual(ok, false, 'ce message n\'est pas pour les appels');
  appels.viderEtats();
});

module.exports = { nom: 'appels', cas };

if (require.main === module) require('./executeur')(module.exports);
