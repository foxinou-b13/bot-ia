const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { chargerCommandes, fichiersCommandes } = require('../utils/commandes');

const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

const { commandes, problemes } = chargerCommandes();

test('toutes les commandes se chargent sans erreur', () => {
  assert.deepStrictEqual(problemes, []);
  assert.ok(commandes.size >= 16, `seulement ${commandes.size} commandes`);
});

test('chaque commande a un nom, une description et un exécuteur', () => {
  for (const [nom, cmd] of commandes) {
    const json = cmd.data.toJSON();
    assert.strictEqual(json.name, nom);
    assert.ok(json.description && json.description.length > 5, `description trop courte : /${nom}`);
    assert.strictEqual(typeof cmd.executer, 'function');
  }
});

test('les descriptions sont en français (pas de jargon anglais)', () => {
  for (const [nom, cmd] of commandes) {
    const d = cmd.data.toJSON().description.toLowerCase();
    const interdits = ['ban a user', 'kick a user', 'this command', 'set the', 'manage the'];
    for (const mot of interdits) {
      assert.ok(!d.includes(mot), `/${nom} : description anglaise « ${mot} »`);
    }
  }
});

test('les noms de commandes respectent le format Discord', () => {
  for (const nom of commandes.keys()) {
    assert.ok(/^[a-z0-9-]{1,32}$/.test(nom), `nom invalide : ${nom}`);
  }
});

test('aucune option ne dépasse 25 (limite Discord)', () => {
  for (const [nom, cmd] of commandes) {
    const options = cmd.data.toJSON().options || [];
    assert.ok(options.length <= 25, `/${nom} a ${options.length} options`);
    for (const o of options) {
      assert.ok(/^[a-z0-9_-]{1,32}$/.test(o.name), `option invalide : /${nom} ${o.name}`);
      assert.ok(o.description, `option sans description : /${nom} ${o.name}`);
      assert.ok(o.description.length <= 100, `description d'option trop longue : /${nom} ${o.name}`);
    }
  }
});

test('toutes les commandes de modération exigent une permission', () => {
  for (const [nom, cmd] of commandes) {
    if ((cmd.categorie || '') !== 'moderation') continue;
    const json = cmd.data.toJSON();
    assert.ok(json.default_member_permissions, `/${nom} n'exige aucune permission`);
  }
});

test('chaque fichier de commands/ est bien chargé (aucun orphelin)', () => {
  const fichiers = fichiersCommandes();
  assert.ok(fichiers.length >= commandes.size, 'un fichier a été ignoré');
  for (const f of fichiers) {
    const cheminF = path.join(__dirname, '..', 'commands', f);
    assert.ok(fs.existsSync(cheminF), `${f} introuvable`);
  }
});

test('les commandes sensibles utilisent deferReply (pas de timeout Discord)', () => {
  for (const nom of ['ban', 'kick', 'mute', 'warn', 'clear']) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'commands', `${nom}.js`), 'utf8');
    assert.ok(source.includes('deferReply'), `/${nom} n'utilise pas deferReply`);
  }
});

test('aucune commande ne répond en anglais à l\'utilisateur', () => {
  for (const fichier of fichiersCommandes()) {
    const source = fs.readFileSync(path.join(__dirname, '..', 'commands', fichier), 'utf8');
    for (const mot of ['Something went wrong', 'You do not have', 'Command failed']) {
      assert.ok(!source.includes(mot), `${fichier} contient « ${mot} »`);
    }
  }
});

module.exports = { nom: 'commandes', cas };

if (require.main === module) require('./executeur')(module.exports);
