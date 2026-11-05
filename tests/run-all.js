/**
 * tests/run-all.js — lance toutes les suites, chacune dans son propre processus
 * (pour éviter que les variables d'environnement d'un test polluent l'autre).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DOSSIER = __dirname;
const suites = fs.readdirSync(DOSSIER)
  .filter((f) => f.endsWith('.test.js'))
  .sort();

let total = 0;
let echecsSuites = 0;
const bilans = [];

for (const suite of suites) {
  const nom = suite.replace('.test.js', '');
  process.stdout.write(`\n── ${nom} ──\n`);
  try {
    const sortie = execFileSync(process.execPath, [path.join(DOSSIER, suite)], {
      encoding: 'utf8',
      env: { ...process.env, NODE_ENV: 'test' },
    });
    process.stdout.write(sortie);
    const ligne = sortie.trim().split('\n').pop() || '';
    bilans.push(`${nom} : ${ligne}`);
    total += 1;
  } catch (erreur) {
    echecsSuites += 1;
    process.stdout.write(erreur.stdout || '');
    process.stderr.write(erreur.stderr || '');
    bilans.push(`${nom} : ÉCHEC`);
  }
}

console.log('\n════════════════════ BILAN ════════════════════');
for (const b of bilans) console.log(' · ' + b);
console.log(`\n${suites.length - echecsSuites}/${suites.length} suite(s) verte(s)`
  + (echecsSuites ? ` — ${echecsSuites} en échec ❌` : ' ✅'));
process.exitCode = echecsSuites ? 1 : 0;
