/**
 * tests/bienvenue-image.test.js — générateur de la carte-image + réglages du panneau.
 */
const assert = require('assert');
const { createCanvas } = require('@napi-rs/canvas');
const img = require('../utils/bienvenue-image');
const { membreMock, guildeMock, salonMock } = require('./aide');
const { MessageFlags } = require('discord.js');
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
    assert.strictEqual(paquet.flags, MessageFlags.Ephemeral, 'la réponse doit être privée');
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

// ─── le parcours « 📱 Choisir une image » (invitation dans le salon, zéro MP) ───
test('la carte du fond propose le bouton 📱 (vrai bouton, plus de lien externe)', () => {
  stockage.majReglages('G-BI', { bienvenue: { fond: null } });
  const carte = config.carteReglage('G-BI', 'accueil', 'fond', 'C1', null);
  const boutons = carte.components[0].toJSON().components;
  assert.ok(boutons.some((b) => b.custom_id === 'cfg:accueil:fond-pj' && b.style === 1 && /Choisir une image/.test(b.label)),
    'le bouton « Choisir une image » doit être un bouton normal, visible, avec le label exact');
  assert.ok(!boutons.some((b) => b.style === 5), 'plus aucun bouton-lien externe');
});

const choixFond = require('../utils/choix-fond');

test('bouton 📱 : la FENÊTRE NATIVE s\u2019ouvre d\u2019elle-même — structure officielle Label(18)→FileUpload(19), zéro message dans le salon', async () => {
  choixFond.__enAttente.clear();
  let mpTente = false;
  const inter = selecteur('cfg:accueil:fond-pj', {
    isButton: () => true,
    channel: { send: async () => { throw new Error('le salon ne doit RIEN recevoir quand la fenêtre fonctionne'); } },
    async showModal(modale) { this.brut = modale.toJSON(); },
  });
  inter.user.send = async () => { mpTente = true; throw new Error('MP interdit'); };
  await config.composant(inter);
  assert.ok(inter.brut, 'le client a bien reçu la demande d\u2019ouverture de fenêtre');
  assert.strictEqual(inter.brut.title, 'Choisir une image');
  assert.strictEqual(inter.brut.custom_id, 'cfg:accueil:fond-pj-modal');
  const etiquette = inter.brut.components[0];
  assert.strictEqual(etiquette.type, 18, 'Label (type 18) : LA structure officielle en modale (pas de rangée d\u2019actions)');
  assert.strictEqual(etiquette.component.type, 19, 'le champ fichiers (19) est à l\u2019intérieur du Label');
  assert.strictEqual(etiquette.component.custom_id, 'fichier');
  assert.deepStrictEqual(etiquette.component.file_types, ['image'], 'seules des images sont proposées');
  assert.strictEqual(etiquette.component.max_values, 1);
  assert.strictEqual(inter.journal.length, 0, 'aucun message posté ni carte mise à jour : rien dans le salon');
  assert.strictEqual(mpTente, false, 'zéro MP');
});

test('client trop ancien (fenêtre refusée) : repli invitation dans le salon — zéro MP, pas d\u2019avalanche au double clic', async () => {
  choixFond.__enAttente.clear();
  const invitations = [];
  let mpTente = false;
  const inter = selecteur('cfg:accueil:fond-pj', {
    isButton: () => true,
    async showModal() { throw new Error('Invalid Form Body'); },
    channel: { send: async (paquet) => { invitations.push(paquet); return { id: 'msg-invite', async delete() {} }; } },
  });
  inter.user.send = async () => { mpTente = true; throw new Error('MP interdit'); };
  await config.composant(inter);
  assert.strictEqual(invitations.length, 1, 'le repli poste exactement une invitation');
  assert.ok(/réponds à ce message/.test(invitations[0].content), invitations[0].content);
  const attente = choixFond.chercherEnAttente('u');
  assert.ok(attente && attente.messageId === 'msg-invite', 'attente ouverte : la réponse au 📎 sera traitée');
  assert.strictEqual(mpTente, false, 'zéro MP même en repli');
  await config.composant(inter);   // double clic
  assert.strictEqual(invitations.length, 1, 'un double clic ne poste pas une deuxième invitation');
  choixFond.__enAttente.clear();
});

