/**
 * commands/tickets.js — /tickets : le système de tickets d'Otaku, en une commande.
 *
 *   /tickets setup      → crée (ou adopte) catégorie + salon du panneau + logs + rôle staff, puis envoie le panneau.
 *   /tickets panneau    → renvoie le panneau (n'importe où), textes personnalisables.
 *   /tickets config     → voit l'état en une carte.
 *   /tickets ouvrir     → ouvre un ticket pour un membre (staff seulement, utile hors panneau).
 *   /tickets claim       → prends le ticket où tu es (coupe l'assistant d'office).
 *   /tickets fermer     → modal raison → transcription → suppression.
 *   /tickets ajouter    → donne accès à une personne au ticket actuel.
 *   /tickets retirer    → lui retire l'accès.
 *   /tickets reparer     → supprime les tickets fantômes (auteur parti).
 *
 * Toujours : PAS d'image générée sous le panneau. Une carte propre, un bouton, c'est tout.
 */
const {
  SlashCommandBuilder, PermissionFlagsBits, ChannelType,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const tickets = require('../utils/tickets');

const ACCES = PermissionFlagsBits.ManageMessages;

module.exports = {
  categorie: 'moderation',
  data: new SlashCommandBuilder()
    .setName('tickets')
    .setDescription('Système de tickets d’Otaku : panneau, salons privés, transcription (sans image)')
    .setDefaultMemberPermissions(ACCES)
    .addSubcommand((s) => s
      .setName('setup')
      .setDescription('Configure tout en un coup : catégorie, panneau, logs, rôle staff')
      .addChannelOption((o) => o.setName('categorie').setDescription('Catégorie des tickets (sinon, « 📩 Tickets » est créée)')
        .addChannelTypes(ChannelType.GuildCategory))
      .addChannelOption((o) => o.setName('salon').setDescription('Salon du panneau (sinon, « 📩┃ouvrir-un-ticket » est créé dans la catégorie)')
        .addChannelTypes(ChannelType.GuildText))
      .addChannelOption((o) => o.setName('salon_logs').setDescription('Salon des transcriptions (sinon, créé dans la catégorie)')
        .addChannelTypes(ChannelType.GuildText))
      .addRoleOption((o) => o.setName('role_staff').setDescription('Rôle qui prend les tickets (en plus des « Gérer les messages »)')))
    .addSubcommand((s) => s
      .setName('panneau')
      .setDescription('Renvoyer le panneau des tickets quelque part')
      .addChannelOption((o) => o.setName('salon').setDescription('Où (par défaut : le salon des réglages)').addChannelTypes(ChannelType.GuildText))
      .addStringOption((o) => o.setName('titre').setDescription('Titre du panneau (facultatif)').setMaxLength(80))
      .addStringOption((o) => o.setName('texte').setDescription('Texte du panneau (facultatif)').setMaxLength(600)))
    .addSubcommand((s) => s.setName('config').setDescription('Voir les réglages des tickets'))
    .addSubcommand((s) => s
      .setName('ouvrir')
      .setDescription('Ouvrir un ticket pour un membre (sans passer par le panneau)')
      .addUserOption((o) => o.setName('membre').setDescription('Pour qui ?').setRequired(true)))
    .addSubcommand((s) => s.setName('claim').setDescription('Prendre en charge le ticket où tu es (coupe Otaku)'))
    .addSubcommand((s) => s
      .setName('fermer')
      .setDescription('Fermer le ticket où tu es')
      .addStringOption((o) => o.setName('raison').setDescription('La raison (facultatif)').setMaxLength(300)))
    .addSubcommand((s) => s
      .setName('ajouter')
      .setDescription('Donner accès au ticket actuel à un membre')
      .addUserOption((o) => o.setName('membre').setDescription('Qui ajouter ?').setRequired(true)))
    .addSubcommand((s) => s
      .setName('retirer')
      .setDescription('Retirer l’accès au ticket actuel')
      .addUserOption((o) => o.setName('membre').setDescription('Qui retirer ?').setRequired(true)))
    .addSubcommand((s) => s.setName('reparer').setDescription('Supprimer les tickets fantômes (auteur qui a quitté le serveur)'))
    .addSubcommand((s) => s.setName('couper').setDescription('Désactiver les tickets (plus de panneau, plus d’assistant)')),

  async executer(interaction) {
    const refus = perms.verifier(interaction, ACCES);
    if (refus) return panneaux.oups(interaction, '🚫 Action réservée au staff', refus);

    const sub = interaction.options.getSubcommand();
    const G = interaction.guildId;

    if (sub === 'setup') return setup(interaction);
    if (sub === 'panneau') return envoyerPanneau(interaction);
    if (sub === 'config') return carteConfig(interaction);
    if (sub === 'ouvrir') return ouvrirPour(interaction, G);
    if (sub === 'claim') return tickets.claim(interaction);
    if (sub === 'fermer') return fermerParCommande(interaction);
    if (sub === 'ajouter') return tickets.ajouter(interaction, interaction.options.getUser('membre'));
    if (sub === 'retirer') return tickets.retirer(interaction, interaction.options.getUser('membre'));
    if (sub === 'couper') {
      tickets.majReglages(G, { actif: false });
      return panneaux.ok(interaction, '🔕 Tickets coupés', 'Otaku n’ouvre plus rien. Pour tout rallumer : `/tickets setup` (ou `/tickets panneau`).');
    }
    if (sub === 'reparer') {
      const res = await tickets.reparer(interaction.guild);
      return panneaux.ok(interaction, '🧹 Réparation des tickets',
        res.supprimes ? `${res.supprimes} ticket(s) fantôme(s) supprimé(s) : ${res.detail}.` : `Rien à nettoyer — ${res.detail}.`);
    }
    return null;
  },
};

// ─────────────────────────── setup ───────────────────────────

async function setup(interaction) {
  await interaction.deferReply({ flags: 64 });
  const guild = interaction.guild;
  const G = guild.id;
  const r = tickets.reglages(G);

  const catDemandee = interaction.options.getChannel('categorie');
  const salonDemande = interaction.options.getChannel('salon');
  const logsDemande = interaction.options.getChannel('salon_logs');
  const roleDemande = interaction.options.getRole('role_staff');

  let categorie = catDemandee || null;
  if (!categorie) {
    const existante = [...guild.channels.cache.values()].find((c) => c.type === ChannelType.GuildCategory && /tickets?|📩/i.test(c.name || ''));
    categorie = existante || await guild.channels.create({
      name: '📩 Tickets',
      type: ChannelType.GuildCategory,
    });
  }

  const surs = [];
  let salon = salonDemande || null;
  if (!salon) {
    salon = await guild.channels.create({
      name: '📩┃ouvrir-un-ticket',
      type: ChannelType.GuildText,
      parent: categorie.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: guild.members.me?.id ?? interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages] },
      ],
    });
    surs.push(`panneau créé dans <#${salon.id}> (visible du staff d'abord — rends-le public si tu veux qu'on clique dessus partout)`);
  }

  let logs = logsDemande || stockage.reglages(G).logs || null;
  if (!logs) {
    logs = await guild.channels.create({
      name: '📩┃tickets-logs',
      type: ChannelType.GuildText,
      parent: categorie.id,
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
        ...(roleDemande ? [{ id: roleDemande.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory] }] : []),
      ],
    });
    surs.push(`logs de transcription créés dans <#${logs.id}>`);
  }

  const maj = {
    actif: true,
    categorie: categorie.id,
    panneau: salon.id,
    logs: logs.id ?? logs,
    staffRole: roleDemande ? roleDemande.id : r.staffRole || null,
  };
  tickets.majReglages(G, maj);
  const r2 = tickets.reglages(G);
  await salon.send(tickets.panneauMessage(r2, guild.name)).catch(() => null);

  const lignes = [
    `✅ Tickets **activés** — catégorie « ${categorie.name} », panneau <#${salon.id}>, transcriptions <#${maj.logs}>.`,
    maj.staffRole ? `🧑‍💼 Rôle staff reconnu : <@&${maj.staffRole}> (+ tous les « Gérer les messages »).` : '🧑‍💼 Pas de rôle staff dédié : les « Gérer les messages » suffisent.',
    surs.length ? `🔧 ${surs.join(' · ')}.` : null,
    '🤖 Pour que Otaku accueille et questionne dans ces tickets : `/config` → **🤝 Assistant** (il reprendra automatiquement ces réglages).',
    '🖼️ Pas d’image sous le panneau — c’est voulu : une carte propre et un bouton.',
  ].filter(Boolean);
  return panneaux.repondre(interaction, panneaux.succes('📩 Tickets installés', lignes.join('\n')));
}

