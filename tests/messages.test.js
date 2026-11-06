const assert = require('assert');
const { membreMock, guildeMock, salonMock } = require('./aide');
const stockage = require('../utils/stockage');

// On remplace l'appel réseau de l'IA avant de charger l'événement.
const ia = require('../utils/ia');
let reponseIA = 'Réponse de test.';
let appelIA = 0;
ia.demander = async () => {
  appelIA += 1;
  return { texte: reponseIA, fournisseur: 'gemini', essais: [] };
};

const messageCreate = require('../events/messageCreate');
const guildMemberAdd = require('../events/guildMemberAdd');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function messageFactice({ contenu = 'bonjour', id = 'u1', estBot = false, staff = false, guildId = 'G-MSG' } = {}) {
  const guilde = guildeMock({ id: guildId, nom: 'Serveur Messages' });
  const salon = salonMock({ id: 'C-MSG' });
  const auteur = membreMock({ id, tag: `Membre${id}#0001`, permissions: staff ? ['ManageMessages'] : [] });
  const supprimes = [];
  return {
    id: 'm1',
    content: contenu,
    guild: guilde,
    channel: salon,
    member: auteur,
    author: auteur.user,
    mentions: { has: (bit) => contenu.includes(`<@${bit}>`) },
    supprime: false,
    async delete() { supprimes.push(true); this.supprime = true; },
    async reply(paquet) { salon.messagesEnvoyes.push(paquet); return { id: 'rep' }; },
    supprimes,
  };
}

const client = { user: { id: 'bot-id' }, commands: new Map() };

test('message normal : rien ne se passe', async () => {
  const message = messageFactice({ contenu: 'salut tout le monde' });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, false);
  assert.strictEqual(message.channel.messagesEnvoyes.length, 0);
});

test('message d\'un bot : totalement ignoré', async () => {
  const message = messageFactice({ contenu: 'discord.gg/raid', estBot: true });
  message.author.bot = true;
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, false);
});

test('invitation Discord : message supprimé + explication', async () => {
  const message = messageFactice({ contenu: 'rejoins discord.gg/pasbien' });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, true);
  const envoi = message.channel.messagesEnvoyes[0];
  assert.ok(/Message supprimé/.test(JSON.stringify(envoi.toJSON ? envoi.toJSON() : envoi)));
});

test('insulte : message supprimé', async () => {
  const message = messageFactice({ contenu: 'ta gueule' });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, true);
});

test('le staff n\'est pas filtré par l\'auto-mod', async () => {
  const message = messageFactice({ contenu: 'discord.gg/partage-officiel', staff: true });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, false);
});

test('un salon exempté n\'est pas filtré', async () => {
  const message = messageFactice({ contenu: 'discord.gg/libre', guildId: 'G-EXEMPT' });
  stockage.majReglages('G-EXEMPT', { automod: { salonExempt: 'C-MSG' } });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, false);
});

test('mention du bot sans question : message d\'accueil', async () => {
  const message = messageFactice({ contenu: '<@bot-id>' });
  await messageCreate.executer(client, message);
  assert.ok(message.channel.messagesEnvoyes.length >= 1);
});

test('mention suivie d\'une question : l\'IA répond', async () => {
  const avant = appelIA;
  const message = messageFactice({ contenu: '<@bot-id> c\'est quoi un webhook ?', id: 'u-ia-1', guildId: 'G-IA' });
  await messageCreate.executer(client, message);
  assert.strictEqual(appelIA, avant + 1);
  // La réponse doit être dans une CARTE propre (embed), pas en texte brut.
  const paquet = message.channel.messagesEnvoyes[0];
  const carte = paquet.embeds?.[0];
  assert.ok(carte, 'la réponse IA doit être dans une carte (embed)');
  const texte = carte.data ? carte.data.description : carte.description;
  assert.strictEqual(texte, 'Réponse de test.');
  const pied = carte.data ? carte.data.footer : carte.footer;
  assert.ok(!pied, 'aucun tag ne doit apparaître sous la carte');
});

test('une très longue réponse IA est découpée', async () => {
  const message = messageFactice({ contenu: '<@bot-id> raconte-moi long', id: 'u-ia-2', guildId: 'G-IA2' });
  reponseIA = 'phrase très longue '.repeat(150);
  await messageCreate.executer(client, message);
  assert.ok(message.channel.messagesEnvoyes.length >= 2, 'la réponse n\'a pas été découpée');
  reponseIA = 'Réponse de test.';
});

test('l\'IA en panne ne fait pas planter le bot', async () => {
  const sauvegarde = ia.demander;
  ia.demander = async () => { throw new ia.ErreurIA('panne', {}); };
  const message = messageFactice({ contenu: '<@bot-id> tu es là ?', id: 'u-ia-3', guildId: 'G-IA3' });
  await messageCreate.executer(client, message);
  ia.demander = sauvegarde;
  const envoi = message.channel.messagesEnvoyes[0];
  const texte = JSON.stringify(envoi.toJSON ? envoi.toJSON() : envoi);
  assert.ok(/Panne temporaire|fournisseurs/.test(texte), texte);
});

