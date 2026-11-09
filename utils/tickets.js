/**
 * utils/tickets.js — le système de tickets autonome d'Otaku.
 *
 * Même usage qu'un bot de tickets classique : un panneau avec un bouton
 * « Ouvrir un ticket », un salon privé créé pour la conversation, les boutons
 * du staff dans le ticket (prendre en charge, fermer), une transcription
 * envoyée au salon des logs quand le ticket se ferme.
 *
 * Ce qu'il n'a PAS, volontairement : pas d'image générée sous le panneau,
 * pas de bannière, pas de menu-fresque — juste une carte propre et un bouton.
 *
 * L'engrenage est une fonction pure sur des objets Discord (interactions,
 * canaux) : rien n'est importé de discord.js à part les Builders ; les tests
 * injectent des faux canaux et vérifient exactement les mêmes chemins.
 */
const {
  EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, ChannelType,
  PermissionFlagsBits,
} = require('discord.js');
const stockage = require('./stockage');
const journal = require('./journal');

const MARQUE = 'otaku-ticket:';          // préfixe du topic = la vérité du ticket
const FICHIER_ETAT = 'tickets-panneaux'; // (réservé : le panneau est retrouvé par marque, pas par fichier)
let DELAI_SUPPRESSION = 5000;            // le temps de lire « fermé » avant que le salon disparaisse

// ─────────────────────────── réglages ───────────────────────────

function reglages(guildId) {
  const r = stockage.reglages(guildId).tickets || {};
  return {
    actif: Boolean(r.actif),
    categorie: r.categorie || null,
    panneau: r.panneau || null,
    logs: r.logs || null,
    staffRole: r.staffRole || null,
    titre: r.titre || null,
    texte: r.texte || null,
    mode: r.mode === 'menu' ? 'menu' : 'bouton',
    types: Array.isArray(r.types) ? r.types : [],
  };
}

/** Une ligne réglée par le staff (« 😀 Support » ou juste « Support ») → { emoji, nom, slug }. */
function parseTypes(liste) {
  const vus = new Set();
  const sur = [];
  for (const brute of (liste || [])) {
    const l = String(brute || '').trim();
    if (!l) continue;
    const m = l.match(/^([^\p{L}\p{N}]+)\s*(.+)$/u);
    const emoji = m ? m[1].trim() : null;
    const nom = ((m ? m[2] : l) || l).trim().slice(0, 40);
    if (!nom) continue;
    let slug = nom.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || `t${sur.length + 1}`;
    while (vus.has(slug)) slug += 'x';
    vus.add(slug);
    sur.push({ emoji, nom, slug });
    if (sur.length >= 6) break;
  }
  return sur;
}

function majReglages(guildId, morceau) {
  return stockage.majReglages(guildId, { tickets: morceau });
}

// ─────────────────────────── reconnaissance ───────────────────────────

function estTicket(canal) {
  return Boolean(canal) && canal.type === 0 && String(canal.topic || '').startsWith(MARQUE);
}

function typeDe(canal) {
  const m = String(canal?.topic || '').match(/ · type:(.+)$/);
  return m ? m[1] : null;
}

function auteurDe(canal) {
  const m = String(canal?.topic || '').match(new RegExp('^' + MARQUE + '([^\\s·]+)'));
  return m ? m[1] : null;
}

function preneurDe(canal) {
  const m = String(canal?.topic || '').match(/ · pris:([^\s·]+)/);
  return m ? m[1] : null;
}

function estStaff(membre, r) {
  if (!membre) return false;
  try {
    if (membre.permissions?.has?.(PermissionFlagsBits.ManageMessages)) return true;
    if (r.staffRole && membre.roles?.cache?.has?.(r.staffRole)) return true;
  } catch { /* membre sans permissions (vieux message) : ce n'est pas du staff */ }
  return false;
}