// ─────────────────────────── panneau ───────────────────────────

async function envoyerPanneau(interaction) {
  const G = interaction.guildId;
  const r = tickets.reglages(G);
  const salon = interaction.options.getChannel('salon') || (r.panneau ? interaction.guild.channels.cache.get(r.panneau) : null) || interaction.channel;
  if (!salon) return panneaux.oups(interaction, '🤔 Salon introuvable', 'Précise « salon », ou règle d’abord le panneau avec `/tickets setup`.');

  const titre = interaction.options.getString('titre');
  const texte = interaction.options.getString('texte');
  if (titre || texte) tickets.majReglages(G, { titre: titre || r.titre, texte: texte || r.texte });
  const r2 = tickets.reglages(G);

  await salon.send(tickets.panneauMessage(r2, interaction.guild.name)).catch(() => null);
  tickets.majReglages(G, { actif: true, panneau: r.panneau || salon.id, categorie: r.categorie || salon.parentId || null });
  return panneaux.ok(interaction, '📩 Panneau envoyé',
    r.categorie ? `Le bouton « Ouvrir un ticket » est en ligne dans <#${salon.id}>.`
      : '⚠️ Panneau envoyé, mais **aucune catégorie de tickets réglée** : les clics ne sauront pas où créer les salons. Refais `/tickets setup` (ou choisis la catégorie dans `/config`).');
}