test('modale soumise avec une image : recopiée dans le salon privé du bot (URL durable), aperçu PRIVÉ, zéro MP, zéro trace dans le salon', async () => {
  const G = 'G-MOD-OK';
  stockage.majReglages(G, { bienvenue: { fond: null, fondStock: null, langue: 'fr' } });
  const original = img.chargerImage;
  img.chargerImage = async () => {
    const c = createCanvas(900, 500); const x = c.getContext('2d');
    x.fillStyle = '#4fc3d9'; x.fillRect(0, 0, 900, 500);
    return c.toBuffer('image/png');
  };
  try {
    const copieMsg = {
      id: 'copie-1', channel: { id: 'canal-stock' },
      attachments: { first: () => ({ url: 'https://cdn.discordapp.com/attachments/9/9/copie.png' }) },
    };
    let envoyeDans = null;
    const canal = {
      id: 'canal-stock',
      send: async (paquet) => { envoyeDans = paquet; return copieMsg; },
      messages: { fetch: async () => ({ async delete() {} }) },
    };
    const guild = { id: G, roles: { everyone: { id: '@everyone' } },
      channels: { cache: { find: () => canal, get: () => canal }, create: async () => canal } };
    const { Collection } = require('discord.js');
    const fichiers = new Collection([['att1', {
      id: 'att1', url: 'https://cdn.discordapp.com/ephemeral-attachments/9/9/mono.png?ex=68dc', content_type: 'image/png', name: 'mono.png', size: 30000,
    }]]);
    let mpTente = false; let paquetRepondu = null;
    const inter = selecteur('cfg:accueil:fond-pj-modal', {
      isModalSubmit: () => true,
      fields: { getUploadedFiles: () => fichiers },
      guild, client: { user: { id: 'bot1' } }, guildId: G,
      channel: { send: async () => { throw new Error('le salon public ne doit rien recevoir'); } },
      async reply(paquet) { paquetRepondu = paquet; },
    });
    inter.user.send = async () => { mpTente = true; throw new Error('MP interdit'); };
    await config.composant(inter);
    assert.strictEqual(stockage.reglages(G).bienvenue.fond, 'https://cdn.discordapp.com/attachments/9/9/copie.png',
      'le fond enregistre la copie DURABLE du bot, jamais l\u2019URL éphémère qui meurt en 1 h');
    assert.deepStrictEqual(stockage.reglages(G).bienvenue.fondStock, { canalId: 'canal-stock', messageId: 'copie-1' });
    assert.ok(envoyeDans && envoyeDans.files[0].attachment[0] === 0x89, 'la copie part en vraie pièce jointe dans le salon privé');
    assert.ok(paquetRepondu, 'le bot a répondu à la fenêtre');
    assert.strictEqual(paquetRepondu.flags, MessageFlags.Ephemeral, 'aperçu visible par l\u2019admin seul');
    assert.strictEqual(paquetRepondu.files[0].attachment[0], 0x89, 'la réponse contient la vraie carte en PNG');
    assert.ok(/Fond enregistré/.test(JSON.stringify(paquetRepondu)), 'mot de confirmation attendu');
    assert.strictEqual(mpTente, false, 'zéro MP');
  } finally { img.chargerImage = original; stockage.majReglages('G-BI', { bienvenue: { fond: null, fondStock: null } }); }
});

test('modale : sans fichier, trop lourd ou pas une image → notes privées claires, rien enregistré', async () => {
  const G = 'G-MOD-KO';
  stockage.majReglages(G, { bienvenue: { fond: null, fondStock: null } });
  const guild = { id: G, roles: { everyone: { id: '@e' } },
    channels: { cache: { find: () => null, get: () => null }, create: async () => { throw new Error('no perms'); } } };
  const fabrique = (fichiers) => selecteur('cfg:accueil:fond-pj-modal', {
    isModalSubmit: () => true, guild, client: { user: { id: 'b' } }, guildId: G,
    fields: { getUploadedFiles: () => fichiers },
    async reply(paquet) { this.reponse = paquet; },
  });
  const vide = fabrique(null);
  await config.composant(vide);
  assert.ok(/Aucune image/.test(vide.reponse.content), JSON.stringify(vide.reponse));
  assert.strictEqual(vide.reponse.flags, MessageFlags.Ephemeral, 'même les refus restent privés');
  const lourde = fabrique([{ url: 'https://x/y.png', content_type: 'image/png', name: 'y.png', size: 30 * 1024 * 1024 }]);
  await config.composant(lourde);
  assert.ok(/8 Mo/.test(lourde.reponse.content), lourde.reponse.content);
  const pdf = fabrique([{ url: 'https://x/y.pdf', content_type: 'application/pdf', name: 'cours.pdf', size: 100 }]);
  await config.composant(pdf);
  assert.ok(/image/.test(pdf.reponse.content), 'un PDF est refusé en mots simples');
  assert.strictEqual(stockage.reglages(G).bienvenue.fond, null, 'rien n\u2019a été enregistré en cas d\u2019échec');
});

