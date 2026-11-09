/**
 * tests/commandes-propres.test.js — la cohérence « promesse ↔ réalité ».
 *
 * Un bot pro ne promet pas ce qui n'existe pas et ne cache pas ce qui existe :
 *   1. chaque commande réellement chargée est citée dans /aide ;
 *   2. chaque commande citée dans /aide existe vraiment ;
 *   3. la consigne système de l'IA les connaît toutes (elle ne doit jamais
 *      répondre « cette commande n'existe » devant une commande qui existe) ;
 *   4. /automod seul affiche l'état complet (plus de choix obligatoire) et
 *      retire proprement une exemption sans champ salon ;
 *   5. le vocabulaire « journal » est cohérent partout (promesses véridiques).
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const stockage = require('../utils/stockage');

const DOSSIER_COMMANDES = path.join(__dirname, '..', 'commands');

const cas = [];
function test(nom, fn) { cas.push({ nom, fn }); }

/** Toutes les commandes réelles, par nom Discord. */
function commandesReelles() {
  const parNom = new Map();
  for (const fichier of fs.readdirSync(DOSSIER_COMMANDES).filter((f) => f.endsWith('.js'))) {
    const commande = require(path.join(DOSSIER_COMMANDES, fichier));
    if (commande && commande.data && typeof commande.data.setName === 'function') {
      parNom.set(commande.data.toJSON().name, commande);
    }
  }
  return parNom;
}

function texteAide() {
  let rendu = null;
  const aide = require(path.join(DOSSIER_COMMANDES, 'aide.js'));
  const inter = {
    reply: async (p) => { rendu = p; },
    followUp: async (p) => { rendu = p; },
    deferred: false,
    replied: false,
  };
  // /aide répond publiquement-éphémère via panneaux.repondre → reply suffit.
  return aide.executer(inter).then(() => {
    const embed = rendu.embeds[0];
    return (embed.toJSON ? embed.toJSON() : embed).description || '';
  });
}

test('/aide cite TOUTES les commandes réelles (aucune commande orpheline)', async () => {
  const description = await texteAide();
  const oubliees = [...commandesReelles().keys()].filter((nom) => !description.includes(`\`/${nom}\``));
  assert.deepStrictEqual(oubliees, [], `/aide oublie : ${oubliees.join(', ')}`);
});

test('tout ce que /aide cite existe vraiment (aucun fantôme)', async () => {
  const description = await texteAide();
  const citees = [...description.matchAll(/`\/([a-z-]+)`/g)].map((m) => m[1]);
  const reelles = new Set(commandesReelles().keys());
  const fantomes = citees.filter((nom) => !reelles.has(nom));
  assert.deepStrictEqual(fantomes, [], `/aide promet des commandes qui n'existent pas : ${fantomes.join(', ')}`);
});

test("la consigne IA connaît toutes les commandes réelles (elle ne dira pas « ça n'existe pas »)", () => {
  const ia = require('../utils/ia');
  const consigne = ia.consigneSysteme({});
  const manquantes = [...commandesReelles().keys()].filter((nom) => !consigne.includes(`/${nom}`));
  assert.deepStrictEqual(manquantes, [], `invisibles pour l'IA : ${manquantes.join(', ')}`);
});

test('/automod : plus de choix obligatoire — `/automod` seul affiche l\u2019état complet', () => {
  const automod = require(path.join(DOSSIER_COMMANDES, 'automod.js'));
  const data = automod.data.toJSON();
  const optionModule = data.options.find((o) => o.name === 'module');
  assert.ok(optionModule, 'option module absente');
  assert.notStrictEqual(optionModule.required, true, '« module » doit être optionnel pour voir l\u2019état d\u2019un seul coup');
});

