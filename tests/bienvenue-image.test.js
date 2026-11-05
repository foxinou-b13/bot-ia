/**
 * tests/bienvenue-image.test.js — générateur de la carte-image + réglages du panneau.
 */
const assert = require('assert');
const { createCanvas } = require('@napi-rs/canvas');
const img = require('../utils/bienvenue-image');
const { membreMock, guildeMock, salonMock } = require('./aide');
const stockage = require('../utils/stockage');
const { chargerCommandes } = require('../utils/commandes');

const config = chargerCommandes().commandes.get('config');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function fauxAvatar(couleur = '#e8a33d') {
  const c = createCanvas(256, 256); const x = c.getContext('2d');
  x.fillStyle = couleur; x.fillRect(0, 0, 256, 256);
  return c.toBuffer('image/png');
}

test('langue : français par défaut, anglais sur demande', () => {
  assert.strictEqual(img.construireTextes('fr').titre, 'BIENVENUE');
  assert.strictEqual(img.construireTextes('en').titre, 'WELCOME');
  assert.strictEqual(img.construireTextes('spécial!').titre, 'BIENVENUE');
});

test('URL du fond : http(s) accepté, vide = dégradé, le reste refusé', () => {
  assert.deepStrictEqual(img.validerUrlFond('https://cdn.discordapp.com/a.png'), { ok: true, valeur: 'https://cdn.discordapp.com/a.png' });
  assert.deepStrictEqual(img.validerUrlFond(''), { ok: true, valeur: null });
  assert.strictEqual(img.validerUrlFond('ftp://x/y').ok, false);
  assert.strictEqual(img.validerUrlFond('https://localhost/x.png').ok, false);
  assert.strictEqual(img.validerUrlFond('pas une url').ok, false);
});

test('composition : PNG valide, avec avatar', async () => {
  const png = await img.composer({ avatarBuffer: fauxAvatar(), pseudo: 'Nina', langue: 'fr', serveur: 'T' });
  assert.ok(Buffer.isBuffer(png) && png[0] === 0x89, 'pas un PNG');
  assert.ok(png.length > 5000, 'PNG suspect (trop petit)');
});

test('composition : pseudo interminable → l\'image se génère (texte réduit)', async () => {
  const png = await img.composer({ pseudo: 'A'.repeat(80), langue: 'en' });
  assert.ok(png[0] === 0x89);
});

test('composition : avatar illisible → initiale dessinée, pas de crash', async () => {
  const png = await img.composer({ avatarBuffer: Buffer.from('ceci n\'est pas une image'), pseudo: 'Zoe' });
  assert.ok(png[0] === 0x89);
});

test('generer() : fond injoignable → dégradé maison, aucune exception', async () => {
  const png = await img.generer({
    fondUrl: 'https://exemple-inexistant-otaku.invalid/x.png',
    pseudo: 'Fox', langue: 'fr',
    fetchImpl: async () => { throw new Error('réseau KO'); },
  });
  assert.ok(png[0] === 0x89);
});

// ─── réglages dans /config ───
function selecteur(customId, extra = {}) {
  return Object.assign({
    customId, guildId: 'G-BI', channelId: 'C1',
    isStringSelectMenu: () => false, isChannelSelectMenu: () => false,
    isRoleSelectMenu: () => false, isButton: () => false, isModalSubmit: () => false,
    inGuild: () => true, replied: false, deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u', tag: 'S#1' }, journal: [],
    async update(p) { this.journal.push(['update', p]); },
    async reply(p) { this.journal.push(['reply', p]); },
  }, extra);
}

test('panneau accueil : menu langue enregistré', async () => {
  const inter = selecteur('cfg:accueil:langue', { isStringSelectMenu: () => true, values: ['en'] });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages('G-BI').bienvenue.langue, 'en');
});

