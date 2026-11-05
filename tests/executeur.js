/** Exécute une suite de tests et affiche le résultat. */
module.exports = async function executeur(suite) {
  let reussis = 0;
  const echecs = [];
  for (const { nom, fn } of suite.cas) {
    try {
      await fn();
      reussis += 1;
      console.log(`  ✅ ${nom}`);
    } catch (erreur) {
      echecs.push({ nom, erreur });
      console.log(`  ❌ ${nom} → ${erreur.message}`);
    }
  }
  console.log(`\n${suite.nom} : ${reussis}/${suite.cas.length} `
    + (echecs.length ? `— ${echecs.length} ÉCHEC(S)` : 'OK ✅'));
  if (echecs.length) process.exitCode = 1;
};
