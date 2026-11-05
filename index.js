/**
 * index.js — démarrage du bot Otaku.
 *
 * Ce fichier fait trois choses :
 *   1. démarre le bot Discord (commandes + événements)
 *   2. ouvre un petit serveur web /health pour Render et UptimeRobot
 *   3. empêche le bot de s'arrêter sur une erreur isolée
 */
const http = require('http');
const { Client, Collection, GatewayIntentBits, Partials } = require('discord.js');
const { config, verifierConfig, fournisseursIA } = require('./config');
const { chargerCommandes } = require('./utils/commandes');
const { DOSSIER } = require('./utils/stockage');

// ─────────────────────────── 1. le bot ───────────────────────────
// Intents « privilégiés » : à activer dans le portail Discord (voir README).
// Si le portail ne les a pas encore activés, le bot redémarre en mode dégradé
// au lieu de tomber : les commandes restent utilisables.
const INTENTS_COMPLET = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
  GatewayIntentBits.MessageContent,
  GatewayIntentBits.GuildMembers,
];

const INTENTS_MINIMAL = [
  GatewayIntentBits.Guilds,
  GatewayIntentBits.GuildMessages,
];

const EVENEMENTS = [
  require('./events/ready'),
  require('./events/interactionCreate'),
  require('./events/messageCreate'),
  require('./events/guildMemberAdd'),
];

/** Crée un client complet, avec ses commandes et ses événements. */
function creerClient(intents) {
  const nouveau = new Client({ intents, partials: [Partials.Channel] });
  nouveau.commands = new Collection();

  const { commandes, problemes } = chargerCommandes();
  for (const [nom, commande] of commandes) nouveau.commands.set(nom, commande);
  if (nouveau.commands.size) {
    console.log(`📦 ${nouveau.commands.size} commande(s) chargée(s)`);
  }
  if (problemes.length) {
    console.warn('⚠️ Commandes ignorées :');
    for (const p of problemes) console.warn('   ·', p);
  }

  for (const evenement of EVENEMENTS) {
    const gestion = (...args) => Promise.resolve(evenement.executer(nouveau, ...args))
      .catch((erreur) => console.error(`⚠️ Événement ${evenement.nom} :`, erreur));
    if (evenement.uneFois) nouveau.once(evenement.nom, gestion);
    else nouveau.on(evenement.nom, gestion);
  }

  return nouveau;
}

let client = creerClient(INTENTS_COMPLET);

// ─────────────────────────── 2. santé (Render / UptimeRobot) ───────────────────────────
const demarre = Date.now();

function etatJson() {
  return {
    statut: 'ok',
    bot: client.user ? client.user.tag : 'démarrage',
    connecte: client.isReady ? client.isReady() : false,
    serveurs: client.guilds?.cache?.size ?? 0,
    ping: client.ws?.ping ?? null,
    ia: fournisseursIA(),
    version: config.version,
    enLigneDepuisSecondes: Math.floor((Date.now() - demarre) / 1000),
  };
}

function demarrerServeur() {
  const serveur = http.createServer((requete, reponse) => {
    const url = (requete.url || '/').split('?')[0];
    if (url === '/health' || url === '/') {
      const corps = JSON.stringify(etatJson());
      reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return reponse.end(corps);
    }
    if (url === '/test-ia') {
      // Teste les vraies clés IA depuis le serveur : indispensable pour dépanner.
      const ia = require('./utils/ia');
      ia.demander({ systeme: 'Réponds en un mot.', messages: [{ role: 'user', contenu: 'Dis OK' }] })
        .then((r) => {
          reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          reponse.end(JSON.stringify({ ok: true, fournisseur: r.fournisseur, reponse: r.texte.slice(0, 200) }));
        })
        .catch((erreur) => {
          reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          reponse.end(JSON.stringify({ ok: false, erreur: erreur.message, details: erreur.details }, null, 2));
        });
      return;
    }
    if (url === '/diagnostic') {
      const corps = JSON.stringify({
        ...etatJson(),
        commandes: [...client.commands.keys()].sort(),
        memoireMo: Math.round(process.memoryUsage().rss / 1048576),
        node: process.version,
        commit: process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || 'inconnu',
        modeles: { gemini: config.gemini.modele, groq: config.groq.modele },
      }, null, 2);
      reponse.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      return reponse.end(corps);
    }
    reponse.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return reponse.end('Introuvable');
  });

  serveur.on('error', (erreur) => console.error('⚠️ Serveur web :', erreur.message));
  serveur.listen(config.port, '0.0.0.0', () => {
    console.log(`🌐 Santé du bot : http://0.0.0.0:${config.port}/health`);
  });
  return serveur;
}

// ─────────────────────────── 3. démarrage ───────────────────────────
const verification = verifierConfig();
if (!verification.ok) {
  console.warn('⚠️ Configuration incomplète :');
  for (const p of verification.problemes) console.warn('   ·', p);
}

if (!config.token) {
  console.error('❌ DISCORD_TOKEN manquant : le bot ne peut pas se connecter.');
  console.error('   Ajoute la variable DISCORD_TOKEN dans Render (Environment), puis redémarre.');
} else {
  demarrerServeur();
  client.login(config.token).catch(async (erreur) => {
    // Code 4014 : le portail Discord n'autorise pas encore les intents privilégiés.
    if (erreur.code === 'DisallowedIntents' || /disallowed intents/i.test(erreur.message)) {
      console.warn('⚠️ Le portail Discord refuse les intents privilégiés.');
      console.warn('   → Developer Portal → Bot → active « Message Content Intent » et « Server Members Intent ».');
      console.warn('   Je redémarre en mode dégradé : commandes OK, surveillance des messages en pause.');
      try {
        client.removeAllListeners();
        client.destroy();
        client = creerClient(INTENTS_MINIMAL);
        await client.login(config.token);
        console.log('✅ Connecté en mode dégradé (commandes seulement).');
        return;
      } catch (seconde) {
        console.error('❌ Connexion impossible même en mode dégradé :', seconde.message);
        return;
      }
    }
    console.error('❌ Connexion impossible :', erreur.message);
    console.error('   Vérifie que le token est bon et qu\'un seul bot utilise ce token.');
  });
}

// Le bot ne doit jamais tomber à cause d'une promesse oubliée.
process.on('unhandledRejection', (raison) => {
  console.error('⚠️ Promesse non gérée :', raison?.message || raison);
});
process.on('uncaughtException', (erreur) => {
  console.error('⚠️ Exception non attrapée :', erreur?.message || erreur);
});
process.on('SIGTERM', () => {
  console.log('👋 Arrêt demandé par Render, je me déconnecte proprement.');
  client.destroy();
  process.exit(0);
});

module.exports = { get client() { return client; } };
