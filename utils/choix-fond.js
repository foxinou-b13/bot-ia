/**
 * utils/choix-fond.js — le choix de l'image de fond : sans MP, sans URL, sans message dans le salon.
 *
 * La voie officielle (structure vérifiée dans la doc de Discord,
 * « Components Reference → File Upload », et dans discordjs.guide → Modals → File upload) :
 *   un tap sur le bouton → showModal() OUVRE DE LUI-MÊME la fenêtre native
 *   contenant une « Label » (type 18) qui encadre le champ « fichiers » (type 19,
 *   images seules). Un tap dans la fenêtre ouvre la galerie du téléphone (ou les
 *   fichiers du PC — c'est le système qui décide, aucune appli ne peut sauter ce tap).
 *   L'image part DIRECTEMENT au bot avec le formulaire : rien n'est posté dans
 *   le salon, rien en MP.
 *   (L'erreur de la veille : le champ 19 était glissé dans une rangée d'actions —
 *   en modale, une rangée n'accepte QUE des champs texte (4). Dans une Label : OK.)
 *
 * L'image d'un formulaire est ÉPHÉMÈRE chez Discord (URL à expiration) : on la
 * recopie donc en pièce jointe du bot dans un salon privé « otaku-fonds-de-carte »
 * (@everyone privé de lecture), pour que la carte de bienvenue puisse la relire
 * des semaines plus tard. Si le bot ne peut pas créer ce salon (permissions),
 * il garde l'URL d'origine et le dit honnêtement dans l'aperçu.
 *
 * Client très ancien (la fenêtre ne peut pas s'ouvrir) : repli sur une invitation
 * postée dans le salon — l'admin répond avec 📎, même traitement, et le bot
 * efface les deux messages.
 */
const stockage = require('./stockage');
const bienvenueImage = require('./bienvenue-image');

const DELAI_ATTENTE = 10 * 60 * 1000;          // repli : 10 minutes pour répondre
const TAILLE_MAX = 8 * 1024 * 1024;            // même garde-fou que le générateur
const NOM_CANAL_STOCK = 'otaku-fonds-de-carte';
const enAttente = new Map();                   // userId → { guildId, messageId, prompt, expire }

const RAISONS = {
  aucune: '🖼️ Aucune image n\u2019est arrivée — touche « Ajouter des fichiers » dans la fenêtre, choisis ta photo, puis envoie.',
  pasImage: '🖼️ Il me faut une **image** (jpg, png, webp…) — un PDF ou un document ne passera pas.',
  tropLourde: '⚖️ Cette image dépasse 8 Mo — envoie une version plus légère.',
  illisible: '🖼️ Je n\u2019ai pas réussi à lire cette image — retente avec un jpg ou un png classique.',
};
function messageErreur(raison) { return RAISONS[raison] || RAISONS.illisible; }

/** Est-ce bien une image ? (content-type ou extension — Discord ne valide rien à notre place) */
function estUneImage(piece) {
  return String(piece.content_type || piece.contentType || '').startsWith('image/')
    || /\.(png|jpe?g|webp|gif|bmp)$/i.test(piece.name || piece.filename || '');
}

/** Une pièce jointe « image » dans ce message de salon ? */
function trouverImage(message) {
  const pieces = [...(message.attachments?.values ? message.attachments.values() : [])];
  return pieces.find(estUneImage) || null;
}

/** La fenêtre native du sélecteur : Label(18) → FileUpload(19), structure officielle exacte. */
function modaleFond() {
  const { ModalBuilder, LabelBuilder, FileUploadBuilder } = require('discord.js');
  const champ = new FileUploadBuilder()
    .setCustomId('fichier')
    .setMinValues(1)
    .setMaxValues(1)
    .setFileTypes(['image']);
  const etiquette = new LabelBuilder()
    .setLabel('Ton image de fond')
    .setDescription('Touche « Ajouter des fichiers » → galerie du téléphone, dossiers du PC.')
    .setFileUploadComponent(champ);
  return new ModalBuilder()
    .setCustomId('cfg:accueil:fond-pj-modal')
    .setTitle('Choisir une image')
    .addLabelComponents(etiquette);
}

/** Télécharge l'octet et vérifie qu'une vraie image se cache derrière. */
async function lireImage(piece) {
  try {
    const tampon = await bienvenueImage.chargerImage(piece.url || piece.proxy_url);
    await require('@napi-rs/canvas').loadImage(tampon);   // ne passe que si c'est décodable
    return tampon;
  } catch { return null; }
}

