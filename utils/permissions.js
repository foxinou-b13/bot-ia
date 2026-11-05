/**
 * utils/permissions.js — qui a le droit de faire quoi.
 * Chaque refus renvoie une phrase claire, jamais une erreur Discord brute.
 */
const { PermissionsBitField } = require('discord.js');

const LIBELLES = {
  BanMembers: 'Bannir des membres',
  KickMembers: 'Expulser des membres',
  ModerateMembers: 'Exclure temporairement (mute)',
  ManageMessages: 'Gérer les messages',
  ManageChannels: 'Gérer les salons',
  ManageRoles: 'Gérer les rôles',
  ManageGuild: 'Gérer le serveur',
};

/**
 * Vérifie une permission sur l'auteur de la commande.
 * @returns {string|null} message d'erreur, ou null si c'est bon.
 */
function verifier(interaction, permission) {
  // En message privé, les commandes de modération n'ont aucun sens.
  if (!interaction.inGuild || !interaction.inGuild()) {
    return "Cette commande ne marche que dans un serveur, pas en message privé.";
  }

  const membre = interaction.member;
  if (!membre || !membre.permissions) {
    return "Je n'arrive pas à vérifier tes permissions sur ce serveur.";
  }

  const perms = membre.permissions;
  if (typeof perms.has === 'function' && perms.has(permission)) return null;

  // `permission` est une valeur binaire (BigInt) : on retrouve son nom.
  let cle = null;
  for (const [nom, drapeau] of Object.entries(PermissionsBitField.Flags)) {
    if (drapeau === permission) { cle = nom; break; }
  }
  const nom = LIBELLES[cle] || 'cette action';
  return `Il te manque la permission **${nom}** pour faire ça.`;
}

/** Le bot lui-même a-t-il la permission ? */
function botPeut(guild, permission) {
  const moi = guild?.members?.me;
  if (!moi) return true;                        // on ne bloque pas si info absente
  return moi.permissions.has(permission);
}

const MESSAGE_BOT_SANS_PERMISSION =
  "Je n'ai pas la permission de faire ça. Donne-moi le rôle avec les permissions de modération (Bannir, Expulser, Exclure temporairement, Gérer les messages).";

/**
 * Peut-on sanctionner cette cible ?
 * @returns {string|null} message d'erreur, ou null si c'est bon.
 */
function peutSanctionner(auteur, cible, options = {}) {
  if (!cible) return "Je ne trouve pas ce membre sur le serveur.";
  if (cible.id === auteur.id) return "Tu ne peux pas t'appliquer ça à toi-même.";
  if (cible.user && cible.user.bot) return "Je ne sanctionne pas les bots.";
  if (cible.id === auteur.client?.user?.id) return "Je ne peux pas me sanctionner moi-même.";

  // Le propriétaire du serveur est intouchable.
  if (cible.id === cible.guild?.ownerId) {
    return "Le propriétaire du serveur ne peut pas être sanctionné.";
  }

  // Hiérarchie des rôles : on ne touche pas quelqu'un de plus haut (ou égal).
  const plusHautAuteur = auteur.roles?.highest?.position ?? 0;
  const plusHautCible = cible.roles?.highest?.position ?? 0;
  if (!options.ignorerHierarchie && plusHautCible >= plusHautAuteur) {
    return "Cette personne a un rôle égal ou supérieur au tien : je ne peux pas agir sur elle.";
  }

  // Le rôle du bot doit être au-dessus de celui de la cible.
  const moi = cible.guild?.members?.me;
  const plusHautBot = moi?.roles?.highest?.position ?? Number.MAX_SAFE_INTEGER;
  if (plusHautCible >= plusHautBot) {
    return "Mon rôle est en dessous du sien : remonte mon rôle au-dessus pour que je puisse agir.";
  }

  return null;
}

/** Nettoie une raison saisie par un humain (longueur + retours à la ligne). */
function propreRaison(raison, defaut = 'Aucune raison donnée') {
  const texte = String(raison || '').replace(/\s+/g, ' ').trim();
  return texte ? texte.slice(0, 400) : defaut;
}

/** Transforme « 10m », « 2h », « 1j » en millisecondes (max 28 jours). */
function dureeEnMs(texte) {
  const MAX = 28 * 24 * 60 * 60 * 1000;
  const brut = String(texte || '').trim().toLowerCase();
  const trouve = brut.match(/^(\d+)\s*(s|m|h|j|d)?/);
  if (!trouve) return null;
  const valeur = parseInt(trouve[1], 10);
  const unite = trouve[2] || 'm';
  const multiplicateur = { s: 1000, m: 60000, h: 3600000, j: 86400000, d: 86400000 }[unite];
  const ms = valeur * multiplicateur;
  if (!Number.isFinite(ms) || ms < 5000) return null;
  return Math.min(ms, MAX);
}

function dureeLisible(ms) {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} min`;
  const heures = Math.round(minutes / 60);
  if (heures < 24) return `${heures} h`;
  return `${Math.round(heures / 24)} jour(s)`;
}

module.exports = {
  verifier,
  botPeut,
  peutSanctionner,
  propreRaison,
  dureeEnMs,
  dureeLisible,
  MESSAGE_BOT_SANS_PERMISSION,
  LIBELLES,
  PermissionsBitField,
};
