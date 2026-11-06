/**
 * events/guildMemberAdd.js — message de bienvenue + détection de raid.
 */
const { Events, EmbedBuilder } = require('discord.js');
const stockage = require('../utils/stockage');
const bienvenueImage = require('../utils/bienvenue-image');
const journal = require('../utils/journal');
const { config } = require('../config');

const arrivees = new Map();     // guildId → [horodatages]

function texteBienvenue(modele, membre, serveur, nombre) {
  return String(modele || '')
    .replace(/\{membre\}/g, `<@${membre.id}>`)
    .replace(/\{serveur\}/g, serveur.name)
    .replace(/\{nombre\}/g, String(nombre));
}

module.exports = {
  nom: Events.GuildMemberAdd,

  async executer(client, membre) {
    const guild = membre.guild;
    const reglages = stockage.reglages(guild.id);

    // ─── raid ? ───
    if (reglages.automod?.raid) {
      const maintenant = Date.now();
      const fenetre = config.modo.raidSecondes * 1000;
      const liste = (arrivees.get(guild.id) || []).filter((t) => maintenant - t <= fenetre);
      liste.push(maintenant);
      arrivees.set(guild.id, liste);

      if (liste.length >= config.modo.raidInscrits) {
        arrivees.set(guild.id, []);          // on évite de spammer l'alerte
        await journal.journaliser(guild, {
          type: 'auto',
          titre: '🚨 Arrivées suspectes',
          details: `${liste.length} personnes ont rejoint en moins de ${config.modo.raidSecondes} secondes.\n`
            + 'Vérifie les nouveaux comptes et pense à `/lock` les salons sensibles.',
        });
      }
    }

    // ─── rôle automatique (même si le message de bienvenue est coupé) ───
    const { salon, message, role } = reglages.bienvenue || {};
    let roleDonne = false;

    if (role && !membre.user?.bot && typeof membre.roles?.add === 'function') {
      try {
        await membre.roles.add(role, 'Rôle automatique d\'accueil (Otaku)');
        roleDonne = true;
      } catch (erreur) {
        console.error('⚠️ Rôle automatique non donné :', erreur.message);
      }
    }

    // ─── message de bienvenue ───
    if (!salon) return roleDonne || null;

    const cible = guild.channels?.cache?.get(salon);
    if (!cible || typeof cible.send !== 'function') return roleDonne || null;

    const nombre = guild.memberCount || 0;

    // ─── 1ᵉʳ choix : la grande carte-image, dans une vraie carte (ping + texte + PNG ensemble) ───
    try {
      const png = await bienvenueImage.generer({
        fondUrl: reglages.bienvenue.fond || null,
        avatarUrl: typeof membre.user?.displayAvatarURL === 'function'
          ? membre.user.displayAvatarURL({ extension: 'png', size: 256 })
          : null,
        pseudo: membre.user?.username || 'nouveau membre',
        langue: reglages.bienvenue.langue || 'fr',
      });
      // le message perso de l'admin s'affiche ENFIN aussi avec la carte-image ;
      // et quoi qu'il écrive, le ping du nouveau est garanti dans la carte.
      const texte = texteBienvenue(message || 'Bienvenue {membre} sur **{serveur}** !', membre, guild, nombre);
      const carte = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`👋 Bienvenue sur ${guild.name} !`)
        .setDescription(texte.includes(`<@${membre.id}>`) ? texte : `<@${membre.id}> ${texte}`)
        .setImage('attachment://bienvenue.png');
      await cible.send({
        embeds: [carte],
        files: [{ name: 'bienvenue.png', attachment: png }],
        allowedMentions: { users: [membre.id] },
      });
      return true;
    } catch (erreur) {
      console.error('⚠️ Carte-image de bienvenue impossible, je bascule sur la carte texte :', erreur.message);
    }

    // ─── repli : la carte texte propre ───
    const texte = texteBienvenue(message || 'Bienvenue {membre} sur **{serveur}** !', membre, guild, nombre);

    const carte = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`👋 Bienvenue sur ${guild.name} !`);
    carte.setDescription(texte);
    if (nombre) carte.addFields({ name: '👥 Nouvel arrivant', value: `Tu es le **${nombre}ᵉ membre** du serveur.` });
    if (role) carte.addFields({ name: '🎟️ Accès', value: 'Le rôle du serveur t\'a été donné automatiquement — tu as accès aux salons.', inline: true });

    try {
      await cible.send({ embeds: [carte], allowedMentions: { users: [membre.id] } });
      return true;
    } catch (erreur) {
      console.error('⚠️ Bienvenue non envoyée :', erreur.message);
      return roleDonne || null;
    }
  },
};