test('bienvenue : message envoyé avec les variables remplacées', async () => {
  const guilde = guildeMock({ id: 'G-BIENV', nom: 'Otaku Land' });
  const salon = salonMock({ id: 'S-BIENV' });
  guilde.salonsDeTest.set('S-BIENV', salon);
  stockage.majReglages('G-BIENV', { bienvenue: { salon: 'S-BIENV', message: 'Bienvenue {membre} sur {serveur} ! Tu es le {nombre}e.' } });

  const membre = membreMock({ id: 'nouveau1' });
  membre.guild = guilde;
  await guildMemberAdd.executer(client, membre);

  // Comportement actuel : la CARTE-IMAGE prime (PNG joint + mention ping).
  const paquet = salon.messagesEnvoyes[0] || {};
  assert.ok(paquet.files?.length, 'aucune image de bienvenue envoyée');
  assert.ok(String(paquet.content).includes('<@nouveau1>'), 'le nouveau doit être pingué sur l\'image');
  const binaire = paquet.files[0].attachment;
  assert.ok(Buffer.isBuffer(binaire) && binaire[0] === 0x89, 'le fichier doit être un PNG');
});

test('bienvenue : si l\'image ne peut pas être générée → carte texte en repli', async () => {
  const bienvenueImage = require('../utils/bienvenue-image');
  const original = bienvenueImage.generer;
  bienvenueImage.generer = async () => { throw new Error('canvas indisponible'); };
  try {
    const guilde = guildeMock({ id: 'G-BIENV2', nom: 'Otaku Land' });
    const salon = salonMock({ id: 'S-BIENV2' });
    guilde.salonsDeTest.set('S-BIENV2', salon);
    stockage.majReglages('G-BIENV2', { bienvenue: { salon: 'S-BIENV2', message: 'Bienvenue {membre} sur {serveur} !' } });
    const membre = membreMock({ id: 'nouveau9' });
    membre.guild = guilde;
    await guildMemberAdd.executer(client, membre);
    const paquet = salon.messagesEnvoyes[0] || {};
    assert.ok(paquet.embeds?.length, 'la carte texte de repli doit partir');
    const json = paquet.embeds[0].toJSON();
    assert.ok(json.title.includes('Otaku Land'));
    assert.ok(!json.footer, 'aucun tag sous la carte');
  } finally {
    bienvenueImage.generer = original;
  }
});

test('bienvenue désactivée : aucun message', async () => {
  const guilde = guildeMock({ id: 'G-SANS' });
  const membre = membreMock({ id: 'nouveau2' });
  membre.guild = guilde;
  await guildMemberAdd.executer(client, membre);
  assert.strictEqual(guilde.salonsDeTest.size, 0);
});

test('insulte : avertissement auto enregistré, MP envoyé, et sourdine au seuil réglé', async () => {
  const G = 'G-AUTO-SANCT';
  stockage.majReglages(G, { automod: { insultes: true, sanctionAuto: true, seuilAvert: 2, dureeSanction: 30 } });
  const avant = stockage.avertissements(G, 'u-sanct').length;   // la liste peut déjà porter des runs précédents
  const message = messageFactice({ contenu: 'sale connasse', guildId: G, id: 'u-sanct' });
  message.member = membreMock({ id: 'u-sanct', tag: 'Sanct#0001', permissions: [], sendEchoue: false });
  await messageCreate.executer(client, message);
  assert.strictEqual(message.supprime, true, 'le message est retiré');
  assert.strictEqual(stockage.avertissements(G, 'u-sanct').length, avant + 1, "l'avertissement automatique s'ajoute à la liste du membre");
  const mp = message.member.actions.find((x) => x[0] === 'mp');
  assert.ok(mp, 'la personne est prévenue en MP quand elle les accepte');
  assert.ok(/avertissement/i.test(JSON.stringify(mp[1])), JSON.stringify(mp[1]));
  const timeout = message.member.actions.find((x) => x[0] === 'timeout');
  assert.ok(timeout, 'le seuil (2) est atteint → sourdine automatique');
  assert.strictEqual(timeout[1], 30 * 60000, 'la durée vient du réglage du panneau');
});

test('rafale d\u2019insultes : chaque retrait compte, un seul MP sur la fenêtre de 5 min', async () => {
  const G = 'G-AUTO-RAFALE';
  stockage.majReglages(G, { automod: { insultes: true, sanctionAuto: false } });
  const id = 'u-rafale-' + Date.now();
  const avant = stockage.avertissements(G, id).length;
  const m1 = messageFactice({ contenu: 'connard', guildId: G, id });
  m1.member = membreMock({ id, tag: 'Rale#0001', permissions: [], sendEchoue: false });
  await messageCreate.executer(client, m1);
  const m2 = messageFactice({ contenu: 'connards', guildId: G, id });
  m2.member = m1.member;
  await messageCreate.executer(client, m2);
  assert.strictEqual(m1.supprime, true);
  assert.strictEqual(m2.supprime, true);
  assert.strictEqual(stockage.avertissements(G, id).length, avant + 2, 'les deux retraits sont comptés');
  const mps = m1.member.actions.filter((x) => x[0] === 'mp').length;
  assert.strictEqual(mps, 1, 'un seul MP sur la fenêtre anti-spam');
});

test('MP impossible : le bot le dit dans la note au lieu de le taire', async () => {
  const G = 'G-AUTO-MPKO';
  stockage.majReglages(G, { automod: { insultes: true, sanctionAuto: false } });
  const id = 'u-mpko-' + Date.now();
  const m = messageFactice({ contenu: 'sale pute', guildId: G, id });
  m.member = membreMock({ id, tag: 'Ko#0001', permissions: [] });   // MP fermés par défaut du mock
  await messageCreate.executer(client, m);
  const note = m.channel.messagesEnvoyes.at(-1);
  assert.ok(/MP/.test(JSON.stringify(note)), JSON.stringify(note).slice(0, 300));
});

module.exports = { nom: 'messages', cas };
if (require.main === module) require('./executeur')(module.exports);
