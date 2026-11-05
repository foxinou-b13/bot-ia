/**
 * deploy-commands.js — enregistre les commandes auprès de Discord.
 * À lancer une fois, et à chaque fois que tu ajoutes ou modifies une commande.
 *   node deploy-commands.js
 */
const { config } = require('./config');
const { chargerCommandes } = require('./utils/commandes');
const { enregistrerCommandes } = require('./utils/enregistrer');

async function principal() {
  if (!config.token || !config.botId) {
    console.error('❌ DISCORD_TOKEN et BOT_ID doivent être renseignés dans .env');
    process.exit(1);
  }

  const { commandes, problemes } = chargerCommandes();
  if (problemes.length) {
    console.warn('⚠️ Commandes ignorées :');
    for (const p of problemes) console.warn('   ·', p);
  }

  console.log(`📤 Envoi de ${commandes.size} commande(s) à Discord…`);
  const resultat = await enregistrerCommandes({ commands: commandes });
  if (!resultat.ok) {
    console.error('❌ Échec de l\'enregistrement :', resultat.raison);
    process.exit(1);
  }
  console.log('   Patiente 1 à 5 minutes si elles n\'apparaissent pas tout de suite.');
}

principal();