/** Trouve (ou crée) le salon privé du bot sur ce serveur. */
async function canalStock(guild, client) {
  const existant = guild?.channels?.cache?.find?.(
    (c) => c.name === NOM_CANAL_STOCK && (c.isTextBased ? c.isTextBased() : true));
  if (existant) return existant;
  const autorisations = [];
  if (guild.roles?.everyone?.id) autorisations.push({ id: guild.roles.everyone.id, deny: ['ViewChannel'] });
  const idBot = client?.user?.id ?? guild.members?.me?.id;
  if (idBot) autorisations.push({ id: idBot, allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ManageMessages'] });
  return guild.channels.create({
    name: NOM_CANAL_STOCK,
    topic: 'Salon privé du bot Otaku : il y range les images de fond choisies par le staff. Ne supprimez pas ces messages, les cartes de bienvenue casseraient.',
    permissionOverwrites: autorisations,
    reason: 'Hébergement des images de fond du panneau de réglages',
  });
}

/** Copie l'image en pièce jointe du bot → URL durable. Renvoie null si impossible. */
async function rangerCopie(guild, client, tampon, nomFichier) {
  try {
    const canal = await canalStock(guild, client);
    if (!canal) return null;
    const propre = String(nomFichier || 'fond.png').replace(/[^\w.\-]+/g, '_').slice(-60) || 'fond.png';
    const msg = await canal.send({
      content: '📌 Image de fond de la carte de bienvenue (copie du bot — ne pas supprimer).',
      files: [{ name: propre, attachment: tampon }],
    });
    const att = msg.attachments?.first?.();
    if (!att?.url) return null;
    return { url: att.url, canalId: msg.channel?.id ?? canal.id, messageId: msg.id };
  } catch { return null; }
}

/** Efface l'ancienne copie (au changement de fond ou « fond par défaut ») — au mieux. */
async function supprimerCopie(guild, reference) {
  try {
    if (!reference?.canalId || !reference?.messageId || !guild?.channels?.cache?.get) return;
    const canal = guild.channels.cache.get(reference.canalId);
    const msg = canal ? await canal.messages?.fetch?.(reference.messageId) : null;
    if (msg) await msg.delete();
  } catch { /* si le salon a été nettoyé à la main, tant pis : rien de cassé */ }
}

/**
 * Cœur du parcours — utilisé par la modale ET par le repli « réponse au salon » :
 * vérifie (image, 8 Mo, décodable), range la copie durable, enregistre, purgue l'ancienne copie.
 * @returns {Promise<{ok:boolean, raison?:string, tampon?:Buffer, url?:string, provisoire?:boolean, langue?:string}>}
 */
async function traiterPiece(guild, client, guildId, piece) {
  if (!piece) return { ok: false, raison: 'aucune' };
  if (!estUneImage(piece)) return { ok: false, raison: 'pasImage' };
  if (Number(piece.size) > TAILLE_MAX) return { ok: false, raison: 'tropLourde' };
  const tampon = await lireImage(piece);
  if (!tampon) return { ok: false, raison: 'illisible' };

  const stock = await rangerCopie(guild, client, tampon, piece.name || piece.filename);
  const ancien = (guildId && stockage.reglages(guildId).bienvenue) || {};
  const url = stock ? stock.url : (piece.url || piece.proxy_url);
  if (ancien.fondStock) await supprimerCopie(guild, ancien.fondStock);
  stockage.majReglages(guildId, {
    bienvenue: { ...ancien, fond: url, fondStock: stock ? { canalId: stock.canalId, messageId: stock.messageId } : null },
  });
  return { ok: true, tampon, url, provisoire: !stock, langue: ancien.langue || 'fr' };
}

/** L'aperçu réel de la carte, prêt à être répondu (embed + PNG si le générateur suit). */
async function paquetApercu(resultat, pseudo) {
  const embed = {
    color: 0x5865f2,
    title: '✅ Fond enregistré',
    description: 'Ta carte de bienvenue utilisera cette image, recadrée toute seule au bon format.\n'
      + (resultat.provisoire
        ? '⚠️ Je n\u2019ai pas pu la ranger dans mon salon privé (permissions) : si le message d\u2019origine disparaît, le fond par défaut reprendra.'
        : '🔒 Une copie est rangée dans mon salon privé « ' + NOM_CANAL_STOCK + ' », invisible pour les membres — l\u2019image ne mourra pas.')
      + '\nPour revenir au fond par défaut : « 🌸 Fond par défaut ».',
  };
  try {
    const png = await bienvenueImage.composer({
      fondBuffer: resultat.tampon,
      pseudo: pseudo || 'Aperçu',
      langue: resultat.langue || 'fr',
    });
    return { embeds: [embed], files: [{ name: 'apercu-bienvenue.png', attachment: png }] };
  } catch {
    return { embeds: [embed] };   // le générateur a toussé : le réglage est bon, rien d'autre à dire
  }
}

// ─────────────────────────── repli « répondre au message » ───────────────────────────

/** L'admin a touché le bouton SANS que la modale puisse s'ouvrir : on guette sa réponse. */
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

async function effacer(m) {
  try { if (m && typeof m.delete === 'function') await m.delete(); } catch { /* déjà parti */ }
}

/**
 * Appelé pour CHAQUE message de salon : si c'est la réponse attendue d'un admin,
 * on traite l'image, on poste l'aperçu, puis invitation et réponse disparaissent.
 * @returns {Promise<boolean>} true = message consommé (ne pas modérer deux fois).
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
      content: '🖼️ Réponds avec une **image** (jpg, png, webp…) — touche le trombone 📎 de la réponse.',
      allowedMentions: { repliedUser: false },
    }).catch(() => null);
    return true;
  }

  const resultat = await traiterPiece(message.guild, message.client, attente.guildId, image);
  if (!resultat.ok) {
    await message.reply({ content: messageErreur(resultat.raison), allowedMentions: { repliedUser: false } }).catch(() => null);
    return true;
  }
  enAttente.delete(message.author.id);

  const paquet = await paquetApercu(resultat, message.author.username);
  try {
    await message.channel.send({
      content: `${message.author}, voici l'aperçu réel de ta carte de bienvenue 🎉 (messages effacés automatiquement)`,
      ...paquet,
      allowedMentions: { users: [message.author.id] },
    });
  } catch {
    await message.channel.send({
      content: `✅ Fond enregistré, ${message.author} ! (aperçu impossible ici, mais les cartes l'utiliseront.)`,
      allowedMentions: { users: [message.author.id] },
    }).catch(() => null);
  }

  // nettoyage : la réponse avec l'image et l'invitation disparaissent — l'image, elle, est en sécurité
  await effacer(message);
  await effacer(attente.prompt);
  return true;
}

module.exports = {
  demander, chercherEnAttente, traiterReponse, trouverImage, estUneImage,
  modaleFond, traiterPiece, messageErreur, paquetApercu, supprimerCopie,
  NOM_CANAL_STOCK, __enAttente: enAttente,          // pour les tests uniquement
};