test('panneau accueil : le bouton « image perso » ouvre un formulaire, l\'URL est validée', async () => {
  const interBouton = selecteur('cfg:accueil:fond-url', { isButton: () => true, async showModal(m) { this.modalVu = m; } });
  await config.composant(interBouton);
  assert.ok(interBouton.modalVu, 'le formulaire ne s\'ouvre pas');

  const interEnvoi = selecteur('cfg:accueil:fond-modal', {
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => 'https://cdn.discordapp.com/fond.png' },
  });
  await config.composant(interEnvoi);
  assert.strictEqual(stockage.reglages('G-BI').bienvenue.fond, 'https://cdn.discordapp.com/fond.png');

  // URL douteuse → refus propre + retour au dégradé
  const interMauvaise = selecteur('cfg:accueil:fond-modal', {
    isModalSubmit: () => true,
    fields: { getTextInputValue: () => 'javascript:alert(1)' },
  });
  await config.composant(interMauvaise);
  assert.strictEqual(stockage.reglages('G-BI').bienvenue.fond, null);
});

test('la carte rubrique accueil annonce la langue et le fond choisis', () => {
  stockage.majReglages('G-BI', { bienvenue: { salon: 'S1', langue: 'en', fond: 'https://x/y.png' } });
  const paquet = config.panneauPrincipal('G-BI', null, 'accueil');
  const champs = paquet.embeds[0].toJSON().fields;
  const langue = champs.find((f) => /Langue/.test(f.name));
  const fond = champs.find((f) => /Fond/.test(f.name));
  assert.ok(/WELCOME/.test(langue.value), langue && langue.value);
  assert.ok(/image perso/.test(fond.value), fond && fond.value);
});

test('le menu des fonds propose les thèmes maison', () => {
  const carte = config.carteReglage('G-BI', 'accueil', 'fond', 'C1', null);
  const menu = carte.components[0].toJSON().components[0];
  assert.strictEqual(menu.custom_id, 'cfg:accueil:fond');
  const valeurs = menu.options.map((o) => o.value);
  for (const v of ['defaut', 'sakura', 'ocean', 'nuit', 'feu']) assert.ok(valeurs.includes(v), `${v} absent`);
});

test('choisir un thème de fond l\'enregistre et nettoie l\'URL perso', async () => {
  stockage.majReglages('G-BI', { bienvenue: { fond: 'https://x/y.png', fondTheme: null } });
  const inter = selecteur('cfg:accueil:fond', { isStringSelectMenu: () => true, values: ['sakura'] });
  await config.composant(inter);
  const b = stockage.reglages('G-BI').bienvenue;
  assert.strictEqual(b.fondTheme, 'sakura');
  assert.strictEqual(b.fond, null);
});

test('thème de fond : rendu différent du dégradé par défaut', async () => {
  const img2 = require('../utils/bienvenue-image');
  const a = await img2.composer({ pseudo: 'A', theme: 'defaut' });
  const b2 = await img2.composer({ pseudo: 'A', theme: 'sakura' });
  assert.ok(a[0] === 0x89 && b2[0] === 0x89);
  assert.ok(!a.equals(b2), 'le thème ne change rien au rendu');
});

// ─── optimisation CDN + recadrage automatique ───
test('optimiserUrl : le CDN Discord reçoit un recadrage 1280×720 « cover »', () => {
  const u = img.optimiserUrl('https://cdn.discordapp.com/attachments/1/2/photo.png');
  assert.ok(u.includes('width=1280') && u.includes('height=720') && u.includes('resize=cover'), u);
});
test('optimiserUrl : les autres hébergeurs ne sont pas touchés', () => {
  assert.strictEqual(img.optimiserUrl('https://exemple.com/fond.png'), 'https://exemple.com/fond.png');
  assert.strictEqual(img.optimiserUrl('https://cdn.discordapp.com/x.png?deja=1'), 'https://cdn.discordapp.com/x.png?deja=1');
  assert.strictEqual(img.optimiserUrl(''), '');
});

test('photo de téléphone verticale (400×3000) → carte recadrée pile 1280×720', async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(400, 3000); const x = c.getContext('2d');
  x.fillStyle = '#3c9'; x.fillRect(0, 0, 400, 3000);
  const png = await img.composer({ fondBuffer: c.toBuffer('image/png'), pseudo: 'Nina' });
  // en-tête PNG : largeur à l'octet 16, hauteur à l'octet 20 (grand boutiste)
  assert.strictEqual(png.readUInt32BE(16), 1280);
  assert.strictEqual(png.readUInt32BE(20), 720);
});