/** Le ticket déjà ouvert de ce membre dans la catégorie (dédouanement anti-doublon). */
function ticketOuvert(guild, userId, r) {
  if (!guild || !userId) return null;
  let trouve = null;
  try {
    for (const c of guild.channels.cache.values?.() || []) {
      if (c?.parentId === r.categorie && estTicket(c) && auteurDe(c) === String(userId) && !String(c.topic).includes(' · clos')) {
        trouve = c;
        break;
      }
    }
  } catch { /* cache indisponible (mocks légers) */ }
  return trouve;
}

function nomDuTicket(membre) {
  const base = String(membre.username || membre.displayName || 'ticket')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 24) || 'ticket';
  return `ticket-${base}`;
}

// ─────────────────────────── le panneau (sans image, jamais) ───────────────────────────

/** Le message du panneau : une carte, puis les boutons OU le menu déroulant selon le mode.
 *  Aucun fichier, aucune image : c'est voulu. */
function panneauMessage(r, guildName) {
  const embed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle(r.titre || '📩 Besoin d’aide ? Ouvre un ticket')
    .setDescription(String(r.texte || [
      `**${guildName || 'Le serveur'}** — écris-nous en privé, en toute discrétion.`,
      '',
      'Un membre du staff te répond ici même, dans un salon rien que pour toi.',
      'Décris ton problème dès le premier message : on ira plus vite.',
    ].join('\n')).slice(0, 1800))
    .setFooter({ text: 'Otaku · les tickets — pas de formulaire, pas de file d’attente à rallonge' });
  const types = parseTypes(r.types);
  const unBouton = () => [new ActionRowBuilder().addComponents(new ButtonBuilder()
    .setCustomId('tik:ouvrir').setLabel('Ouvrir un ticket').setEmoji('📩').setStyle(ButtonStyle.Success))];

  let rangees;
  if (!types.length) {
    rangees = unBouton();                      // aucun type réglé : le gros bouton unique, dans les deux modes
  } else if (r.mode === 'menu') {
    const menu = new StringSelectMenuBuilder().setCustomId('tik:type')
      .setPlaceholder('📋 Choisis le type de ta demande');
    for (const t of types) {
      const o = { label: t.nom.slice(0, 100), value: t.slug };
      if (t.emoji) o.emoji = { name: t.emoji };
      menu.addOptions(o);
    }
    rangees = [new ActionRowBuilder().addComponents(menu)];
  } else {
    rangees = [];
    let ligne = new ActionRowBuilder();
    for (const t of types) {
      const b = new ButtonBuilder().setCustomId(`tik:ouvrir:${t.slug}`)
        .setLabel(t.nom.slice(0, 40)).setStyle(ButtonStyle.Success);
      if (t.emoji) b.setEmoji(t.emoji);
      ligne.addComponents(b);
      if (ligne.components.length === 5) { rangees.push(ligne); ligne = new ActionRowBuilder(); }
    }
    if (ligne.components.length) rangees.push(ligne);
  }
  return { embeds: [embed], components: rangees };
}

// ─────────────────────────── ouvrir ───────────────────────────

