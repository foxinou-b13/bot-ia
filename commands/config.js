/**
 * commands/config.js — LE panneau de configuration, un seul écran propre.
 *
 *   /config → un menu « Que veux-tu configurer ? » (5 sections) ;
 *   chaque section affiche uniquement ses sélecteurs. Zéro saisie dans le chat.
 */
const {
  SlashCommandBuilder, PermissionsBitField, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const ia = require('../utils/ia');

const COULEUR = 0x5865f2;
const MESSAGE_DEFAUT = 'Bienvenue {membre} sur **{serveur}** ! Tu es notre {nombre}e membre.';

// ─── les modules de l'auto-mod ───
const MODULES = {
  spam: { nom: 'Spam', emoji: '🐢', aide: 'Trop de messages d\'un coup' },
  liens: { nom: 'Liens et invitations', emoji: '🔗', aide: 'Invitations, arnaques nitro/steam, rafales de liens' },
  insultes: { nom: 'Insultes', emoji: '🤬', aide: 'Gros mots, même déguisés (c0nnard)' },
  majuscules: { nom: 'Majuscules', emoji: '🔠', aide: 'Messages écrits en gueulant' },
  raid: { nom: 'Raid', emoji: '🚨', aide: 'Arrivées massives soudaines' },
  sanctionAuto: { nom: 'Sanction automatique', emoji: '⚖️', aide: 'Mute auto après plusieurs avertissements' },
};

const SECTIONS = [
  { valeur: 'accueil', label: '👋 Accueil des nouveaux', aide: 'Salon de bienvenue, message, rôle automatique' },
  { valeur: 'salons', label: '📋 Salons & repères', aide: 'Logs du staff, règles, support/tickets' },
  { valeur: 'automod', label: '🛡️ Auto-modération', aide: 'Spam, liens, insultes, majuscules, raid' },
  { valeur: 'sanctions', label: '⚖️ Sanctions automatiques', aide: 'Mute après plusieurs avertissements' },
  { valeur: 'ia', label: '🤖 Intelligence artificielle', aide: 'Activer/couper par salon, personnalité' },
];

function sectionCourante(guildId) {
  const s = stockage.reglages(guildId).cfgSection;
  return SECTIONS.some((x) => x.valeur === s) ? s : SECTIONS[0].valeur;
}

const rang = (...composants) => new ActionRowBuilder().addComponents(...composants);
const selectSection = (active) => rang(
  new StringSelectMenuBuilder()
    .setCustomId('cfg:section')
    .setPlaceholder('⚙️ Que veux-tu configurer ?')
    .addOptions(SECTIONS.map((s) => ({
      label: s.label, value: s.valeur, description: s.aide.slice(0, 95), default: s.valeur === active,
    }))),
);
const selectCanal = (id, place) => rang(
  new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(place)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement),
);
const bouton = (id, libelle, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(libelle).setEmoji(emoji).setStyle(style);

// ─── l'écran complet ───
function panneauPrincipal(guildId, channelId = null, section = null, note = null) {
  const r = stockage.reglages(guildId);
  const a = r.automod;
  const sec = section || sectionCourante(guildId);
  const b = r.bienvenue || {};
  const iaR = r.ia || {};
  const iaCoupeeIci = Boolean(channelId && (iaR.salonBloques || []).includes(channelId));

  const actifs = Object.entries(MODULES).filter(([cle]) => a[cle]).map(([, m]) => m.nom);
  const lignes = [];
  if (note) lignes.push(note, '');
  lignes.push('Choisis une **section** dans le menu ci-dessous — chaque réglage s\'applique instantanément.');

  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle('⚙️ Configuration d\'Otaku')
    .setDescription(lignes.join('\n'))
    .addFields(
      { name: '🛡️ Auto-mod', value: actifs.length ? actifs.join(' · ') : '_tout est coupé_', inline: true },
      { name: '📋 Salon exempté', value: a.salonExempt ? `<#${a.salonExempt}>` : '_aucun_', inline: true },
      { name: '🗂️ Logs du staff', value: r.logs ? `<#${r.logs}>` : '_non définis_', inline: true },
      { name: '📜 Salon des règles', value: r.guide.regles ? `<#${r.guide.regles}>` : '_non défini_', inline: true },
      { name: '🛟 Support / tickets', value: r.guide.support ? `<#${r.guide.support}>` : '_non défini_', inline: true },
      { name: '👋 Bienvenue', value: b.salon ? `<#${b.salon}>` + (b.role ? ` · rôle <@&${b.role}>` : '') : '_coupée_', inline: true },
      { name: '⚖️ Sanction auto', value: a.sanctionAuto ? `${a.seuilAvert || 3} avertis → mute ${a.dureeSanction || 60} min` : '_désactivée_', inline: true },
      { name: '🤖 IA', value: iaR.active === false ? '_coupée partout_' : (iaCoupeeIci ? '🔇 coupée dans ce salon' : '🟢 active'), inline: true },
      { name: '🎭 Personnalité', value: iaR.consigne ? `> ${String(iaR.consigne).slice(0, 90)}` : '_standard_', inline: false },
    );

  const rows = [selectSection(sec)];

  if (sec === 'accueil') {
    rows.push(
      selectCanal('cfg:accueil:salon', '📋 Dans quel salon souhaiter la bienvenue ?'),
      rang(new RoleSelectMenuBuilder().setCustomId('cfg:accueil:role')
        .setPlaceholder('🎭 Rôle donné automatiquement aux nouveaux (optionnel)')),
      rang(
        bouton('cfg:accueil:msg', 'Écrire le message', '✏️', ButtonStyle.Primary),
        bouton('cfg:accueil:role-off', 'Retirer le rôle', '🧹'),
        bouton('cfg:accueil:off', 'Couper l\'accueil', '🔕'),
      ),
    );
  }

  if (sec === 'salons') {
    rows.push(
      selectCanal('cfg:salons:logs', '🗂️ Logs du staff — sanctions, alertes, filtres (privé)'),
      selectCanal('cfg:salons:regles', '📜 Salon des règles du serveur'),
      selectCanal('cfg:salons:support', '🛟 Salon support ou ouverture des tickets'),
      rang(
        bouton('cfg:salons:logs-off', 'Retirer les logs', '🧹'),
        bouton('cfg:salons:regles-off', 'Retirer les règles', '🧹'),
        bouton('cfg:salons:support-off', 'Retirer le support', '🧹'),
      ),
    );
  }

  if (sec === 'automod') {
    rows.push(
      rang(new StringSelectMenuBuilder()
        .setCustomId('cfg:modules')
        .setPlaceholder('🛡️ Modules actifs (décoche pour désactiver)')
        .setMinValues(0)
        .setMaxValues(Object.keys(MODULES).length)
        .addOptions(Object.entries(MODULES).map(([cle, m]) => ({
          label: m.nom, value: cle, description: m.aide.slice(0, 95),
          emoji: a[cle] ? '✅' : '⬜', default: Boolean(a[cle]),
        })))),
      selectCanal('cfg:exempt', '🤫 Un salon où l\'auto-mod ne filtre jamais ?'),
      rang(bouton('cfg:exempt-off', 'Retirer l\'exemption', '🧹')),
    );
  }

  if (sec === 'sanctions') {
    rows.push(rang(new StringSelectMenuBuilder()
      .setCustomId('cfg:sanction')
      .setPlaceholder('⚖️ Punition automatique après des avertissements')
      .addOptions([
        { label: 'Désactiver la sanction automatique', value: 'off', emoji: '⚪' },
        { label: '3 avertissements → mute 1 h', value: '3:60', emoji: '🔇' },
        { label: '3 avertissements → mute 24 h', value: '3:1440', emoji: '🔇' },
        { label: '5 avertissements → mute 1 h', value: '5:60', emoji: '🔇' },
        { label: 'Mute de 10 min dès le 1er avertissement', value: '1:10', emoji: '⏱️' },
      ])));
  }

  if (sec === 'ia') {
    rows.push(
      rang(
        bouton('cfg:ia-ici', iaCoupeeIci ? 'Réactiver l\'IA ici' : 'Couper l\'IA ici', iaCoupeeIci ? '🟢' : '🔇', iaCoupeeIci ? ButtonStyle.Success : ButtonStyle.Secondary),
        bouton('cfg:perso', 'Personnalité de l\'IA', '🎭', ButtonStyle.Primary),
      ),
      rang(bouton('cfg:memo', 'Oublier la conversation de ce salon', '🧠')),
    );
  }

  return { embeds: [embed], components: rows };
}

// ─── la commande ───
module.exports = {
  categorie: 'configuration',

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Le panneau de configuration : sections, menus déroulants, zéro saisie')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);
    return interaction.reply({
      ...panneauPrincipal(interaction.guildId, interaction.channelId),
      ephemeral: true,
    }).catch(() => null);
  },

  // ─── menus, sélecteurs, boutons, formulaires ───
  async composant(interaction) {
    const id = interaction.customId || '';
    if (!id.startsWith('cfg:')) return false;

    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) {
      await panneaux.oups(interaction, '🚫 Action impossible', refus);
      return true;
    }

    const G = interaction.guildId;
    const maj = (morceau, note) => {
      stockage.majReglages(G, morceau);
      return rafraichir(interaction, note);
    };

    // ── navigation entre sections ──
    if (id === 'cfg:section' && interaction.isStringSelectMenu()) {
      stockage.majReglages(G, { cfgSection: interaction.values[0] });
      await rafraichir(interaction, null);
      return true;
    }

    // ── accueil ──
    if (id === 'cfg:accueil:salon' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ bienvenue: { salon: salon ? salon.id : null } },
        salon ? `✅ Bienvenue envoyée dans <#${salon.id}>.` : '✅ Bienvenue mise à jour.');
    }
    if (id === 'cfg:accueil:role' && interaction.isRoleSelectMenu?.()) {
      const role = interaction.roles?.first();
      return maj({ bienvenue: { role: role ? role.id : null } },
        role ? `✅ Les nouveaux membres recevront **${role.name}** automatiquement.` : '✅ Rôle mis à jour.');
    }
    if (id === 'cfg:accueil:role-off') {
      return maj({ bienvenue: { role: null } }, '🧹 Rôle automatique retiré.');
    }
    if (id === 'cfg:accueil:off') {
      return maj({ bienvenue: { salon: null } }, '🔕 Accueil coupé — plus de message de bienvenue.');
    }
    if (id === 'cfg:accueil:msg') {
      const actuelle = (stockage.reglages(G).bienvenue || {}).message || MESSAGE_DEFAUT;
      const modal = new ModalBuilder().setCustomId('cfg:accueil:msg-modal').setTitle('✏️ Message de bienvenue');
      const champ = new TextInputBuilder()
        .setCustomId('message').setLabel('Ton message d\'accueil')
        .setPlaceholder('{membre} · {serveur} · {nombre} sont remplacés automatiquement')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(true)
        .setValue(String(actuelle).slice(0, 500));
      modal.addComponents(new ActionRowBuilder().addComponents(champ));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }
    if (id === 'cfg:accueil:msg-modal') {
      const valeur = String(interaction.fields?.getTextInputValue('message') || '').trim();
      return maj({ bienvenue: { message: valeur || null } }, valeur ? '✅ Message d\'accueil enregistré.' : '✅ Message remis par défaut.');
    }

    // ── salons & repères ──
    if (id === 'cfg:salons:logs' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ logs: salon ? salon.id : null }, salon ? `✅ Logs du staff dans <#${salon.id}>.` : '✅ Logs mis à jour.');
    }
    if (id === 'cfg:salons:regles' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ guide: { regles: salon ? salon.id : null } },
        salon ? `✅ Règles : les membres seront orientés vers <#${salon.id}>.` : '✅ Règles mises à jour.');
    }
    if (id === 'cfg:salons:support' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ guide: { support: salon ? salon.id : null } },
        salon ? `✅ Support/tickets : les membres seront orientés vers <#${salon.id}>.` : '✅ Support mis à jour.');
    }
    if (id === 'cfg:salons:logs-off') return maj({ logs: null }, '🧹 Logs retirés.');
    if (id === 'cfg:salons:regles-off') return maj({ guide: { regles: null } }, '🧹 Salon des règles retiré.');
    if (id === 'cfg:salons:support-off') return maj({ guide: { support: null } }, '🧹 Salon de support retiré.');

    // ── auto-mod ──
    if (id === 'cfg:modules' && interaction.isStringSelectMenu()) {
      const choisis = interaction.values;
      const seuil = stockage.reglages(G).automod.seuilAvert || 3;
      const automod = { seuilAvert: seuil };
      for (const cle of Object.keys(MODULES)) automod[cle] = choisis.includes(cle);
      return maj({ automod }, choisis.length
        ? `✅ Actif : ${choisis.map((c) => MODULES[c]?.nom).filter(Boolean).join(', ')}.`
        : '⚪ Tous les modules sont désactivés.');
    }
    if (id === 'cfg:exempt' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ automod: { salonExempt: salon ? salon.id : null } },
        salon ? `✅ <#${salon.id}> ne sera jamais filtré.` : '✅ Exemption mise à jour.');
    }
    if (id === 'cfg:exempt-off') return maj({ automod: { salonExempt: null } }, '🔕 Plus aucun salon exempté.');

    // ── sanctions ─
    if (id === 'cfg:sanction' && interaction.isStringSelectMenu()) {
      const valeur = interaction.values[0];
      if (valeur === 'off') return maj({ automod: { sanctionAuto: false } }, '⚪ Sanction automatique désactivée.');
      const [seuil, duree] = valeur.split(':').map(Number);
      return maj({ automod: { sanctionAuto: true, seuilAvert: seuil, dureeSanction: duree } },
        `⚖️ Activé : **${seuil} avertissement(s) → mute ${duree} min**.`);
    }

    // ── IA ──
    if (id === 'cfg:ia-ici') {
      const r = stockage.reglages(G).ia || {};
      const bloques = new Set(r.salonBloques || []);
      let note;
      if (bloques.has(interaction.channelId)) { bloques.delete(interaction.channelId); note = '🟢 IA **réactivée** dans ce salon.'; }
      else { bloques.add(interaction.channelId); note = '🔇 IA **coupée** dans ce salon.'; }
      return maj({ ia: { salonBloques: [...bloques] } }, note);
    }
    if (id === 'cfg:perso') {
      const actuelle = (stockage.reglages(G).ia || {}).consigne || '';
      const modal = new ModalBuilder().setCustomId('cfg:perso-modal').setTitle('🎭 Personnalité de l\'IA');
      const champ = new TextInputBuilder()
        .setCustomId('consigne')
        .setLabel('Comment doit se comporter l\'IA ?')
        .setPlaceholder('Ex. : ton pirate, 2 phrases max, avec des exemples')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(500).setRequired(false)
        .setValue(actuelle.slice(0, 500));
      modal.addComponents(new ActionRowBuilder().addComponents(champ));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }
    if (id === 'cfg:perso-modal') {
      const valeur = String(interaction.fields?.getTextInputValue('consigne') || '').trim();
      return maj({ ia: { consigne: valeur } }, valeur
        ? '✅ Personnalité enregistrée : l\'IA répondra dans ce caractère.'
        : '🧹 Personnalité effacée — réponses standard.');
    }
    if (id === 'cfg:memo') {
      ia.oublier(G, interaction.channelId);
      await rafraichir(interaction, '🧠 Mémoire du salon oubliée.');
      return true;
    }

    await rafraichir(interaction, null);
    return true;
  },

  MODULES,
  SECTIONS,
  panneauPrincipal,
  sectionCourante,
};

/** Rafraîchit le panneau (ou l'envoie si le message d'origine n'est plus éditable). */
async function rafraichir(interaction, note) {
  const paquet = panneauPrincipal(interaction.guildId, interaction.channelId, null, note);
  try {
    await interaction.update(paquet);
  } catch {
    await interaction.reply({ ...paquet, ephemeral: true }).catch(() => null);
  }
}
