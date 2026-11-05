/**
 * utils/persistance.js — la mémoire durable du bot (optionnelle).
 *
 * Render gratuit efface le disque à chaque redéploiement. Si une base
 * MongoDB gratuite (Atlas) est indiquée via MONGODB_URI, le bot :
 *   - RESTAURE ses fichiers (réglages, avertissements) au démarrage ;
 *   - renvoie chaque écriture dans la base, en différé (files d'attente).
 *
 * Sans MONGODB_URI, tout continue de fonctionner en local (mode fichier).
 * Une panne de base ne doit JAMAIS arrêter le bot : tout est enveloppé.
 */
const fs = require('fs');
const path = require('path');

const DOSSIER = path.join(__dirname, '..', 'data');
const COLLECTION = 'fichiers';

let client = null;          // client MongoDB réel ou simulé (tests)
let fiabilite = 'fichier';  // 'fichier' | 'mongo'
let restaures = 0;

const fileAttente = new Map();   // nom → données à renvoyer
let minuteur = null;
let enCours = false;

function uriBase() {
  return (process.env.MONGODB_URI || '').trim();
}

/** Injecté par les tests (et seulement eux) : un faux client qui imite l'API mongodb. */
function injecterClient(faux) {
  client = faux;
  fiabilite = faux ? 'mongo' : 'fichier';
}

/** Connexion au démarrage. Retourne true si la base est utilisable. */
async function initialiser(options = {}) {
  const uri = options.uri !== undefined ? options.uri : uriBase();
  if (!uri) return false;
  if (options.client) { injecterClient(options.client); return true; }
  try {
    const { MongoClient } = require('mongodb');
    const nouveau = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
    await nouveau.connect();
    client = nouveau;
    fiabilite = 'mongo';
    return true;
  } catch (erreur) {
    console.error('⚠️ Base de données injoignable → mode fichier local :', erreur.message);
    client = null;
    fiabilite = 'fichier';
    return false;
  }
}

function collection() {
  if (!client) return null;
  const base = (process.env.MONGODB_BASE || 'otaku').trim() || 'otaku';
  return client.db(base).collection(COLLECTION);
}

/** Au démarrage : écrire sur le disque tout ce que la base connaît. */
async function restaurer() {
  restaures = 0;
  const coll = collection();
  if (!coll) return 0;
  try {
    const docs = await coll.find({}).toArray();
    if (!fs.existsSync(DOSSIER)) fs.mkdirSync(DOSSIER, { recursive: true });
    for (const doc of docs) {
      const nom = String(doc._id || '').replace(/[^a-z0-9_-]/gi, '');
      if (!nom || doc.contenu === undefined) continue;
      fs.writeFileSync(path.join(DOSSIER, `${nom}.json`), JSON.stringify(doc.contenu, null, 1), 'utf8');
      restaures += 1;
    }
    return restaures;
  } catch (erreur) {
    console.error('⚠️ Restauration de la base impossible (je démarre à vide) :', erreur.message);
    return 0;
  }
}

/** Miroir d'écriture : on note ce qu'il faut envoyer, on envoie très vite après. */
function publier(nom, donnees) {
  if (fiabilite !== 'mongo') return false;
  fileAttente.set(nom, donnees);
  if (!minuteur) {
    minuteur = setTimeout(() => { minuteur = null; viderFile(); }, 1200);
    if (minuteur.unref) minuteur.unref();     // n'empêche pas le processus de fermer
  }
  return true;
}

async function viderFile() {
  if (enCours || fileAttente.size === 0) return;
  const coll = collection();
  if (!coll) return;
  enCours = true;
  const lots = [...fileAttente.entries()];
  fileAttente.clear();
  for (const [nom, donnees] of lots) {
    try {
      await coll.replaceOne({ _id: nom }, { _id: nom, contenu: donnees, maj: new Date() }, { upsert: true });
    } catch (erreur) {
      // on remet à la file : la prochaine écriture ou terminer() réessaiera.
      if (!fileAttente.has(nom)) fileAttente.set(nom, donnees);
      console.error(`⚠️ Sauvegarde « ${nom} » en échec (nouvel essai prévu) :`, erreur.message);
    }
  }
  enCours = false;
  if (fileAttente.size && !minuteur) {
    minuteur = setTimeout(() => { minuteur = null; viderFile(); }, 5000);
    if (minuteur.unref) minuteur.unref();
  }
}

/** À l'arrêt (SIGTERM) : on pousse le reste puis on ferme. */
async function terminer(delaiMs = 4000) {
  if (minuteur) { clearTimeout(minuteur); minuteur = null; }
  if (fiabilite === 'mongo') {
    await Promise.race([vidFilePromise(), new Promise((r) => setTimeout(r, delaiMs))]);
    try { await client?.close(); } catch { /* rien */ }
  }
  client = null;
}

function vidFilePromise() {
  // attend que la file soit partie (borne haute : delaiMs côté appelant)
  return new Promise((resolve) => {
    const verifier = () => {
      if (fileAttente.size === 0 && !enCours) return resolve();
      return setTimeout(verifier, 100);
    };
    viderFile();
    verifier();
  });
}

function etat() {
  return { mode: fiabilite, enAttente: fileAttente.size, restaures };
}

module.exports = {
  initialiser, restaurer, publier, terminer, etat,
  injecterClient,   // tests uniquement
  _fileAttente: fileAttente,
};
