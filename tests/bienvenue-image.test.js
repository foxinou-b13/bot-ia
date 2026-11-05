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

test('panneau accueil : le bouton fond ouvre un formulaire, l\'URL est validée', async () => {
  const interBouton = selecteur('cfg:accueil:fond', { isButton: () => true, async showModal(m) { this.modalVu = m; } });
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

test('l\'écran accueil annonce la langue et le fond choisis', () => {
  stockage.majReglages('G-BI', { bienvenue: { salon: 'S1', langue: 'en', fond: 'https://x/y.png' } });
  const paquet = config.panneauPrincipal('G-BI', null, 'accueil');
  const champ = paquet.embeds[0].toJSON().fields.find((f) => /Bienvenue/.test(f.name));
  assert.ok(/WELCOME \(en\)/.test(champ.value), champ.value);
  assert.ok(/fond perso/.test(champ.value), champ.value);
});

module.exports = { nom: 'bienvenue-image', cas };
if (require.main === module) require('./executeur')(module.exports);
