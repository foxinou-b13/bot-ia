/**
 * commands/image-bienvenue.js — choisir l'image de fond SANS copier d'URL.
 *
 *   /image-bienvenue  image : <tu joints ta photo, depuis la galerie (mobile)
 *   ou tes fichiers (PC)>
 *
 * L'image peut être de n'importe quelle taille ou forme : le générateur
 * s'occupe de la recadrer proprement pour la carte. Le bot répond avec un
 * APERÇU réel de la carte, pour que l'admin voie tout de suite le résultat.
 */
const {
  SlashCommandBuilder, PermissionsBitField, AttachmentBuilder, EmbedBuilder,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const bienvenueImage = require('../utils/bienvenue-image');

const TAILLE_MAX = 8 * 1024 * 1024;   // même garde-fou que le générateur
const EST_IMAGE = /\.(png|jpe?g|webp|gif|bmp)$/i;

module.exports = {
  categorie: 'configuration',

  data: new SlashCommandBuilder()
    .setName('image-bienvenue')
    .setDescription('Fond de la carte de bienvenue : joins ton image (recadrée automatiquement)')
    .addAttachmentOption((o) => o
      .setName('image')
      .setDescription('Ta photo — depuis la galerie sur mobile, tes fichiers sur PC')
      .setRequired(true))
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const att = interaction.options.getAttachment('image');
    if (!att) {
      return panneaux.oups(interaction, '🖼️ Image manquante',
        'Utilise le champ « image » de la commande pour joindre ta photo (sur mobile : l’icône 📎 de la galerie).');
    }
    const estImage = (att.contentType || '').startsWith('image/') || EST_IMAGE.test(att.name || '');
    if (!estImage) {
      return panneaux.oups(interaction, '🖼️ Ce n’est pas une image',
        'Joins une vraie image : jpg, png, webp ou gif. (Les fichiers vidéo/PDF ne passent pas.)');
    }
    if (Number(att.size) > TAILLE_MAX) {
      return panneaux.oups(interaction, '🖼️ Image trop lourde',
        'Maxi 8 Mo. Envoie-la d’abord dans un salon (Discord la compresse), puis reprends-la depuis ton historique.');
    }

    // ── téléchargement + décodage : on valide MAINTENANT, pas à la prochaine arrivée ──
    let tampon;
    try {
      // d'abord via le proxy Discord (image déjà recadrée et légère), sinon l'URL nue
      tampon = await bienvenueImage.chargerImage(bienvenueImage.optimiserUrl(att.url))
        .catch(() => bienvenueImage.chargerImage(att.url));
    } catch (erreur) {
      return panneaux.oups(interaction, '📥 Impossible de récupérer l’image',
        `J’ai eu un souci en la téléchargeant (${erreur.message}). Réessaie, ou joins-la à nouveau.`);
    }
    let dimensions;
    try {
      const { loadImage } = require('@napi-rs/canvas');
      const image = await loadImage(tampon);
      if (!image.width || !image.height) throw new Error('indécodable');
      dimensions = { l: image.width, h: image.height };
    } catch {
      return panneaux.oups(interaction, '🖼️ Je ne sais pas lire ce fichier',
        'Discord n’arrive pas à décoder cette image. Réessaie avec un jpg ou un png classique.');
    }

    // ── on enregistre (URL d’origine, sans paramètre) puis on fabrique l'aperçu réel ──
    const b = stockage.reglages(interaction.guildId).bienvenue || {};
    stockage.majReglages(interaction.guildId, { bienvenue: { ...b, fond: att.url } });

    let paquet;
    try {
      const png = await bienvenueImage.composer({
        fondBuffer: tampon,
        pseudo: interaction.member?.user?.username || interaction.user?.username || 'Aperçu',
        langue: b.langue || 'fr',
      });
      const carte = new EmbedBuilder()
        .setColor(panneaux.COULEUR)
        .setTitle('✅ Fond enregistré — voilà l’aperçu')
        .setDescription([
          `Ta image (${dimensions.l}×${dimensions.h}) a été recadrée toute seule au format de la carte.`,
          b.salon ? `Elle sera utilisée pour les prochaines bienvenues dans <#${b.salon}>.` : '⚠️ L’accueil n’a pas encore de salon : choisis-le dans /config → Accueil, sinon la carte ne partira pas.',
          'ℹ️ Garde le message d’origine de cette image : si tu le supprimes, l’image disparaît aussi (le thème reprend la main).',
        ].join('\n\n'));
      paquet = {
        embeds: [carte],
        files: [new AttachmentBuilder(png, { name: 'apercu-bienvenue.png' })],
        ephemeral: true,
      };
    } catch {
      // l'enregistrement est fait ; l'aperçu seul peut rater, on le dit simplement
      paquet = { content: '✅ Fond enregistré. (Impossible de générer l’aperçu ici, mais les cartes l’utiliseront.)', ephemeral: true };
    }
    return interaction.reply(paquet).catch(() => null);
  },
};