async function ouvrir(interaction, typeNom = null) {
  const guild = interaction.guild;
  const membre = interaction.member;
  const r = reglages(guild?.id);
  if (!r.actif || !r.categorie) {
    return interaction.reply({
      content: '⏳ Les tickets ne sont pas encore configurés sur ce serveur — demande à un administrateur de faire `/tickets setup`.',
      flags: 64,
    }).then(() => true).catch(() => true);
  }

  const deja = ticketOuvert(guild, interaction.user.id, r);
  if (deja) {
    return interaction.reply({
      content: `📂 Tu as déjà un ticket ouvert : <#${deja.id}> — continue la conversation là-bas.`,
      flags: 64,
    }).then(() => true).catch(() => true);
  }

  const permis = [
    { id: guild.roles?.everyone?.id ?? '@everyone', deny: [PermissionFlagsBits.ViewChannel] },
    { id: interaction.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: interaction.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
  ];
  if (r.staffRole) {
    permis.push({ id: r.staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });
  }

  const canal = await guild.channels.create({
    name: nomDuTicket(interaction.user),
    type: ChannelType.GuildText,
    parent: r.categorie,
    topic: `${MARQUE}${interaction.user.id}${typeNom ? ` · type:${typeNom}` : ''}`,
    permissionOverwrites: permis,
  });

  const accueil = new EmbedBuilder()
    .setColor(0x3ba55d)
    .setTitle(typeNom ? `👋 Ticket ouvert — ${typeNom}` : '👋 Ton ticket est ouvert')
    .setDescription([
      `<@${interaction.user.id}>, décris ta demande ici — le staff te répondra dans ce salon.`,
      '',
      '**Pour le staff** : ✋ *Prendre en charge* dit à Otaku de livrer son résumé et de se retirer.',
      '**Pour toi** : 🔒 *Fermer le ticket* quand tout est réglé (une transcription partira dans les logs).',
    ].join('\n'))
    .setFooter({ text: 'Otaku · ticket privé — ni image, ni formulaire : juste la conversation' });

  const rangee = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`tik:claim:${canal.id}`).setLabel('Prendre en charge').setEmoji('✋').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`tik:fermer:${canal.id}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
  );

  await canal.send({
    content: `<@${interaction.user.id}>`,
    embeds: [accueil],
    components: [rangee],
    allowedMentions: { parse: [] },
  }).catch(() => null);

  await interaction.reply({ content: `📩 C'est ouvert : <#${canal.id}> — va écrire là-bas.`, flags: 64 }).catch(() => null);

  await journal.journaliser(guild, {
    type: 'auto',
    titre: '📩 Ticket ouvert',
    details: `Ticket de ${interaction.user.tag || interaction.user.username} — salon #${canal.name}${typeNom ? ` (motif : ${typeNom})` : ''}.`,
    cible: { id: interaction.user.id, nom: interaction.user.username },
    lien: canal.id,
  }).catch(() => null);

  return true;
}

// ─────────────────────────── claim (le staff prend la main) ───────────────────────────

async function claim(interaction) {
  const canal = interaction.channel;
  if (!estTicket(canal)) {
    return interaction.reply({ content: '🤔 Ce salon n’est pas un ticket Otaku — la prise en charge se fait dans le ticket lui-même.', flags: 64 }).then(() => true).catch(() => true);
  }
  const r = reglages(interaction.guild?.id);
  if (!estStaff(interaction.member, r)) {
    return interaction.reply({ content: '🚫 Seuls les membres du staff peuvent prendre un ticket en charge.', flags: 64 }).then(() => true).catch(() => true);
  }
  if (preneurDe(canal)) {
    return interaction.reply({ content: 'ℹ️ Ce ticket a déjà été pris en charge — pas besoin de repasser.', flags: 64 }).then(() => true).catch(() => true);
  }

  const topic = `${String(canal.topic || '')} · pris:${interaction.user.id}`;
  await canal.setTopic(topic).catch(() => null);
  canal.topic = topic;   // pour les environnements légers (tests) et la suite du tour

  // Otaku l'assistant se tait pour de bon dans ce ticket (marque persistée).
  try { require('./assistant-ticket').marquerClos(canal.id); } catch { /* assistant absent ou coupé : pas grave */ }

  await interaction.reply({ content: `✋ Ticket pris en charge par **${interaction.user.username}**. Otaku se retire de la conversation.`, flags: 64 }).catch(() => null);
  return true;
}

// ─────────────────────────── fermer (modal raison → transcription → suppression) ───────────────────────────