test('changer de fond purge automatiquement l\u2019ancienne copie du salon privé', async () => {
  const G = 'G-MOD-REMPL';
  stockage.majReglages(G, { bienvenue: { fond: null, fondStock: null } });
  const original = img.chargerImage;
  img.chargerImage = async () => {
    const c = createCanvas(640, 360); const x = c.getContext('2d');
    x.fillStyle = '#445'; x.fillRect(0, 0, 640, 360);
    return c.toBuffer('image/png');
  };
  try {
    let compteur = 0; let supprime = null;
    const canal = {
      id: 'cs',
      send: async () => {
        compteur++;
        const id = 'copie-' + compteur;
        return { id, channel: { id: 'cs' }, attachments: { first: () => ({ url: 'https://cdn.discordapp.com/attachments/9/9/' + id + '.png' }) } };
      },
      messages: { fetch: async (idMessage) => ({ async delete() { supprime = idMessage; } }) },
    };
    const guild = { id: G, roles: { everyone: { id: '@e' } },
      channels: { cache: { find: () => canal, get: () => canal }, create: async () => canal } };
    const piece = { url: 'https://cdn.discordapp.com/ephemeral-attachments/1.png', content_type: 'image/png', name: 'a.png', size: 5000 };
    assert.ok((await choixFond.traiterPiece(guild, { user: { id: 'b' } }, G, piece)).ok);
    assert.ok((await choixFond.traiterPiece(guild, { user: { id: 'b' } }, G, piece)).ok);
    assert.strictEqual(supprime, 'copie-1', 'la première copie est effacée quand la deuxième arrive');
    assert.strictEqual(stockage.reglages(G).bienvenue.fondStock.messageId, 'copie-2');
    assert.strictEqual(stockage.reglages(G).bienvenue.fond, 'https://cdn.discordapp.com/attachments/9/9/copie-2.png');
  } finally { img.chargerImage = original; }
});

test('bouton 📱 : salon où le bot ne peut pas écrire → on renvoie vers « 🔗 Adresse d\u2019image », sans crash ni MP', async () => {
  const inter = selecteur('cfg:accueil:fond-pj', {
    isButton: () => true,
    channel: { send: async () => { throw new Error('missing permissions'); } },
  });
  inter.user.send = async () => { throw new Error('le bot ne doit pas écrire en MP'); };
  await config.composant(inter);
  const note = inter.journal.find(([t]) => t === 'update')[1];
  assert.ok(/Adresse d/.test(JSON.stringify(note)), JSON.stringify(note));
});

test('réponse à l\u2019invitation avec une image : enregistrée, aperçu PNG posté, invitation et réponse EFFACÉES', async () => {
  const G = 'G-REP-OK';
  stockage.majReglages(G, { bienvenue: { langue: 'fr', fond: null } });
  const original = img.chargerImage;
  img.chargerImage = async () => {
    const c = createCanvas(900, 500); const x = c.getContext('2d');
    x.fillStyle = '#4fc3d9'; x.fillRect(0, 0, 900, 500);
    return c.toBuffer('image/png');
  };
  try {
    const msgInvite = { id: 'msg-invite', suppr: 0, async delete() { this.suppr++; } };
    choixFond.__enAttente.set('u', { guildId: G, messageId: 'msg-invite', prompt: msgInvite, expire: Date.now() + 60000 });
    let apercu = null; let erreur = null;
    const message = {
      author: { id: 'u', username: 'Nina', bot: false },
      guild: { id: G },
      channel: { send: async (paquet) => { apercu = paquet; } },
      messageReference: { messageId: 'msg-invite' },
      attachments: { values: () => [{ url: 'https://cdn.discordapp.com/attachments/1/2/fond.png', content_type: 'image/png', size: 120000 }] },
      async reply(paquet) { erreur = paquet; },
      suppr: 0, async delete() { this.suppr++; },
    };
    assert.strictEqual(await choixFond.traiterReponse(message), true, 'le message doit être consommé');
    assert.strictEqual(stockage.reglages(G).bienvenue.fond, 'https://cdn.discordapp.com/attachments/1/2/fond.png');
    assert.strictEqual(message.suppr, 1, "la réponse avec l'image doit disparaître du salon");
    assert.strictEqual(msgInvite.suppr, 1, 'le message-invitation doit disparaître aussi');
    assert.ok(!erreur, `pas de message d'erreur, reçu : ${JSON.stringify(erreur)}`);
    assert.ok(apercu && apercu.files?.[0]?.name === 'apercu-bienvenue.png', "l'aperçu PNG doit suivre dans le salon");
    assert.strictEqual(apercu.files[0].attachment[0], 0x89, "l'aperçu doit être un PNG");
    assert.ok(/Fond enregistré/.test(JSON.stringify(apercu)), 'le mot de confirmation doit être là');
    assert.strictEqual(choixFond.chercherEnAttente('u'), null, 'attente levée après traitement');
  } finally { img.chargerImage = original; choixFond.__enAttente.delete('u'); }
});