test('/automod seul : les 5 modules + la formule de sanction, avec le renvoi vers /config', async () => {
  const automod = require(path.join(DOSSIER_COMMANDES, 'automod.js'));
  let rendu = null;
  const inter = {
    guildId: 'G-COMMANDES',
    inGuild: () => true,
    member: { permissions: { has: () => true } },
    options: { getString: () => null, getChannel: () => null },
    reply: async (p) => { rendu = p; },
    followUp: async (p) => { rendu = p; },
    deferred: false, replied: false,
  };
  stockage.majReglages('G-COMMANDES', {
    automod: { spam: true, liens: false, insultes: true, majuscules: false, raid: true, salonExempt: null, sanctionAuto: true, seuilAvert: 5, dureeSanction: 30 },
  });
  await automod.executer(inter);
  const embed = rendu.embeds[0].toJSON ? rendu.embeds[0].toJSON() : rendu.embeds[0];
  const desc = embed.description;
  assert.match(embed.title, /Auto-modération — état/);
  assert.ok(desc.includes('✅ Spam'), 'spam actif attendu : ' + desc);
  assert.ok(desc.includes('⬜ Liens'), 'liens inactifs attendus');
  assert.match(desc, /\*\*5\*\* avertissements → sourdine \*\*30 min\*\*/);
  assert.ok(desc.includes('/config'), 'le renvoi vers le panneau complet manque');
});

test('/automod exempt sans salon : retire l\u2019exemption en place (zéro syntaxe à retenir)', async () => {
  const automod = require(path.join(DOSSIER_COMMANDES, 'automod.js'));
  stockage.majReglages('G-COMMANDES', { automod: { salonExempt: 'S-EXEMPT' } });
  let rendu = null;
  const inter = {
    guildId: 'G-COMMANDES',
    inGuild: () => true,
    member: { permissions: { has: () => true } },
    options: { getString: () => 'exempt', getChannel: () => null },
    reply: async (p) => { rendu = p; },
    followUp: async (p) => { rendu = p; },
    deferred: false, replied: false,
  };
  await automod.executer(inter);
  assert.strictEqual(stockage.reglages('G-COMMANDES').automod.salonExempt, null, 'exemption toujours en place');
  const embed = rendu.embeds[0].toJSON ? rendu.embeds[0].toJSON() : rendu.embeds[0];
  assert.match(embed.title, /Exemption retirée/);
});

test('journal : la description de /logs promet exactement ce que le bot fait', () => {
  const logs = require(path.join(DOSSIER_COMMANDES, 'logs.js'));
  const desc = logs.data.toJSON().description;
  for (const mot of ['sanctions', 'suppressions', 'modifications', 'départs']) {
    assert.ok(desc.includes(mot), `/logs ne parle pas de « ${mot} » alors que le bot le fait : ${desc}`);
  }
  assert.ok(desc.length <= 100, `description de commande trop longue (${desc.length})`);
});

test('guide : le salon d\u2019accueil est annoncé comme accueil, pas comme « se présenter »', async () => {
  const guide = require(path.join(DOSSIER_COMMANDES, 'guide.js'));
  stockage.majReglages('G-COMMANDES', { guide: { regles: 'S-REG', support: 'S-SUP' }, bienvenue: { salon: 'S-ACC' } });
  let rendu = null;
  const inter = {
    guildId: 'G-COMMANDES',
    guild: { name: 'Serveur Test' },
    reply: async (p) => { rendu = p; },
    followUp: async (p) => { rendu = p; },
    deferred: false, replied: false,
  };
  await guide.executer(inter);
  const fields = rendu.embeds[0].toJSON().fields;
  const accueil = fields.find((f) => f.name.includes('accueil'));
  assert.ok(accueil && accueil.value.includes('<#S-ACC>'), 'champ d\u2019accueil manquant : ' + JSON.stringify(fields.map((f) => f.name)));
  assert.ok(!/Se présenter/.test(fields.map((f) => f.name).join(' ')), 'le vieux libellé trompeur est revenu');
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
  console.log(`\ncommandes-propres : ${reussis}/${cas.length}${echecs.length ? ` — ${echecs.length} ÉCHEC(S)` : ' OK ✅'}`);
  process.exit(echecs.length ? 1 : 0);
})();