function modalFermeture(interaction) {
  const avant = interaction.channel;
  if (!estTicket(avant)) {
    return interaction.reply({ content: '🤔 Ce salon n’est pas un ticket Otaku.', flags: 64 }).then(() => true).catch(() => true);
  }
  const rAvant = reglages(interaction.guild?.id);
  if (!estStaff(interaction.member, rAvant) && auteurDe(avant) !== String(interaction.user.id)) {
    return interaction.reply({ content: '🚫 Seule la personne concernée ou le staff peut fermer ce ticket.', flags: 64 }).then(() => true).catch(() => true);
  }
  const modal = new ModalBuilder().setCustomId(`tik:raison:${interaction.channel.id}`).setTitle('🔒 Fermer le ticket');
  const raison = new TextInputBuilder()
    .setCustomId('raison')
    .setLabel('Raison de la fermeture (facultatif)')
    .setPlaceholder('ex. : problème résolu, membre introuvable, doublon…')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(300)
    .setRequired(false);
  modal.addComponents(new ActionRowBuilder().addComponents(raison));
  return interaction.showModal(modal).catch(() => null).then(() => true);
}

/** Construit la carte de transcription depuis une liste de messages (exportée pour les tests). */
function carteTranscription(infos, messages) {
  const lignes = (messages || []).slice(0, 40).map((m) => {
    const auteur = m.author?.username || m.author?.tag || '?';
    const contenu = String(m.content || '').replace(/\s+/g, ' ').slice(0, 140) || (m.embeds?.length ? '*(carte)*' : '*(pièce jointe)*');
    return `**${auteur}** : ${contenu}`;
  });
  const extrait = lignes.slice(0, 12).join('\n').slice(0, 1000) || '*(aucun message)*';
  const embed = new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('🔒 Ticket fermé')
    .setDescription([
      `**Salon** : ${infos.nom}`,
      `**Ouvert pour** : ${infos.auteur}`,
      infos.preneur ? `**Pris en charge par** : ${infos.preneur}` : '**Pris en charge par** : personne',
      `**Fermé par** : ${infos.fermePar}`,
      infos.raison ? `**Raison** : ${infos.raison}` : null,
      '',
      `**${infos.nbMessages}** message(s) échangés.`,
    ].filter(Boolean).join('\n'))
    .addFields({ name: '💬 Début de la conversation', value: extrait });
  return embed;
}

async function fermer(interaction, raison) {
  const canal = interaction.channel;
  if (!estTicket(canal)) {
    return interaction.reply({ content: '🤔 Ce salon n’est pas un ticket Otaku.', flags: 64 }).then(() => true).catch(() => true);
  }
  const r = reglages(interaction.guild?.id);
  const auteurId = auteurDe(canal);
  if (!estStaff(interaction.member, r) && auteurId !== String(interaction.user.id)) {
    return interaction.reply({ content: '🚫 Seule la personne concernée ou le staff peut fermer ce ticket.', flags: 64 }).then(() => true).catch(() => true);
  }

  let messages = [];
  try {
    const collecte = await canal.messages?.fetch?.({ limit: 100 });
    messages = collecte ? [...collecte.values?.() || collecte] : [];
  } catch { messages = []; }

  const infos = {
    nom: `#${canal.name}`,
    auteur: `<@${auteurId || '?'}>`,
    preneur: preneurDe(canal) ? `<@${preneurDe(canal)}>` : null,
    fermePar: interaction.user.tag || `@${interaction.user.username}`,
    raison: raison ? journal.chapper(String(raison), 280) : null,
    nbMessages: messages.length,
  };

  const logs = r.logs ? interaction.guild.channels.cache.get?.(r.logs) : null;
  if (logs) {
    const embed = carteTranscription(infos, messages);
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tik:relancer:${auteurId}`).setLabel('Rouvrir ce ticket').setEmoji('🔁').setStyle(ButtonStyle.Secondary),
    );
    await logs.send({ embeds: [embed], components: [row], allowedMentions: { parse: [] } }).catch(() => null);
  }

  await interaction.reply({ content: '🔒 Ticket fermé. Transcription envoyée au staff — le salon disparaît dans quelques secondes.', flags: 64 }).catch(() => null);

  await journal.journaliser(interaction.guild, {
    type: 'mod',
    titre: '🔒 Ticket fermé',
    details: `${infos.nom} — fermé par ${infos.fermePar}${infos.raison ? ` (${infos.raison})` : ''} après ${infos.nbMessages} message(s).`,
    cible: auteurId ? { id: auteurId } : null,
  }).catch(() => null);

  await supprimerApresDelai(canal);
  return true;
}

async function supprimerApresDelai(canal) {
  if (DELAI_SUPPRESSION <= 0) {          // mode test (ou retrait immédiat) : pas de minuterie
    await canal.delete('Ticket fermé').catch(() => null);
    return;
  }
  return new Promise((resoudre) => {
    const minuterie = setTimeout(() => {
      canal.delete('Ticket fermé').catch(() => null);
      resoudre();
    }, DELAI_SUPPRESSION);
    minuterie.unref?.();                  // une minuterie en attente ne doit jamais retenir le processus
  });
}

// ─────────────────────────── relancer depuis les logs ───────────────────────────

async function relancer(interaction, userId) {
  const r = reglages(interaction.guild?.id);
  if (!r.actif || !r.categorie) {
    return interaction.reply({ content: '⏳ Les tickets sont coupés — impossible de rouvrir.', flags: 64 }).then(() => true).catch(() => true);
  }
  if (!estStaff(interaction.member, r)) {
    return interaction.reply({ content: '🚫 Rouvrir un ticket est réservé au staff.', flags: 64 }).then(() => true).catch(() => true);
  }
  let membre;
  try { membre = await interaction.guild.members.fetch(userId); } catch { membre = null; }
  if (!membre) {
    return interaction.reply({ content: '❌ Cette personne n’est plus sur le serveur — rien à rouvrir.', flags: 64 }).then(() => true).catch(() => true);
  }
  const deja = ticketOuvert(interaction.guild, userId, r);
  if (deja) {
    return interaction.reply({ content: `ℹ️ Son ticket est toujours ouvert : <#${deja.id}>.`, flags: 64 }).then(() => true).catch(() => true);
  }

  // même mécanique qu'à l'ouverture, mais déclenchée par le staff pour le membre.
  const copie = {
    ...interaction,
    user: membre.user,
    member: membre,
    reply: async (p) => interaction.reply(p),
  };
  await ouvrirViaStaff(copie, r, membre, true);
  return true;
}