test('réponse SANS image : on redemande poliment, rien ne s\u2019efface, l\u2019attente reste ouverte', async () => {
  choixFond.__enAttente.set('u', {
    guildId: 'G-X', messageId: 'msg-invite',
    prompt: { async delete() { throw new Error('ne doit pas effacer le message-invitation'); } },
    expire: Date.now() + 60000,
  });
  let note = null; let efface = false;
  const message = {
    author: { id: 'u', bot: false }, guild: { id: 'G-X' },
    messageReference: { messageId: 'msg-invite' },
    attachments: { values: () => [] },
    async reply(paquet) { note = paquet; },
    async delete() { efface = true; },
  };
  assert.strictEqual(await choixFond.traiterReponse(message), true, 'un message-consommé ne doit pas être modéré deux fois');
  assert.ok(/image/.test(note.content), note && note.content);
  assert.strictEqual(efface, false, 'sans image, on garde les messages pour réessayer');
  assert.ok(choixFond.chercherEnAttente('u'), "l'attente reste ouverte");
  choixFond.__enAttente.delete('u');
});

test('image trop lourde (30 Mo) → refus clair, rien d\u2019enregistré', async () => {
  const G = 'G-REP-LOURDE';
  stockage.majReglages(G, { bienvenue: { fond: null } });
  choixFond.__enAttente.set('u', { guildId: G, messageId: 'm', prompt: null, expire: Date.now() + 60000 });
  let note = null;
  await choixFond.traiterReponse({
    author: { id: 'u', bot: false }, guild: { id: G }, messageReference: { messageId: 'm' },
    attachments: { values: () => [{ url: 'https://x/y.png', content_type: 'image/png', size: 30 * 1024 * 1024 }] },
    async reply(paquet) { note = paquet; },
    async delete() {},
  });
  assert.ok(/8 Mo/.test(note.content), note && note.content);
  assert.strictEqual(stockage.reglages(G).bienvenue.fond, null);
  choixFond.__enAttente.delete('u');
});

test('image illisible → on prévient, rien d\u2019enregistré', async () => {
  const G = 'G-REP-CASSE';
  stockage.majReglages(G, { bienvenue: { fond: null } });
  const original = img.chargerImage;
  img.chargerImage = async () => Buffer.from("ceci n'est pas une image");
  try {
    choixFond.__enAttente.set('u', { guildId: G, messageId: 'm', prompt: null, expire: Date.now() + 60000 });
    let note = null;
    await choixFond.traiterReponse({
      author: { id: 'u', bot: false }, guild: { id: G }, messageReference: { messageId: 'm' },
      attachments: { values: () => [{ url: 'https://x/y.png', content_type: 'image/png', size: 1000 }] },
      async reply(paquet) { note = paquet; },
      async delete() {},
    });
    assert.ok(/pas réussi à lire/.test(note.content), note && note.content);
    assert.strictEqual(stockage.reglages(G).bienvenue.fond, null);
  } finally { img.chargerImage = original; choixFond.__enAttente.delete('u'); }
});

test('les autres messages du salon ne sont pas touchés (ni consommés, ni effacés)', async () => {
  choixFond.__enAttente.set('u', { guildId: 'G-Y', messageId: 'msg-invite', prompt: null, expire: Date.now() + 60000 });
  // auteur hors attente
  assert.strictEqual(await choixFond.traiterReponse({
    author: { id: 'quelquun-dautre', bot: false }, guild: { id: 'G-Y' },
    attachments: { values: () => [] }, async reply() { throw new Error('ne doit pas répondre'); },
  }), false, "le message d'un autre membre doit passer à la moderation normalement");
  // bonne personne, mais ne répond pas au bon message
  assert.strictEqual(await choixFond.traiterReponse({
    author: { id: 'u', bot: false }, guild: { id: 'G-Y' }, messageReference: { messageId: 'autre-chose' },
    attachments: { values: () => [] }, async reply() { throw new Error('ne doit pas répondre'); },
  }), false, 'répondre à un autre message ne doit rien déclencher');
  // message d'un bot
  assert.strictEqual(await choixFond.traiterReponse({ author: { id: 'u', bot: true } }), false);
  choixFond.__enAttente.delete('u');
});

test('attente expirée : plus personne en file au bout de 10 minutes', () => {
  choixFond.__enAttente.set('u', { guildId: 'G-X', messageId: 'm', prompt: null, expire: Date.now() - 1 });
  assert.strictEqual(choixFond.chercherEnAttente('u'), null);
  choixFond.__enAttente.delete('u');
});

module.exports = { nom: 'bienvenue-image', cas };
if (require.main === module) require('./executeur')(module.exports);
