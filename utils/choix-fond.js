/**
 * utils/choix-fond.js — le parcours « 📱 Choisir ton image », façon naturelle :
 *
 *   1. l'admin touche le bouton dans /config → Accueil → Image de fond ;
 *   2. le bot lui écrit un MP : « envoie-moi l'image » ;
 *   3. sur mobile comme sur PC, Discord ouvre le sélecteur natif (📎 → galerie) ;
 *   4. le bot vérifie, enregistre, et répond avec l'APERÇU réel de la carte.
 *
 * Rien à taper, aucune URL à recopier. Si le MP est impossible, le bouton
 * explique les deux replis (/image-bienvenue ou l'adresse d'image).
 */
const stockage = require('./stockage');
const bienvenueImage = require('./bienvenue-image');

const DELAI_ATTENTE = 10 * 60 * 1000;          // 10 minutes pour envoyer l'image
const TAILLE_MAX = 8 * 1024 * 1024;            // même garde-fou que le générateur
const enAttente = new Map();                   // userId → { guildId, expire }

function demander(interaction) {
  enAttente.set(interaction.user.id, { guildId: interaction.guildId, expire: Date.now() + DELAI_ATTENTE });
}

function chercherEnAttente(userId) {
  const attente = enAttente.get(userId);
  if (!attente) return null;
  if (attente.expire < Date.now()) { enAttente.delete(userId); return null; }
  return attente;
}

/** Une piece jointe « image » dans ce message ? */
function trouverImage(message) {
  const pieces = [...(message.attachments?.values ? message.attachments.values() : [])];
  return pieces.find((a) => String(a.content_type || a.contentType || '').startsWith('image/')
    || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.filename || '')) || null;
}

/**
 * Traite un message reçu en MP par le bot.
 * @returns {Promise<boolean>} true si le message concernait le choix du fond.
 */
async function traiterMp(message) {
  if (message.author?.bot) return false;
  const attente = chercherEnAttente(message.author?.id);
  if (!attente) return false;

  const image = trouverImage(message);
  if (!image) {
    await message.reply({
      content: "🖼️ J'attends ton image ! Envoie-la comme une pièce jointe normale "
        + "(bouton 📎 du clavier Discord → galerie ou fichiers). Pour annuler : ignore ce message, il expirera tout seul.",
    }).catch(() => null);
    return true;
  }

  const tailleOk = !image.size || Number(image.size) <= TAILLE_MAX;
  const url = image.url || image.proxy_url;
  let tampon = null;
  try {
    tampon = tailleOk ? await bienvenueImage.chargerImage(url) : null;
    if (tampon) await require('@napi-rs/canvas').loadImage(tampon);   // vérifie qu'elle se décode
  } catch { tampon = null; }

  if (!tampon) {
    await message.reply({
      content: '⚠️ Cette image est illisible ou trop lourde (maxi 8 Mo). '
        + 'Réessaie — ou envoie simplement la suivante.',
    }).catch(() => null);
    return true;
  }

  // ── on enregistre (URL de Discord ; si un jour elle casse, le fond par défaut reprend) ──
  stockage.majReglages(attente.guildId, { bienvenue: { fond: url } });
  enAttente.delete(message.author.id);

  const reglages = stockage.reglages(attente.guildId).bienvenue || {};
  let paquet;
  try {
    const png = await bienvenueImage.composer({
      fondBuffer: tampon,
      pseudo: message.author.username || 'Aperçu',
      langue: reglages.langue || 'fr',
    });
    paquet = {
      embeds: [{
        color: 0x5865f2,
        title: '✅ Fond enregistré — voilà l’aperçu de la carte',
        description: 'Ta carte de bienvenue utilisera cette image (recadrée automatiquement au bon format). '
          + 'Pour revenir au fond par défaut : /config → Accueil → Image de fond → « 🌸 Fond par défaut ».',
      }],
      files: [{ name: 'apercu-bienvenue.png', attachment: png }],
    };
  } catch {
    paquet = { content: '✅ Fond enregistré ! (Impossible de générer l’aperçu ici, mais les cartes l’utiliseront.)' };
  }
  await message.reply(paquet).catch(() => null);
  return true;
}

module.exports = {
  demander, chercherEnAttente, traiterMp, trouverImage,
  __enAttente: enAttente,          // pour les tests uniquement
};