async function ouvrirViaStaff(ctx, r, membre, relance = false) {
  const guild = ctx.guild;
  const permis = [
    { id: guild.roles?.everyone?.id ?? '@everyone', deny: [PermissionFlagsBits.ViewChannel] },
    { id: membre.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks] },
    { id: ctx.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.AttachFiles] },
  ];
  if (r.staffRole) permis.push({ id: r.staffRole, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageMessages] });

  const canal = await guild.channels.create({
    name: nomDuTicket(membre.user),
    type: ChannelType.GuildText,
    parent: r.categorie,
    topic: `${MARQUE}${membre.id}`,
    permissionOverwrites: permis,
  });
  await canal.send({
    content: `<@${membre.id}>`,
    embeds: [new EmbedBuilder().setColor(relance ? 0xfaa61a : 0x3ba55d)
      .setTitle(relance ? '🔁 Ticket rouvert par le staff' : '📩 Ticket ouvert par le staff')
      .setDescription(relance
        ? 'Le staff a rouvert ce dossier — réponds ici pour reprendre la conversation.'
        : `Ouvert pour <@${membre.id}> par **${ctx.user.username}** — décrivez la situation ici.`)],
    components: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`tik:claim:${canal.id}`).setLabel('Prendre en charge').setEmoji('✋').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId(`tik:fermer:${canal.id}`).setLabel('Fermer le ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger),
    )],
    allowedMentions: { parse: [] },
  }).catch(() => null);
  await ctx.reply({ content: `${relance ? '🔁 Ticket rouvert' : '📩 Ticket ouvert'} : <#${canal.id}>`, flags: 64 }).catch(() => null);
  return canal;
}

// ─────────────────────────── ajouter / retirer une personne ───────────────────────────

