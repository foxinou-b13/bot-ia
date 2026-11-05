/**
 * commands/config.js — le panneau de configuration, façon application pro.
 *
 * Un seul écran, des menus déroulants : plus rien à taper.
 *   /config            → ouvre le panneau
 *   menu « Modules »   → active/désactive la modération automatique
 *   menu « Salons »    → choisit le salon des logs (et l'exempté)
 *   menu « Sanctions » → punition automatique après X avertissements
 *   menu « Accueil »   → salon et message de bienvenue
 */
const {
  SlashCommandBuilder, PermissionsBitField, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, EmbedBuilder, ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');

const COULEUR = 0x5865f2;

// ─── les modules de l'auto-mod ───
const MODULES = {
  spam: { nom: 'Spam', emoji: '🐢', aide: 'Trop de messages d\'un coup' },
  liens: { nom: 'Liens et invitations', emoji: '🔗', aide: 'Invitations, arnaques nitro/steam, rafales de liens' },
  insultes: { nom: 'Insultes', emoji: '🤬', aide: 'Gros mots, même déguisés (c0nnard)' },
  majuscules: { nom: 'Majuscules', emoji: '🔠', aide: 'Messages écrits en gueulant' },
  raid: { nom: 'Raid', emoji: '🚨', aide: 'Arrivées massives soudaines' },
  sanctionAuto: { nom: 'Sanction automatique', emoji: '⚖️', aide: 'Mute auto après plusieurs avertissements' },
};

// ─── écran principal ───
function panneauPrincipal(guildId, channelId = null) {
  const r = stockage.reglages(guildId);
  const a = r.automod;
  const iaR = r.ia || {};
  const iaIciCoupee = Boolean(channelId && (iaR.salonBloques || []).includes(channelId));

  const actifs = Object.entries(MODULES)
    .filter(([cle]) => a[cle])
    .map(([, m]) => `${m.emoji} ${m.nom}`);
  const inactifs = Object.entries(MODULES)
    .filter(([cle]) => !a[cle])
    .map(([, m]) => `${m.emoji} ${m.nom}`);

  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle('⚙️ Configuration d\'Otaku')
    .setDescription('Choisis dans les menus ci-dessous. Tout s\'enregistre instantanément.')
    .addFields(
      { name: '🟢 Activé', value: actifs.length ? actifs.join('\n') : '_rien pour l\'instant_', inline: true },
      { name: '⚪ Désactivé', value: inactifs.length ? inactifs.join('\n') : '_tout est activé_', inline: true },
      { name: '📋 Salon des logs', value: r.logs ? `<#${r.logs}>` : '_non défini_', inline: true },
      { name: '🔕 Salon exempté', value: a.salonExempt ? `<#${a.salonExempt}>` : '_aucun_', inline: true },
      { name: '⚖️ Sanction auto',
        value: a.sanctionAuto
          ? `${a.seuilAvert || 3} avertissements → mute ${a.dureeSanction || 60} min`
          : '_désactivée_',
        inline: true },
      { name: '👋 Bienvenue', value: r.bienvenue.salon ? `<#${r.bienvenue.salon}>` : '_désactivée_', inline: true },
      { name: '🤖 IA dans ce salon',
        value: iaR.active === false ? '_IA éteinte partout_' : (iaIciCoupee ? '🔇 **coupée ici**' : '🟢 **active ici**'),
        inline: true },
      { name: '🎭 Personnalité de l\'IA',
        value: iaR.consigne ? `> ${String(iaR.consigne).slice(0, 120)}${String(iaR.consigne).length > 120 ? '…' : ''}` : '_réponses standard (modifiable via le bouton 🎭)_',
        inline: false },
    );

  const menuModules = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfg:modules')
      .setPlaceholder('🛡️ Activer / désactiver la modération automatique')
      .setMinValues(1)
      .setMaxValues(Object.keys(MODULES).length)
      .addOptions(Object.entries(MODULES).map(([cle, m]) => ({
        label: `${m.nom} — ${a[cle] ? 'activé' : 'désactivé'}`,
        value: cle,
        description: m.aide.slice(0, 100),
        emoji: a[cle] ? '✅' : '⬜',
        default: Boolean(a[cle]),
      }))),
  );

  const menuSalons = new ActionRowBuilder().addComponents(
    new ChannelSelectMenuBuilder()
      .setCustomId('cfg:salon')
      .setPlaceholder('📋 Choisir le salon des logs')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
      .setMinValues(0)
      .setMaxValues(1),
  );

  const menuSanction = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('cfg:sanction')
      .setPlaceholder('⚖️ Punition automatique après des avertissements')
      .addOptions([
        { label: 'Désactiver la sanction automatique', value: 'off', emoji: '⚪' },
        { label: '3 avertissements → mute 1 h', value: '3:60', emoji: '🔇' },
        { label: '3 avertissements → mute 24 h', value: '3:1440', emoji: '🔇' },
        { label: '5 avertissements → mute 1 h', value: '5:60', emoji: '🔇' },
        { label: 'Mute de 10 min dès le 1er avertissement', value: '1:10', emoji: '⏱️' },
      ]),
  );

  const boutons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('cfg:ia-ici')
      .setLabel(iaIciCoupee ? 'Réactiver l\'IA ici' : 'Couper l\'IA ici')
      .setStyle(iaIciCoupee ? ButtonStyle.Success : ButtonStyle.Secondary)
      .setEmoji(iaIciCoupee ? '🟢' : '🔇'),
    new ButtonBuilder().setCustomId('cfg:perso').setLabel('Personnalité de l\'IA').setStyle(ButtonStyle.Primary).setEmoji('🎭'),
    new ButtonBuilder().setCustomId('cfg:logs-off').setLabel('Retirer les logs').setStyle(ButtonStyle.Secondary).setEmoji('🧹'),
    new ButtonBuilder().setCustomId('cfg:refresh').setLabel('Rafraîchir').setStyle(ButtonStyle.Primary).setEmoji('🔄'),
  );

  return { embeds: [embed], components: [menuModules, menuSalons, menuSanction, boutons] };
}

