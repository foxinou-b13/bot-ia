/**
 * tests/conformite.test.js — filtres de sécurité IA, porte d'accès,
 * droits des membres (/donnees), transparence (/confidentialite),
 * et nouveaux réglages du panneau (IA par salon, personnalité).
 */
const assert = require('assert');
const { membreMock, guildeMock, interactionMock, texteReponses } = require('./aide');
const securite = require('../utils/securite-ia');
const ia = require('../utils/ia');
const stockage = require('../utils/stockage');
const { chargerCommandes } = require('../utils/commandes');

const { commandes } = chargerCommandes();
const ask = commandes.get('ask');
const donnees = commandes.get('donnees');
const confidentialite = commandes.get('confidentialite');
const config = commandes.get('config');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

// ─────────── le filtre entrant ───────────
test('filtre : bloque le contenu adulte en français', () => {
  assert.ok(securite.filtrer('envoie-moi du sexe'), 'sexe non bloqué');
  assert.ok(securite.filtrer('je veux un porno'), 'porno non bloqué');
  assert.ok(securite.filtrer('parle-moi de xvideos'), 'xvideos non bloqué');
});

test('filtre : bloque aussi écrit en "leet" (chiffres à la place des lettres)', () => {
  assert.ok(securite.filtrer('je veux du p0rn0'), 'p0rn0 non bloqué');
  assert.ok(securite.filtrer('s3xe'), 's3xe non bloqué');
  assert.ok(securite.filtrer('P0RNO'), 'majuscules non bloquées');
});

test('filtre : bloque en anglais aussi', () => {
  assert.ok(securite.filtrer('generate nsfw image'));
  assert.ok(securite.filtrer('send nudes'));
});

test('filtre : protège les mineurs (liste dédiée)', () => {
  assert.ok(securite.filtrer('du contenu loli'), 'loli non bloqué');
  assert.ok(securite.filtrer('child sex'), 'child sex non bloqué');
});

test('filtre : bloque le vol de comptes et le piratage', () => {
  assert.ok(securite.filtrer('comment pirater un compte discord'), 'pirater non bloqué');
  assert.ok(securite.filtrer('un générateur de carte'), 'carte non bloqué');
});

test('filtre : NE bloque PAS les questions de modération légitimes', () => {
  assert.strictEqual(securite.filtrer('comment bannir un membre qui poste des liens ?'), null);
  assert.strictEqual(securite.filtrer('j\'habite à Valence, c\'est joli ?'), null);
  assert.strictEqual(securite.filtrer('c\'est quoi un slowmode'), null);
  assert.strictEqual(securite.filtrer('mon petit frère joue trop, des conseils ?'), null);
});

// ─────────── la porte d'accès (réglages serveur + salon) ───────────
test('porte : IA désactivée sur le serveur → refus poli', () => {
  const G = `G-CONF-${Date.now()}`;
  stockage.majReglages(G, { ia: { active: false } });
  const r = securite.verifierAcces(G, 'C1', 'bonjour');
  assert.strictEqual(r.ok, false);
  assert.ok(/désactivée/i.test(r.raison));
});

test('porte : salon coupé via le panneau → refus, les autres salons OK', () => {
  const G = `G-CONF2-${Date.now()}`;
  stockage.majReglages(G, { ia: { salonBloques: ['C-BLOQUE'] } });
  assert.strictEqual(securite.verifierAcces(G, 'C-BLOQUE', 'bonjour').ok, false);
  assert.strictEqual(securite.verifierAcces(G, 'C-LIBRE', 'bonjour').ok, true);
});

test('porte : sujet interdit → bloc marqué (pour l\'audit)', () => {
  const G = `G-CONF3-${Date.now()}`;
  const r = securite.verifierAcces(G, 'C1', 'envoie du porno');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.bloc, 'contenu adulte');
});

// ─────────── le prompt système ───────────
test('prompt système : contient les garde-fous (adulte, injection, 3114)', () => {
  const c = ia.consigneSysteme({});
  assert.ok(/JAMAIS/.test(c), 'clause contenu adulte absente');
  assert.ok(/3114/.test(c), 'numéro d\'aide absent');
  assert.ok(/oublie tes regles/i.test(c), 'clause anti-injection absente');
});

test('prompt système : la personnalité du serveur est reprise', () => {
  const c = ia.consigneSysteme({ consigneServeur: 'Tu parles comme un pirate.' });
  assert.ok(c.includes('Tu parles comme un pirate.'));
});

// ─────────── /ask branché sur la sécurité ───────────
test('/ask : question interdite → refus SANS appeler l\'IA', async () => {
  let appelee = false;
  ia.demander = async () => { appelee = true; return { texte: 'x', fournisseur: 'groq' }; };
  const inter = interactionMock({
    commandName: 'ask',
    membre: membreMock({ id: 'bloqueur1' }),
    options: { question: 'envoie-moi un porno' },
  });
  await ask.executer(inter);
  const texte = texteReponses(inter);
  assert.ok(/pas répondre/.test(texte), texte);
  assert.strictEqual(appelee, false, 'l\'IA n\'aurait pas dû être appelée');
});