async function ajouter(interaction, cible) {
  const canal = interaction.channel;
  if (!estTicket(canal)) return interaction.reply({ content: '🤔 Pas un ticket Otaku ici.', flags: 64 }).then(() => true).catch(() => true);
  await canal.permissionOverwrites?.create?.(cible.id, {
    [PermissionFlagsBits.ViewChannel]: true,
    [PermissionFlagsBits.SendMessages]: true,
    [PermissionFlagsBits.ReadMessageHistory]: true,
  }).catch(() => null);
  return interaction.reply({ content: `➕ <@${cible.id}> peut lire et écrire dans ce ticket.`, flags: 64 }).then(() => true).catch(() => null);
}

async function retirer(interaction, cible) {
  const canal = interaction.channel;
  if (!estTicket(canal)) return interaction.reply({ content: '🤔 Pas un ticket Otaku ici.', flags: 64 }).then(() => true).catch(() => null);
  if (auteurDe(canal) === String(cible.id)) {
    return interaction.reply({ content: '🚫 On ne vire pas l’auteur du ticket de son propre ticket — ferme-le, tout simplement.', flags: 64 }).then(() => true).catch(() => true);
  }
  await canal.permissionOverwrites?.delete?.(cible.id).catch(() => null);
  return interaction.reply({ content: `➖ <@${cible.id}> n’a plus accès à ce ticket.`, flags: 64 }).then(() => true).catch(() => true);
}

// ─────────────────────────── réparer les fantômes ───────────────────────────

/** Supprime les salons marqués « ticket » dont l'auteur a quitté le serveur (le fameux « tu as déjà un ticket » éternel). */
async function reparer(guild) {
  const r = reglages(guild.id);
  if (!r.categorie) return { supprimes: 0, detail: 'aucune catégorie de tickets réglée' };
  let supprimes = 0;
  const noms = [];
  for (const c of guild.channels.cache.values?.() || []) {
    if (c?.parentId !== r.categorie || !estTicket(c)) continue;
    const auteurId = auteurDe(c);
    let present = true;
    try { await guild.members.fetch(auteurId); } catch { present = false; }
    if (present) continue;
    noms.push(c.name);
    await c.delete('Réparation : l’auteur n’est plus sur le serveur').catch(() => null);
    supprimes++;
  }
  return { supprimes, detail: supprimes ? noms.join(', ') : 'aucun fantôme — tout est propre' };
}

// ─────────────────────────── routeur des composants ───────────────────────────

async function composant(interaction) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('tik:')) return false;
  const morceaux = id.split(':');
  const acte = morceaux[1];

  if (interaction.isModalSubmit?.() && acte === 'raison') {
    const raison = interaction.fields?.getTextInputValue?.('raison') || '';
    return fermer(interaction, raison.trim());
  }
  if (interaction.isStringSelectMenu?.() && acte === 'type') {
    const slug = String((interaction.values && interaction.values[0]) || '');
    const t = parseTypes(reglages(interaction.guild?.id).types).find((x) => x.slug === slug);
    return ouvrir(interaction, t ? t.nom : null);
  }
  if (!interaction.isButton?.()) return false;

  if (acte === 'ouvrir') {
    const slug = morceaux[2] || null;
    const t = slug ? parseTypes(reglages(interaction.guild?.id).types).find((x) => x.slug === slug) : null;
    return ouvrir(interaction, t ? t.nom : null);
  }
  if (acte === 'claim') return claim(interaction);
  if (acte === 'fermer') return modalFermeture(interaction);
  if (acte === 'relancer') return relancer(interaction, morceaux[2]);
  return false;
}

// ─────────────────────────── exposition ───────────────────────────

module.exports = {
  reglages, majReglages, estTicket, auteurDe, preneurDe, typeDe, estStaff, parseTypes,
  ticketOuvert, nomDuTicket, ouvrirViaStaff,
  panneauMessage, ouvrir, claim, modalFermeture, fermer, relancer,
  ajouter, retirer, reparer, composant, carteTranscription,
  MARQUE,
  // pour les tests uniquement :
  __setDelaiSuppression(ms) { DELAI_SUPPRESSION = ms; },
};