// ─── la commande ───
module.exports = {
  categorie: 'configuration',

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Ouvre le panneau de configuration du bot (menus, zéro saisie)')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const paquet = panneauPrincipal(interaction.guildId, interaction.channelId);
    return interaction.reply({ ...paquet, ephemeral: true }).catch(() => null);
  },

  // ─── clics et menu déroulant ───
  async composant(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('cfg:')) return false;

    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) {
      await panneaux.oups(interaction, '🚫 Action impossible', refus);
      return true;
    }

    let message = null;

    if (id === 'cfg:modules' && interaction.isStringSelectMenu()) {
      const choisis = interaction.values;
      // Le menu envoie tout ce qui est coché : on active ce qui est présent.
      const automod = {};
      for (const cle of Object.keys(MODULES)) automod[cle] = choisis.includes(cle);
      const seuil = stockage.reglages(interaction.guildId).automod.seuilAvert || 3;
      automod.seuilAvert = seuil;
      stockage.majReglages(interaction.guildId, { automod });

      const actifs = choisis.map((c) => MODULES[c]?.nom).filter(Boolean);
      message = actifs.length
        ? `✅ Activé : ${actifs.join(', ')}`
        : '⚪ Tous les modules sont désactivés.';
    }

    if (id === 'cfg:salon' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      stockage.majReglages(interaction.guildId, { logs: salon ? salon.id : null });
      message = salon ? `📋 Logs enregistrés dans <#${salon.id}>.` : '📋 Logs désactivés.';
    }

    if (id === 'cfg:sanction' && interaction.isStringSelectMenu()) {
      const valeur = interaction.values[0];
      if (valeur === 'off') {
        stockage.majReglages(interaction.guildId, { automod: { sanctionAuto: false } });
        message = '⚪ Sanction automatique désactivée.';
      } else {
        const [seuil, duree] = valeur.split(':').map(Number);
        stockage.majReglages(interaction.guildId, {
          automod: { sanctionAuto: true, seuilAvert: seuil, dureeSanction: duree },
        });
        message = `⚖️ Activé : **${seuil} avertissement(s) → mute ${duree} min**.`;
      }
    }

    if (id === 'cfg:ia-ici') {
      const r = stockage.reglages(interaction.guildId).ia || {};
      const bloques = new Set(r.salonBloques || []);
      let etat;
      if (bloques.has(interaction.channelId)) { bloques.delete(interaction.channelId); etat = '🟢 IA **réactivée** dans ce salon.'; }
      else { bloques.add(interaction.channelId); etat = '🔇 IA **coupée** dans ce salon.'; }
      stockage.majReglages(interaction.guildId, { ia: { salonBloques: [...bloques] } });
      await interaction.update(panneauPrincipal(interaction.guildId, interaction.channelId)).catch(() => null);
      await interaction.followUp({ content: etat, ephemeral: true }).catch(() => null);
      return true;
    }

    if (id === 'cfg:perso') {
      const actuelle = (stockage.reglages(interaction.guildId).ia || {}).consigne || '';
      const modal = new ModalBuilder().setCustomId('cfg:perso-modal').setTitle('🎭 Personnalité de l\'IA');
      const champ = new TextInputBuilder()
        .setCustomId('consigne')
        .setLabel('Comment doit se comporter l\'IA ?')
        .setPlaceholder('Ex. : ton pirate, 2 phrases max, avec des exemples')
        .setStyle(TextInputStyle.Paragraph)
        .setMaxLength(500)
        .setRequired(false)
        .setValue(actuelle.slice(0, 500));
      modal.addComponents(new ActionRowBuilder().addComponents(champ));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }

    if (id === 'cfg:perso-modal') {
      const valeur = String(interaction.fields?.getTextInputValue('consigne') || '').trim();
      stockage.majReglages(interaction.guildId, { ia: { consigne: valeur } });
      await interaction.reply({
        embeds: [valeur
          ? panneaux.succes('🎭 Personnalité enregistrée', `L'IA répondra désormais dans ce caractère (dans la limite des règles de sécurité) :\n> ${valeur.slice(0, 300)}`)
          : panneaux.info('🎭 Personnalité effacée', "L'IA revient à ses réponses standard.")],
        ephemeral: true,
      }).catch(() => null);
      return true;
    }

    if (id === 'cfg:logs-off') {
      stockage.majReglages(interaction.guildId, { logs: null });
      message = '📋 Salon des logs retiré.';
    }

    if (id === 'cfg:exempt-off') {
      stockage.majReglages(interaction.guildId, { automod: { salonExempt: null } });
      message = '🔕 Plus aucun salon exempté.';
    }

    // On rafraîchit le panneau avec le nouvel état.
    const paquet = panneauPrincipal(interaction.guildId);
    if (id === 'cfg:refresh' || !message) {
      await interaction.update(paquet).catch(() => null);
      return true;
    }

    await interaction.update(paquet).catch(() => null);
    await interaction.followUp({ content: message, ephemeral: true }).catch(() => null);
    return true;
  },

  MODULES,
  panneauPrincipal,
};