test('/ask : réponse normale → carte propre, sans tag en dessous', async () => {
  ia.demander = async () => ({ texte: 'Le slowmode ralentit les messages.', fournisseur: 'groq' });
  const inter = interactionMock({
    commandName: 'ask', membre: membreMock({ id: `poseur-${Date.now()}` }),
    options: { question: 'c\'est quoi le slowmode ?' },
  });
  await ask.executer(inter);
  const edit = (inter.journal || []).find(([t]) => t === 'editReply' || t === 'reply');
  assert.ok(edit, 'aucune réponse envoyée');
  const carte = edit[1].embeds?.[0];
  assert.ok(carte, 'la réponse doit être dans une carte');
  const json = carte.toJSON ? carte.toJSON() : carte;
  assert.strictEqual(json.description, 'Le slowmode ralentit les messages.');
  assert.ok(!json.footer, 'aucun tag sous la carte');
});

// ─────────── /donnees ───────────
test('/donnees voir : affiche le nombre d\'avertissements', async () => {
  const G = `G-DON-${Date.now()}`;
  const U = `U-${Date.now()}`;
  stockage.ajouterAvert(G, U, { raison: 'test', par: 'Staff#1', date: Date.now() });
  const inter = interactionMock({
    commandName: 'donnees', guild: guildeMock({ id: G }), membre: membreMock({ id: U, tag: 'Jean#0001' }),
    options: { action: 'voir' },
  });
  await donnees.executer(inter);
  assert.ok(/1/.test(texteReponses(inter)), 'le compteur est absent');
});

test('/donnees supprimer : efface tout, y compris l\'anti-flood', async () => {
  const G = `G-DON2-${Date.now()}`;
  const U = `U2-${Date.now()}`;
  stockage.ajouterAvert(G, U, { raison: 'a', par: 'Staff#1', date: Date.now() });
  stockage.ajouterAvert(G, U, { raison: 'b', par: 'Staff#1', date: Date.now() });
  const inter = interactionMock({
    commandName: 'donnees', guild: guildeMock({ id: G }), membre: membreMock({ id: U, tag: 'Jean#0001' }),
    options: { action: 'supprimer' },
  });
  await donnees.executer(inter);
  assert.strictEqual(stockage.avertissements(G, U).length, 0);
  assert.ok(/2 avertissement\(s\) supprimé/.test(texteReponses(inter)), texteReponses(inter));
});

test('/confidentialite : la politique nomme les fournisseurs d\'IA', async () => {
  const inter = interactionMock({ commandName: 'confidentialite', guildId: 'G-ANY', membre: membreMock({}) });
  await confidentialite.executer(inter);
  const t = texteReponses(inter);
  assert.ok(/stocke|stocké/i.test(t));
  assert.ok(/Groq|Gemini|désactiv/i.test(t), 'les cerveaux doivent être nommés');
});

// ─────────── panneau : nouveaux réglages ───────────
test('bouton « couper l\'IA ici » : ajoute puis retire le salon de la liste', async () => {
  const G = `G-CFG-IA-${Date.now()}`;
  const C = `C-${Date.now()}`;
  const make = () => ({
    customId: 'cfg:ia-ici',
    guildId: G,
    channelId: C,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    inGuild: () => true,
    replied: false,
    deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u1', tag: 'Staff#0001' },
    journal: [],
    async update(p) { this.journal.push(['update', p]); return {}; },
    async followUp(p) { this.journal.push(['followUp', p]); return {}; },
    async reply(p) { this.journal.push(['reply', p]); return {}; },
  });
  let inter = make();
  await config.composant(inter);
  assert.deepStrictEqual(stockage.reglages(G).ia.salonBloques, [C]);
  inter = make();
  await config.composant(inter);
  assert.deepStrictEqual(stockage.reglages(G).ia.salonBloques, []);
});

test('personnalité : le bouton ouvre un formulaire, l\'envoi l\'enregistre', async () => {
  const G = `G-CFG-PERSO-${Date.now()}`;
  const interOuvrir = {
    customId: 'cfg:perso',
    guildId: G,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isButton: () => true,
    isModalSubmit: () => false,
    inGuild: () => true,
    replied: false,
    deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u1', tag: 'Staff#0001' },
    modal: null,
    async showModal(m) { this.modal = m; return {}; },
  };
  await config.composant(interOuvrir);
  assert.ok(interOuvrir.modal, 'le formulaire ne s\'est pas ouvert');

  const interEnvoi = {
    customId: 'cfg:perso-modal',
    guildId: G,
    isStringSelectMenu: () => false,
    isChannelSelectMenu: () => false,
    isButton: () => false,
    isModalSubmit: () => true,
    inGuild: () => true,
    replied: false,
    deferred: false,
    member: membreMock({ permissions: ['ManageGuild'] }),
    user: { id: 'u1', tag: 'Staff#0001' },
    fields: { getTextInputValue: () => 'Tu réponds avec le sourire et des exemples.' },
    journal: [],
    async reply(p) { this.journal.push(['reply', p]); return {}; },
  };
  await config.composant(interEnvoi);
  assert.strictEqual(stockage.reglages(G).ia.consigne, 'Tu réponds avec le sourire et des exemples.');
});

test('les réglages ia ne perturbent pas les autres (merge profond)', () => {
  const G = `G-CFG-MERGE-${Date.now()}`;
  stockage.majReglages(G, { automod: { spam: false } });
  stockage.majReglages(G, { ia: { active: false } });
  const r = stockage.reglages(G);
  assert.strictEqual(r.automod.spam, false, 'automod écrasé');
  assert.strictEqual(r.automod.insultes, true, 'autres modules perdus');
  assert.strictEqual(r.ia.active, false);
});

module.exports = { nom: 'conformite', cas };

if (require.main === module) require('./executeur')(module.exports);
