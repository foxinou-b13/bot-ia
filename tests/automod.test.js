const assert = require('assert');
const automod = require('../utils/automod');

const cas = [];

function test(nom, fn) {
  cas.push({ nom, fn });
}

test('détecte une invitation Discord classique', () => {
  assert.strictEqual(automod.contientInvitation('viens sur discord.gg/abc123'), true);
  assert.strictEqual(automod.contientInvitation('discord.com/invite/xyz'), true);
  assert.strictEqual(automod.contientInvitation('salut ça va ?'), false);
});

test('compte les liens', () => {
  assert.strictEqual(automod.compteLiens('va voir https://a.fr'), 1);
  assert.strictEqual(automod.compteLiens('https://a.fr et https://b.fr et https://c.fr'), 3);
  assert.strictEqual(automod.compteLiens('aucun lien ici'), 0);
});

test('trouve une insulte simple, avec accents ou majuscules', () => {
  assert.strictEqual(automod.insulteTrouvee('espèce de connard'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('CONNARD'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('c0nnard'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('bonjour tout le monde'), null);
});

test('ne confond pas un mot contenant une insulte', () => {
  // « constitution » ne doit pas déclencher « con »
  assert.strictEqual(automod.insulteTrouvee('la constitution française'), null);
});

test('détecte les majuscules excessives mais pas une phrase normale', () => {
  assert.strictEqual(automod.tropDeMajuscules('ARRETE TOUT DE SUITE MAINTENANT'), true);
  assert.strictEqual(automod.tropDeMajuscules('Bonjour, comment ça va aujourd’hui ?'), false);
  assert.strictEqual(automod.tropDeMajuscules('OK'), false);
});

test('détecte le spam : 6 messages en 8 secondes', () => {
  const maintenant = 1_000_000;
  const horodatages = [maintenant - 1000, maintenant - 2000, maintenant - 3000, maintenant - 4000, maintenant - 5000, maintenant - 6000];
  const resultat = automod.estSpam(horodatages, maintenant);
  assert.strictEqual(resultat.spam, true);
  assert.ok(resultat.nombre >= 6);
});

test('pas de spam si les messages sont espacés', () => {
  const maintenant = 1_000_000;
  const horodatages = [maintenant - 60000, maintenant - 50000, maintenant - 40000];
  const resultat = automod.estSpam(horodatages, maintenant);
  assert.strictEqual(resultat.spam, false);
});

test('analyse : invitation → suppression', () => {
  const r = automod.analyser('rejoins discord.gg/teststp');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'invitation Discord');
});

test('analyse : message normal → aucune action', () => {
  const r = automod.analyser('Quelqu\'un peut m\'aider avec le bot ?');
  assert.strictEqual(r.action, 'aucune');
});

test('analyse : trop de liens → suppression', () => {
  const r = automod.analyser('https://a.fr https://b.fr https://c.fr https://d.fr');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'trop de liens');
});

test('analyze : insulte → suppression', () => {
  const r = automod.analyser('ta gueule sale conne');
  assert.strictEqual(r.action, 'supprimer');
  assert.strictEqual(r.raison, 'propos insultants');
});

test('salon exempté correctement repéré', () => {
  assert.strictEqual(automod.salonExempt('C1', { salonExempt: 'C1' }), true);
  assert.strictEqual(automod.salonExempt('C2', { salonExempt: 'C1' }), false);
  assert.strictEqual(automod.salonExempt('C2', {}), false);
});

// ─── liens malveillants (arnaques connues) ───
test('arnaque nitro avec lien → supprimé', () => {
  const r = automod.analyser('gagne un nitro gratuit https://discord-nitro.xyz/go');
  assert.strictEqual(r.action, 'supprimer');
  assert.match(r.raison, /arnaque Nitro/);
});
test('arnaque steam gift → supprimé, même un seul lien', () => {
  const r = automod.analyser('steam gift ici http://steam-cadeau.tk');
  assert.strictEqual(r.action, 'supprimer');
});
test('faux lien discord (dliscord) → supprimé', () => {
  assert.strictEqual(automod.analyser('clique sur dliscord-app.com/gift').action, 'supprimer');
});
test('nitro mentionné sans lien → rien (discussion normale)', () => {
  assert.strictEqual(automod.analyser('j\'ai pris nitro gratuit le mois dernier sur le store officiel').action, 'aucune');
});
test('module liens désactivé → invitation ignorée', () => {
  const r = automod.analyser('va sur discord.gg/x', { reglages: { liens: false } });
  assert.strictEqual(r.action, 'aucune');
});
test('module insultes désactivé → insulte ignorée', () => {
  const r = automod.analyser('ta gueule', { reglages: { insultes: false } });
  assert.strictEqual(r.action, 'aucune');
});

test('variantes courantes : pluriels, féminin, formes verbales, mots collés à la ponctuation', () => {
  assert.strictEqual(automod.insulteTrouvee(' Bande de connards !'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('espèce de connasse'), 'connasse');
  assert.strictEqual(automod.insulteTrouvee('tous des enfoirés'), 'enfoire');
  assert.strictEqual(automod.insulteTrouvee('_connard_'), 'connard');
  assert.strictEqual(automod.insulteTrouvee('vas-y encule'), 'encule');
  assert.strictEqual(automod.insulteTrouvee('les salopes'), 'salop');
  assert.strictEqual(automod.insulteTrouvee('il me casse les couilles'), 'couille');
  assert.strictEqual(automod.insulteTrouvee('VA  TE   FAIRE foutre'), 'va te faire');
});

test('toujours aucun faux positif sur les mots normaux', () => {
  assert.strictEqual(automod.insulteTrouvee('la dispute est finie'), null);
  assert.strictEqual(automod.insulteTrouvee('ce film est violent'), null);
  assert.strictEqual(automod.insulteTrouvee('j\'habite à Valence'), null);
  assert.strictEqual(automod.insulteTrouvee('une belle constitution'), null);
  assert.strictEqual(automod.insulteTrouvee('un ordinateur'), null);
});


test('insultes anglaises courantes dans les serves de jeu', () => {
  assert.strictEqual(automod.insulteTrouvee('what the fuck'), 'fuck');
  assert.strictEqual(automod.insulteTrouvee('you fucking loser'), 'fucking');
  assert.strictEqual(automod.insulteTrouvee('you fucking bitch'), 'bitch'); // la liste répond à la première racine trouvée
  assert.strictEqual(automod.insulteTrouvee('total dipshit moment'), 'dipshit');
  assert.strictEqual(automod.insulteTrouvee('shitty day'), 'shitty');
  assert.strictEqual(automod.insulteTrouvee('go away loser'), 'loser');
  assert.strictEqual(automod.insulteTrouvee('you piece of shit'), 'shit');
});

test('abréviations SMS françaises (mrd, ptn, ftg, pd…)', () => {
  assert.strictEqual(automod.insulteTrouvee('mrd toi'), 'mrd');
  assert.strictEqual(automod.insulteTrouvee("ptn c'est fini"), 'ptn');
  assert.strictEqual(automod.insulteTrouvee('ftg'), 'ftg');
  assert.strictEqual(automod.insulteTrouvee('bande de pd'), 'pd');
});

test('le vocabulaire du quotidien ne tombe jamais dans le panneau', () => {
  assert.strictEqual(automod.insulteTrouvee('j\'ai du retard dans mes devoirs'), null);
  assert.strictEqual(automod.insulteTrouvee('on sort les ordures ménagères'), null);
  assert.strictEqual(automod.insulteTrouvee('je prends ma douche puis au dodo'), null);
  assert.strictEqual(automod.insulteTrouvee('une bonne connexion internet'), null);
  assert.strictEqual(automod.insulteTrouvee('ce film est violent et les_connards_dans_la_salle rient'), 'connard');
});

test('insultes : les nouvelles formes gaming tombent', () => {
  for (const t of ['t\'es qu\'un minable', 'sale noob', 'n00b', 't\'es une nenette', 'stfu', 'kheum de merde', 't\'es un attardé']) {
    assert.ok(automod.insulteTrouvee(t), `manquant : ${t}`);
  }
});

test('insultes : les nouveaux mots ne mordent pas sur le français normal', () => {
  for (const t of ['je ne vais pas m\'attarder', 'le nouveau patch est nul', 'on a gagné sans chichi',
    'la minoterie tourne bien', 'stfuvem pas qui je suis']) {
    assert.strictEqual(automod.insulteTrouvee(t), null, `faux positif : ${t}`);
  }
});

test('flood : caractères ou mots répétés en masse → suppression', () => {
  assert.ok(automod.floodDeCaracteres('aaaaaaaaaaaaaa'));
  assert.ok(automod.floodDeCaracteres('non non non non non non non non'));
  assert.ok(!automod.floodDeCaracteres('je viens au stream ce soir ?'), 'phrase normale = pas du flood');
  assert.ok(!automod.floodDeCaracteres('https://exemple.com/page?x=aaaaaaaaaaaa'), 'les liens ne sont pas du flood');
  const r = automod.analyser('AAAAAAAAAAAAAAA', { reglages: { spam: true } });
  assert.strictEqual(r.raison, 'flood de caractères');
});

test('liens : masques de redirection et fausses boutiques détectés', () => {
  assert.ok(automod.lienMalveillant('clique ici http://bit.ly/3x9F pour ton nitro'));
  assert.ok(automod.lienMalveillant('récupère https://linkvertise.com/9987/gift'));
  assert.ok(automod.lienMalveillant('visite https://discord-nitro.shop pour claim'));
  assert.ok(automod.lienMalveillant('ton compte a été suspendu, remplis ce formulaire https://verif.moncompte.cyou'));
  assert.ok(automod.lienMalveillant('rejoins dliscord.gg/main'));
  assert.strictEqual(automod.lienMalveillant('mon stream est sur twitch.tv/paul'), null);
});

test('liens écrits nus sont comptés comme les vrais liens', () => {
  assert.strictEqual(automod.compteLiens('va sur exemple.com puis test.fr'), 2);
  assert.strictEqual(automod.compteLiens('https://a.fr et https://b.fr et exemple.com'), 3);
  const r = automod.analyser('a.com b.com c.com d.com', { reglages: { liens: true } });
  assert.strictEqual(r.raison, 'trop de liens');
});

module.exports = { nom: 'automod', cas };
if (require.main === module) require('./executeur')(module.exports);
