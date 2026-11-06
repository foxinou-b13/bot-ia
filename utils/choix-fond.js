/**
 * utils/choix-fond.js — le choix de l'image de fond, SANS MP et SANS URL.
 *
 *   1. l'admin touche « 📱 Choisir une image » dans /config → Image de fond ;
 *   2. le bot poste un petit message dans le salon : « réponds-moi avec ton image » ;
 *   3. l'admin répond avec 📎 → galerie du téléphone / fichiers du PC ;
 *   4. le bot vérifie, enregistre, efface les deux messages, et poste l'aperçu
 *      réel de la carte. Rien ne traîne dans le salon.
 *
 * (La modale « joindre un fichier » n'existe pas dans l'API de Discord :
 *  elle refuse tout type de champ autre que le texte — testé en live le
 *  06/11/2026, logs Render « UNION_TYPE_CHOICES: must be one of (4,) ».
 *  Ne pas réintroduire cette piste.)
 */
const stockage = require('./stockage');
const bienvenueImage = require('./bienvenue-image');

const DELAI_ATTENTE = 10 * 60 * 1000;          // 10 minutes pour répondre
const TAILLE_MAX = 8 * 1024 * 1024;            // même garde-fou que le générateur
const enAttente = new Map();                   // userId → { guildId, messageId, prompt, expire }

/** L'admin a touché le bouton : on guette sa réponse au message « prompt ». */
function demander(interaction, prompt) {
  enAttente.set(interaction.user.id, {
    guildId: interaction.guildId,
    messageId: prompt?.id ?? null,
    prompt: prompt ?? null,
    expire: Date.now() + DELAI_ATTENTE,
  });
}

function chercherEnAttente(userId) {
  const attente = enAttente.get(userId);
  if (!attente) return null;
  if (attente.expire < Date.now()) { enAttente.delete(userId); return null; }
  return attente;
}

/** Une pièce jointe « image » dans ce message ? */
function trouverImage(message) {
  const pieces = [...(message.attachments?.values ? message.attachments.values() : [])];
  return pieces.find((a) => String(a.content_type || a.contentType || '').startsWith('image/')
    || /\.(png|jpe?g|webp|gif|bmp)$/i.test(a.name || a.filename || '')) || null;
}

async function effacer(m) {
  try { if (m && typeof m.delete === 'function') await m.delete(); } catch { /* déjà parti */ }
}

/**
 * Appelé pour CHAQUE message de salon : si c'est la réponse attendue d'un admin,
 * on traite l'image et on nettoie tout.
 * @returns {Promise<boolean>} true = message consommé, ne pas le modérer/éviter les doublons.
 */
async function traiterReponse(message) {
  if (message.author?.bot) return false;
  const attente = enAttente.get(message.author.id);
  if (!attente || attente.guildId !== message.guild?.id) return false;

  const repondA = message.messageReference?.messageId ?? message.messageReference?.message_id ?? null;
  if (repondA !== attente.messageId) return false;    // pas la réponse qu'on attendait : ignorer

  const image = trouverImage(message);
  if (!image) {
    await message.reply({
      content: "🖼️ Réponds avec une **image** (jpg, png, webp…) — touche le trombone 📎 de la réponse.",
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    return true;
  }
  if (Number(image.size) > TAILLE_MAX) {
    await message.reply({
      content: '⚖️ Cette image dépasse 8 Mo — envoie une version plus légère.',
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    return true;
  }

  // ── téléchargement + vérification AVANT d'effacer quoi que ce soit ──
  const url = image.url || image.proxy_url;
  let tampon = null;
  try {
    tampon = await bienvenueImage.chargerImage(bienvenueImage.optimiserUrl(url))
      .catch(() => bienvenueImage.chargerImage(url));
    await require('@napi-rs/canvas').loadImage(tampon);
  } catch { tampon = null; }

  if (!tampon) {
    await message.reply({
      content: '🖼️ Je n\'ai pas réussi à lire cette image — retente avec un jpg ou un png classique.',
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    return true;
  }

  // ── on enregistre (si un jour le message source est supprimé, le fond par défaut reprend) ──
  const b = stockage.reglages(attente.guildId).bienvenue || {};
  stockage.majReglages(attente.guildId, { bienvenue: { ...b, fond: url } });
  enAttente.delete(message.author.id);

  const canal = message.channel;
  try {
    const png = await bienvenueImage.composer({
      fondBuffer: tampon,
      pseudo: message.author.username || 'Aperçu',
      langue: b.langue || 'fr',
    });
    await canal.send({
      content: `${message.author}, voici l'aperçu réel de ta carte de bienvenue 🎉 (message effacé automatiquement)`,
      embeds: [{
        color: 0x5865f2,
        title: '✅ Fond enregistré',
        description: 'Ta carte de bienvenue utilisera cette image, recadrée toute seule au bon format. '
          + 'Pour revenir au fond par défaut : /config → Accueil → Image de fond → « 🌸 Fond par défaut ».',
      }],
      files: [{ name: 'apercu-bienvenue.png', attachment: png }],
      allowedMentions: { users: [message.author.id] },
    });
  } catch {
    await canal.send({ content: `✅ Fond enregistré, ${message.author} ! (aperçu impossible ici, mais les cartes l'utiliseront.)`,
      allowedMentions: { users: [message.author.id] } }).catch(() => null);
  }

  // ── nettoyage : le message-invitation et la réponse avec l'image disparaissent ──
  await effacer(message);
  await effacer(attente.prompt);
  return true;
}

module.exports = {
  demander, chercherEnAttente, traiterReponse, trouverImage,
  __enAttente: enAttente,          // pour les tests uniquement
};
