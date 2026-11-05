const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const { journaliser } = require('../utils/journal');

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('role')
    .setDescription('Donne ou retire un rôle à un membre')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageRoles)
    .addStringOption((o) => o
      .setName('action')
      .setDescription('Ajouter ou retirer ?')
      .setRequired(true)
      .addChoices(
        { name: 'Ajouter le rôle', value: 'ajouter' },
        { name: 'Retirer le rôle', value: 'retirer' },
      ))
    .addUserOption((o) => o.setName('membre').setDescription('La personne').setRequired(true))
    .addRoleOption((o) => o.setName('role').setDescription('Le rôle à donner ou retirer').setRequired(true)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageRoles);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const action = interaction.options.getString('action');
    const cible = interaction.options.getMember('membre');
    const role = interaction.options.getRole('role');

    if (!cible) return panneaux.oups(interaction, '🔍 Membre introuvable', "Cette personne n'est pas sur le serveur.");

    // Sécurités : rôle du bot, rôle @everyone, hiérarchie.
    const moi = interaction.guild.members.me;
    if (!role || role.managed || role.id === interaction.guild.id) {
      return panneaux.oups(interaction, '🚫 Rôle non modifiable',
        'Ce rôle est géré par une intégration ou c\'est le rôle @everyone : je ne peux pas y toucher.');
    }
    if (moi && moi.roles.highest.position <= role.position) {
      return panneaux.oups(interaction, '🚫 Mon rôle est trop bas',
        `Le rôle **${role.name}** est au-dessus du mien. Remonte mon rôle dans la liste pour que je puisse le distribuer.`);
    }
    if (role.position >= (interaction.member.roles.highest?.position ?? 0)) {
      return panneaux.oups(interaction, '🚫 Rôle trop haut',
        `Tu ne peux pas distribuer **${role.name}** : il est au-dessus de ton rôle le plus haut.`);
    }

    const dejaLa = cible.roles.cache.has(role.id);
    if (action === 'ajouter' && dejaLa) {
      return panneaux.repondre(interaction, panneaux.attention('ℹ️ Déjà attribué',
        `**${cible.user.tag}** a déjà le rôle **${role.name}**.`));
    }
    if (action === 'retirer' && !dejaLa) {
      return panneaux.repondre(interaction, panneaux.attention('ℹ️ Rôle absent',
        `**${cible.user.tag}** n'a pas le rôle **${role.name}**.`));
    }

    try {
      if (action === 'ajouter') {
        await cible.roles.add(role, `${interaction.user.tag}`);
      } else {
        await cible.roles.remove(role, `${interaction.user.tag}`);
      }
    } catch {
      return panneaux.oups(interaction, '❌ Action refusée par Discord',
        'Vérifie que mon rôle est bien au-dessus du rôle visé.');
    }

    await journaliser(interaction.guild, {
      type: 'ok',
      titre: action === 'ajouter' ? '➕ Rôle ajouté' : '➖ Rôle retiré',
      auteur: interaction.user.tag,
      cible: `${cible.user.tag} (${cible.id})`,
      details: `Rôle : **${role.name}**`,
    });

    return panneaux.ok(interaction,
      action === 'ajouter' ? '➕ Rôle ajouté' : '➖ Rôle retiré',
      `**${role.name}** ${action === 'ajouter' ? 'donné à' : 'retiré à'} **${cible.user.tag}**.`);
  },
};