test('image minuscule (100×80) → agrandie proprement sans crash', async () => {
  const { createCanvas } = require('@napi-rs/canvas');
  const c = createCanvas(100, 80); const x = c.getContext('2d');
  x.fillStyle = '#c36'; x.fillRect(0, 0, 100, 80);
  const png = await img.composer({ fondBuffer: c.toBuffer('image/png'), pseudo: 'Zoé' });
  assert.strictEqual(png.readUInt32BE(16), 1280);
});

// ─── la commande /image-bienvenue (joindre une image, pas d'URL) ───
const cmdFond = require('../commands/image-bienvenue');
function interFond(att, guildId) {
  return {
    guildId: guildId || 'G-FOND-CMD',
    user: { id: 'u', username: 'Admin' },
    member: membreMock({ id: 'admin1', tag: 'Admin', permissions: ['ManageGuild'] }),
    options: { getAttachment: () => att },
    inGuild: () => true,
    replied: false, deferred: false, journal: [],
    async reply(p) { this.journal.push(['reply', p]); this.replied = true; return {}; },
    async followUp(p) { this.journal.push(['followUp', p]); return {}; },
  };
}
function attFactice(surcharges = {}) {
  return Object.assign({ name: 'photo.png', contentType: 'image/png', size: 400000, url: 'https://cdn.discordapp.com/attachments/1/2/photo.png' }, surcharges);
}

test('/image-bienvenue : accepte l\'image, l\'enregistre et renvoie un vrai aperçu PNG', async () => {
  const original = img.chargerImage;
  let urlDemandee = null;
  img.chargerImage = async (u) => {
    urlDemandee = u;
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(300, 900); const x = c.getContext('2d');
    x.fillStyle = '#0af'; x.fillRect(0, 0, 300, 900);
    return c.toBuffer('image/png');
  };
  try {
    const inter = interFond(attFactice(), 'G-FOND-OK');
    await cmdFond.executer(inter);
    assert.strictEqual(stockage.reglages('G-FOND-OK').bienvenue.fond, 'https://cdn.discordapp.com/attachments/1/2/photo.png');
    const paquet = inter.journal[0][1];
    assert.ok(paquet.ephemeral, 'la réponse doit être privée');
    assert.ok(paquet.files?.length, 'aucun aperçu joint');
    assert.ok(paquet.files[0].attachment[0] === 0x89, 'l\'aperçu n\'est pas un PNG');
    assert.ok(urlDemandee.includes('resize=cover'), 'le téléchargement ne passe pas par le recadrage CDN');
  } finally { img.chargerImage = original; }
});

test('/image-bienvenue : un PDF est refusé avec une phrase claire', async () => {
  const inter = interFond(attFactice({ name: 'cours.pdf', contentType: 'application/pdf' }), 'G-FOND-PDF');
  await cmdFond.executer(inter);
  const t = JSON.stringify(inter.journal[0][1].embeds[0].toJSON());
  assert.ok(/pas une image/.test(t), t);
});

test('/image-bienvenue : 9 Mo → refusé « trop lourde »', async () => {
  const inter = interFond(attFactice({ size: 9 * 1024 * 1024 }), 'G-FOND-LOURD');
  await cmdFond.executer(inter);
  assert.ok(/trop lourde/.test(JSON.stringify(inter.journal[0][1])), 'message de refus manquant');
});

test('/image-bienvenue : fichier illisible → refus propre, rien d\'enregistré', async () => {
  const original = img.chargerImage;
  img.chargerImage = async () => Buffer.from('ceci n\'est pas une image');
  try {
    const inter = interFond(attFactice(), 'G-FOND-CASSE');
    await cmdFond.executer(inter);
    assert.ok(/lire ce fichier|Impossible/.test(JSON.stringify(inter.journal[0][1])), 'pas de message d\'erreur clair');
    assert.strictEqual(stockage.reglages('G-FOND-CASSE').bienvenue.fond, null);
  } finally { img.chargerImage = original; }
});

test('toutes les commandes sont chargées, y compris la nouvelle', () => {
  const { chargerCommandes } = require('../utils/commandes');
  assert.ok(chargerCommandes().commandes.has('image-bienvenue'), 'commande non enregistrée');
});

module.exports = { nom: 'bienvenue-image', cas };
if (require.main === module) require('./executeur')(module.exports);
