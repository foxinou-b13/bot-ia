/**
 * utils/commandes.js — charge les fichiers de commands/ et vérifie qu'ils sont propres.
 */
const fs = require('fs');
const path = require('path');
const { Collection } = require('discord.js');

const DOSSIER = path.join(__dirname, '..', 'commands');

function fichiersCommandes(dossier = DOSSIER) {
  if (!fs.existsSync(dossier)) return [];
  return fs.readdirSync(dossier).filter((f) => f.endsWith('.js')).sort();
}

function chargerCommandes(dossier = DOSSIER) {
  const commandes = new Collection();
  const problemes = [];

  for (const fichier of fichiersCommandes(dossier)) {
    const chemin = path.join(dossier, fichier);
    delete require.cache[require.resolve(chemin)];
    let module;
    try {
      module = require(chemin);
    } catch (erreur) {
      problemes.push(`${fichier} : ${erreur.message}`);
      continue;
    }

    const data = module.data || module.default?.data;
    const executer = module.executer || module.execute || module.default?.executer;

    if (!data || typeof data.toJSON !== 'function') {
      problemes.push(`${fichier} : pas de « data » (SlashCommandBuilder)`);
      continue;
    }
    if (typeof executer !== 'function') {
      problemes.push(`${fichier} : pas de fonction « executer »`);
      continue;
    }
    const nom = data.name;
    if (!nom) {
      problemes.push(`${fichier} : commande sans nom`);
      continue;
    }
    if (commandes.has(nom)) {
      problemes.push(`${fichier} : doublon de la commande /${nom}`);
      continue;
    }

    commandes.set(nom, { ...module, executer, data });
  }

  return { commandes, problemes };
}

module.exports = { chargerCommandes, fichiersCommandes, DOSSIER };
