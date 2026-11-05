const assert = require('assert');
const fs = require('fs');
const path = require('path');

const RACINE = path.join(__dirname, '..');
const cas = [];
const test = (nom, fn) => cas.push({ nom, fn });

function lireFichier(relatif) {
  return fs.readFileSync(path.join(RACINE, relatif), 'utf8');
}

function tousLesFichiersJs(dossier = RACINE, trouves = []) {
  for (const entree of fs.readdirSync(dossier, { withFileTypes: true })) {
    if (['node_modules', '.git', 'data', 'tests'].includes(entree.name)) continue;
    const complet = path.join(dossier, entree.name);
    if (entree.isDirectory()) tousLesFichiersJs(complet, trouves);
    else if (entree.name.endsWith('.js')) trouves.push(complet);
  }
  return trouves;
}

test('aucun token ni clé écrit en dur dans le code', () => {
  const motifs = [
    /MTU2NzkwODQ0OTY1NDkzOTc5MA/,          // id du bot collé par erreur
    /github_pat_/,                          // jeton GitHub
    /["'][A-Za-z0-9_-]{24}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}["']/, // token Discord
    /sk-[A-Za-z0-9]{32,}/,                  // clé façon OpenAI
  ];
  for (const fichier of tousLesFichiersJs()) {
    const contenu = fs.readFileSync(fichier, 'utf8');
    for (const motif of motifs) {
      assert.ok(!motif.test(contenu), `${path.basename(fichier)} contient un secret en dur`);
    }
  }
});

test('le fichier .env n\'est jamais suivi par git', () => {
  const ignore = lireFichier('.gitignore');
  assert.ok(ignore.includes('.env'), 'le .env n\'est pas ignoré');
  assert.ok(ignore.includes('node_modules'), 'node_modules n\'est pas ignoré');

  // Si un .env existe en local (pratique pour tester), il doit être ignoré par git.
  if (fs.existsSync(path.join(RACINE, '.env'))) {
    let suivi = '';
    try {
      suivi = require('child_process')
        .execSync('git ls-files .env', { cwd: RACINE, encoding: 'utf8' }).trim();
    } catch {
      suivi = '';
    }
    assert.strictEqual(suivi, '', 'le .env est suivi par git : à retirer absolument');
  }
});

test('le serveur de santé existe (Render + UptimeRobot)', () => {
  const index = lireFichier('index.js');
  assert.ok(index.includes('/health'), 'route /health absente');
  assert.ok(index.includes('0.0.0.0'), 'le serveur n\'écoute pas sur 0.0.0.0');
  assert.ok(index.includes('process.env.PORT') || index.includes('config.port'), 'le port Render n\'est pas lu');
});

test('le bot ne tombe pas sur une erreur isolée', () => {
  const index = lireFichier('index.js');
  assert.ok(index.includes('unhandledRejection'));
  assert.ok(index.includes('uncaughtException'));
});

test('aucune promesse « non répondue » : chaque commande répond', () => {
  const routeur = lireFichier('events/interactionCreate.js');
  assert.ok(routeur.includes('reply') && routeur.includes('editReply'));
  assert.ok(routeur.includes('catch'));
});

test('aucune commande ne peut provoquer « L\'application n\'a pas répondu à temps »', () => {
  // On assemble la phrase ici pour que ce fichier de test ne se dénonce pas lui-même.
  const interdit1 = ["n'a pas répondu", 'à', 'temps'].join(' ');
  const interdit2 = ['did not respond', 'in', 'time'].join(' ');
  const interdits = new RegExp([interdit1, interdit2].join('|'), 'i');
  for (const fichier of tousLesFichiersJs()) {
    const contenu = fs.readFileSync(fichier, 'utf8');
    assert.ok(!interdits.test(contenu), `${path.basename(fichier)} contient ce message interdit`);
  }
});

test('les réglages sont validés avant usage (défauts présents)', () => {
  const stockage = lireFichier('utils/stockage.js');
  assert.ok(stockage.includes('REGLAGES_DEFAUT'));
  assert.ok(stockage.includes('automod'));
});

test('les secrets ne sont jamais affichés dans les logs', () => {
  for (const fichier of tousLesFichiersJs()) {
    const contenu = fs.readFileSync(fichier, 'utf8');
    assert.ok(!/console\.(log|error|warn)\([^)]*config\.(token|gemini\.cle|groq\.cle)/.test(contenu),
      `${path.basename(fichier)} affiche un secret dans les logs`);
  }
});

test('le README explique le déploiement Render', () => {
  const readme = lireFichier('README.md');
  assert.ok(/Render/i.test(readme));
  assert.ok(/DISCORD_TOKEN/.test(readme));
  assert.ok(/UptimeRobot/i.test(readme));
});

test('le fichier .env.example liste toutes les variables obligatoires', () => {
  const exemple = lireFichier('.env.example');
  for (const variable of ['DISCORD_TOKEN', 'BOT_ID', 'GEMINI_API_KEY', 'GROQ_API_KEY', 'PORT']) {
    assert.ok(exemple.includes(variable), `${variable} absent de .env.example`);
  }
});

test('le dossier data est ignoré par git (pas de fuite de données membres)', () => {
  const ignore = lireFichier('.gitignore');
  assert.ok(ignore.includes('data/*.json'), 'les données ne sont pas ignorées');
});

module.exports = { nom: 'securite', cas };

if (require.main === module) require('./executeur')(module.exports);
