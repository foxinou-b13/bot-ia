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

test('generer() : fond perso injoignable → le fond par défaut prend le relais, aucune exception', async () => {
  const png = await img.generer({
    fondUrl: 'https://exemple-inexistant-otaku.invalid/x.png',
    pseudo: 'Fox', langue: 'fr',
    fetchImpl: async () => { throw new Error('réseau KO'); },
  });
  assert.ok(png[0] === 0x89);
  assert.strictEqual(png.readUInt32BE(16), 1280);
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

test('la carte du fond n\'affiche plus de menu thèmes (supprimés sur demande)', () => {
  stockage.majReglages('G-BI', { bienvenue: { fond: null } });
  const carte = config.carteReglage('G-BI', 'accueil', 'fond', 'C1', null);
  const json = carte.components.map((r) => r.toJSON());
  assert.ok(!json.some((r) => r.components.some((c) => c.custom_id === 'cfg:accueil:fond')),
    'le sélecteur de thèmes ne doit plus exister');
  assert.ok(/fond par défaut/.test(carte.embeds[0].toJSON().fields[0].value));
});

test('« 🌸 Fond par défaut » : nettoie l\'image perso enregistrée', async () => {
  stockage.majReglages('G-BI', { bienvenue: { fond: 'https://x/y.png' } });
  const inter = selecteur('cfg:accueil:fond-off', { isButton: () => true });
  await config.composant(inter);
  assert.strictEqual(stockage.reglages('G-BI').bienvenue.fond, null);
});

test('fond par défaut : la gif cosmos du serveur est utilisée et recadrée pile 1280×720', async () => {
  const fs = require('fs');
  const brut = fs.readFileSync(require('path').join(__dirname, '..', 'assets', 'fond-defaut.gif'));
  assert.ok(brut.length > 1000, "l'asset du fond par défaut est manquante");
  const png = await img.composer({ pseudo: 'A' });
  assert.strictEqual(png[0], 0x89, 'le rendu doit être un PNG');
  assert.strictEqual(png.readUInt32BE(16), 1280);
  assert.strictEqual(png.readUInt32BE(20), 720);
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

// ─── le parcours « 📱 Choisir ton image » (MP, sélecteur natif du client) ───
test('la carte du fond propose le bouton 📱 (vrai bouton, plus de lien externe)', () => {
  stockage.majReglages('G-BI', { bienvenue: { fond: null } });
  const carte = config.carteReglage('G-BI', 'accueil', 'fond', 'C1', null);
  const boutons = carte.components[0].toJSON().components;
  assert.ok(boutons.some((b) => b.custom_id === 'cfg:accueil:fond-pj' && b.style === 1),
    'le bouton « Choisir ton image » doit être un bouton normal et visible');
  assert.ok(!boutons.some((b) => b.style === 5), 'plus aucun bouton-lien externe');
});

const choixFond = require('../utils/choix-fond');

test('bouton 📱 : le bot ouvre LE sélecteur natif de Discord (modale avec champ fichier)', async () => {
  const inter = selecteur('cfg:accueil:fond-pj', { isButton: () => true, async showModal(m) { this.modale = m; } });
  await config.composant(inter);
  const brut = inter.modale.toJSON();
  assert.strictEqual(brut.title, 'Choisir une image');
  const champ = brut.components[0].components[0];
  assert.strictEqual(champ.type, 19, 'type 19 = champ « ajouter des fichiers »');
  assert.deepStrictEqual(champ.file_types, ['image'], 'seules des images doivent être proposées');
  assert.strictEqual(champ.max_values, 1);
});

test('bouton 📱 : si le client est trop vieux pour la modale, repli MP', async () => {
  const inter = selecteur('cfg:accueil:fond-pj', {
    isButton: () => true,
    async showModal() { throw new Error('client pas à jour'); },
  });
  let envoye = null;
  inter.user.send = async (paquet) => { envoye = paquet; };
  await config.composant(inter);
  assert.ok(envoye && /📎/.test(envoye.content), 'le repli doit écrire en MP');
  assert.ok(choixFond.chercherEnAttente(inter.user.id), 'l\'attente MP doit être prise pour le repli');
  choixFond.__enAttente.delete(inter.user.id);
});

test('modale soumise avec une image : vérifiée, enregistrée, aperçu renvoyé', async () => {
  const G2 = 'G-MODAL-OK';
  stockage.majReglages(G2, { bienvenue: { langue: 'en' } });
  const original = img.chargerImage;
  img.chargerImage = async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(900, 500); const x = c.getContext('2d');
    x.fillStyle = '#4fc3d9'; x.fillRect(0, 0, 900, 500);
    return c.toBuffer('image/png');
  };
  try {
    const inter = selecteur('cfg:accueil:fond-pj-modal', {
      isModalSubmit: () => true, isStringSelectMenu: () => false,
      fields: { getFileUpload: () => ({ first: () => ({ url: 'https://cdn.discordapp.com/attachments/7/7/mono.jpg', size: 30000 }) }) },
    });
    inter.user = { id: 'u', username: 'Foxinou' };
    inter.guildId = G2;
    await config.composant(inter);
    assert.strictEqual(stockage.reglages(G2).bienvenue.fond, 'https://cdn.discordapp.com/attachments/7/7/mono.jpg');
    const paquet = inter.journal.find(([t]) => t === 'reply')[1];
    assert.ok(paquet.ephemeral, 'la réponse doit être privée');
    assert.ok(paquet.files?.[0]?.attachment?.[0] === 0x89, 'aperçu PNG attendu');
    assert.ok(/WELCOME|aperçu/i.test(JSON.stringify(paquet.embeds[0])), 'l\'aperçu doit suivre la langue EN');
  } finally { img.chargerImage = original; }
});

test('modale soumise sans image ou avec une image énorme : réponses claires, rien d\'enregistré', async () => {
  const G3 = 'G-MODAL-KO';
  const vide = selecteur('cfg:accueil:fond-pj-modal', {
    isModalSubmit: () => true, isStringSelectMenu: () => false,
    fields: { getFileUpload: () => null },
  });
  vide.guildId = G3;
  await config.composant(vide);
  assert.ok(/Aucune image/.test(JSON.stringify(vide.journal)), JSON.stringify(vide.journal));
  assert.strictEqual(stockage.reglages(G3).bienvenue.fond, null);

  const lourde = selecteur('cfg:accueil:fond-pj-modal', {
    isModalSubmit: () => true, isStringSelectMenu: () => false,
    fields: { getFileUpload: () => ({ first: () => ({ url: 'https://x/y.png', size: 30 * 1024 * 1024 }) }) },
  });
  lourde.guildId = G3;
  await config.composant(lourde);
  assert.ok(/8 Mo/.test(JSON.stringify(lourde.journal)));
  assert.strictEqual(stockage.reglages(G3).bienvenue.fond, null);
});

test('MP avec une image : vérifiée, enregistrée, aperçu renvoyé, attente levée', async () => {
  const G2 = 'G-DMFOND-OK';
  stockage.majReglages(G2, { bienvenue: { langue: 'fr' } });
  choixFond.__enAttente.set('dm1', { guildId: G2, expire: Date.now() + 60000 });
  const original = img.chargerImage;
  img.chargerImage = async () => {
    const { createCanvas } = require('@napi-rs/canvas');
    const c = createCanvas(600, 900); const x = c.getContext('2d');
    x.fillStyle = '#d98fae'; x.fillRect(0, 0, 600, 900);
    return c.toBuffer('image/png');
  };
  try {
    let reponse = null;
    const message = {
      author: { id: 'dm1', bot: false, username: 'Nina' },
      attachments: { values: () => [{ url: 'https://cdn.discordapp.com/attachments/1/2/fond.png', content_type: 'image/png', size: 12000 }] },
      async reply(p) { reponse = p; return {}; },
    };
    const pris = await choixFond.traiterMp(message);
    assert.strictEqual(pris, true);
    assert.strictEqual(stockage.reglages(G2).bienvenue.fond, 'https://cdn.discordapp.com/attachments/1/2/fond.png');
    assert.ok(reponse.files?.length && reponse.files[0].attachment[0] === 0x89, 'aperçu PNG attendu');
    assert.strictEqual(choixFond.chercherEnAttente('dm1'), null, 'l\'attente doit être levée');
  } finally { img.chargerImage = original; choixFond.__enAttente.delete('dm1'); }
});

test('MP sans image : on redemande poliment, l\'attente reste ouverte', async () => {
  choixFond.__enAttente.set('dm2', { guildId: 'G-X', expire: Date.now() + 60000 });
  let reponse = null;
  const message = {
    author: { id: 'dm2', bot: false, username: 'Zoé' },
    attachments: { values: () => [] },
    async reply(p) { reponse = p; return {}; },
  };
  const pris = await choixFond.traiterMp(message);
  assert.strictEqual(pris, true);
  assert.ok(/pièce jointe|galerie/.test(reponse.content), reponse && reponse.content);
  assert.ok(choixFond.chercherEnAttente('dm2'), 'l\'attente doit rester ouverte pour réessayer');
  choixFond.__enAttente.delete('dm2');
});

test('MP : un message qui ne vient pas d\'un admin en attente est ignoré', async () => {
  const message = { author: { id: 'inconnu', bot: false }, attachments: { values: () => [] }, async reply() { throw new Error('ne doit pas répondre'); } };
  assert.strictEqual(await choixFond.traiterMp(message), false);
});

test('MP : image trop lourde → refus propre, rien d\'enregistré', async () => {
  const G3 = 'G-DMFOND-LOURDE';
  choixFond.__enAttente.set('dm3', { guildId: G3, expire: Date.now() + 60000 });
  let reponse = null;
  const message = {
    author: { id: 'dm3', bot: false, username: 'Max' },
    attachments: { values: () => [{ url: 'https://cdn.discordapp.com/attachments/1/3/gros.png', content_type: 'image/png', size: 20 * 1024 * 1024 }] },
    async reply(p) { reponse = p; return {}; },
  };
  await choixFond.traiterMp(message);
  assert.ok(/trop lourde|illisible/.test(reponse.content), reponse && reponse.content);
  assert.strictEqual(stockage.reglages(G3).bienvenue.fond, null);
  choixFond.__enAttente.delete('dm3');
});

test('attente expirée : plus personne en file au bout de 10 minutes', () => {
  choixFond.__enAttente.set('dm4', { guildId: 'G-X', expire: Date.now() - 1 });
  assert.strictEqual(choixFond.chercherEnAttente('dm4'), null);
});

module.exports = { nom: 'bienvenue-image', cas };
if (require.main === module) require('./executeur')(module.exports);