// ─────────────────────────── config ───────────────────────────

function carteConfig(interaction) {
  const r = tickets.reglages(interaction.guildId);
  const VIDE = '— non défini —';
  const embed = panneaux.info('🎫 Réglages des tickets', 'L’état du système de tickets d’Otaku — rien d’automatique côté visuel, tout est réglable.')
    .addFields(
      { name: '🎛️ État', value: r.actif ? '✅ activé' : '⬜ coupé', inline: true },
      { name: '📁 Catégorie', value: r.categorie ? `<#${r.categorie}> (id)` : VIDE, inline: true },
      { name: '🧾 Panneau', value: r.panneau ? `<#${r.panneau}>` : VIDE, inline: true },
      { name: '📜 Transcriptions', value: r.logs ? `<#${r.logs}>` : VIDE, inline: true },
      { name: '🧑‍💼 Rôle staff', value: r.staffRole ? `<@&${r.staffRole}>` : '« Gérer les messages » seulement', inline: true },
      { name: '🖼️ Image sous le panneau', value: '❌ jamais — c’est un choix assumé' },
    );
  return panneaux.repondre(interaction, embed);
}

// ─────────────────────────── ouvrir / fermer à la main ───────────────────────────

async function ouvrirPour(interaction, G) {
  const r = tickets.reglages(G);
  if (!r.actif || !r.categorie) return panneaux.oups(interaction, '⏳ Pas encore de tickets', 'Lance d’abord `/tickets setup`.');
  const cible = interaction.options.getUser('membre');
  let membre;
  try { membre = await interaction.guild.members.fetch(cible.id); } catch { membre = null; }
  if (!membre || membre.user.bot) return panneaux.oups(interaction, '🤔 Membre introuvable', 'Choisis un vrai membre du serveur (pas un bot).');
  const deja = tickets.ticketOuvert(interaction.guild, cible.id, r);
  if (deja) return panneaux.attention(interaction, '📂 Déjà un ticket ouvert', `<@${cible.id}> a déjà <#${deja.id}> — continue là-bas.`);

  const copie = {
    user: interaction.user,
    guild: interaction.guild,
    client: interaction.client,
    channel: interaction.channel,
    reply: (p) => interaction.reply(p),
  };
  await tickets.ouvrirViaStaff(copie, r, membre);
  return true;
}

function fermerParCommande(interaction) {
  return tickets.fermer(interaction, (interaction.options.getString('raison') || '').trim());
}
