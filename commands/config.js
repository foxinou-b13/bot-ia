/**
 * commands/config.js — le panneau de configuration, en « cartes indépendantes ».
 *
 *   /config → carte 1 : le sélecteur de RUBRIQUES, rien d'autre ;
 *   rubrique choisie → sa carte : ce qu'elle fait + ses réglages en menu ;
 *   réglage choisi → SA carte : description, valeur actuelle, et le contrôle
 *   (menu / sélecteur / bouton) uniquement pour ce réglage.
 *   Bouton « ← Retour » partout. Zéro saisie dans le chat, zéro mélange.
 *
 * Chaque réglage s'applique instantanément (les commandes lisent stockage.reglages
 * à chaque fois) ; la persistance.mongo les sauvegarde en arrière-plan.
 */
const {
  SlashCommandBuilder, PermissionsBitField, ActionRowBuilder,
  StringSelectMenuBuilder, ChannelSelectMenuBuilder, RoleSelectMenuBuilder,
  ButtonBuilder, ButtonStyle, ChannelType, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,
} = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');
const ia = require('../utils/ia');
const bienvenueImage = require('../utils/bienvenue-image');

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

/**
 * Bouton « 📱 Choisir une image » : l'URL discord://?cmd=<id> ouvre DIRECTEMENT
 * la commande /image-bienvenue chez l'admin (galerie sur mobile, fichiers sur PC).
 * L'ID de commande est récupéré auprès de Discord puis gardé 10 minutes en cache ;
 * en cas d'indisponibilité, on l'omet simplement — le champ URL et la commande
 * tapée à la main restent des solutions de repli.
 */


// ─── les rubriques, et dans chaque rubrique : un réglage = une carte ───
const RUBRIQUES = {
  accueil: {
    label: '👋 Accueil des nouveaux',
    aide: 'Carte de bienvenue, message, rôle automatique',
    intro: 'Quand un membre arrive, Otaku envoie la **carte-image de bienvenue** (sa photo + BIENVENUE) et le mentionne. Choisis un réglage ci-dessous — chacun a sa carte.',
    items: {
      salon: {
        label: '📋 Salon de bienvenue',
        desc: 'Le salon où Otaku envoie la carte quand un nouveau arrive. Choisis-le dans le menu.\n*Pour arrêter l\'accueil : l\'option « 🔕 Couper l\'accueil ».*',
      },
      role: {
        label: '🎭 Rôle automatique',
        desc: 'Le rôle donné tout seul aux nouveaux membres (ex. « Membre » pour ouvrir les salons). Optionnel.\n⚠️ Le rôle doit être **en dessous** du rôle d\'Otaku dans la liste des rôles du serveur, sinon Discord refuse de le donner.',
      },
      langue: {
        label: '🌍 Langue de la carte',
        desc: 'Le grand mot écrit sur la carte-image de bienvenue. Français ou anglais — le pseudo du nouveau est toujours affiché dessous.',
      },
      fond: {
        label: '🖼️ Image de fond de la carte',
        desc: 'Le décor derrière la photo du nouveau.\n• **Rien à faire par défaut** : le bot utilise l\'image prévue pour ton serveur (prairie de cosmos).\n• **Envie d\'une autre image ?** Touche « 📱 Choisir une image » : le bot poste une invitation juste au-dessus — tu y **réponds avec ton image** (📎 → galerie du téléphone, fichiers sur PC). Il vérifie, recadre tout seul au format de la carte, te montre l\'aperçu réel, puis **efface les deux messages** : rien ne traîne dans le salon, aucun message privé.\n• « 🔗 Adresse d\'image » : si tu préfères coller un lien. « 🌸 Fond par défaut » : pour y revenir à tout moment.',
      },
      message: {
        label: '✏️ Message d\'accroche',
        desc: 'Un petit texte écrit par-dessus la carte, si tu veux ajouter quelque chose (facultatif).\nLes mots-clés sont remplacés tout seuls : `{membre}` = la mention du nouveau, `{serveur}` = le nom du serveur, `{nombre}` = son rang d\'arrivée.',
      },
      couper: {
        label: '🔕 Couper l\'accueil',
        desc: 'Désactive complètement la bienvenue : plus aucune carte ni mention quand un membre arrive. Les autres réglages sont gardés, tu pourras tout rallumer en rechoisissant un salon.',
      },
    },
  },
  salons: {
    label: '📋 Salons & repères',
    aide: 'Logs du staff, règles, contacter le staff',
    intro: 'Les salons que Otaku utilise pour s\'occuper du serveur (journaux du staff, règles, aide). Un réglage = une carte.',
    items: {
      logs: {
        label: '🗂️ Journal du staff',
        desc: 'Salon PRIVÉ où Otaku note tout ce qui compte : sanctions, alertes auto-mod, suppressions de messages. Choisis un salon que seuls tes modérateurs voient.',
      },
      regles: {
        label: '📜 Salon des règles',
        desc: 'Quand un membre demande les règles (commande /guide), Otaku l\'oriente vers ce salon.',
      },
      support: {
        label: '🛟 Contacter le staff',
        desc: 'Quand un membre demande de l\'aide (commande /aide), Otaku l\'oriente vers ce salon où le staff le verra.',
      },
    },
  },
  automod: {
    label: '🛡️ Auto-modération',
    aide: 'Spam, liens, insultes, majuscules, raid',
    intro: 'Otaku filtre tout seul les comportements problématiques. Active ou non chaque module — la liste est sur sa carte.',
    items: {
      modules: {
        label: '🧰 Modules de filtrage',
        desc: 'Menu à coches : laisse cochés les modules que tu veux ACTIFS, décoche ceux que tu veux couper. Le changement est immédiat.',
      },
      exempt: {
        label: '🤫 Salon exempté',
        desc: 'Un salon où l\'auto-mod ne filtre JAMAIS rien (ex. « spam-contrôlé », poste de liens autorisés). Les autres salons restent protégés.',
      },
    },
  },
  sanctions: {
    label: '⚖️ Sanctions automatiques',
    aide: 'Mute automatique après des avertissements',
    intro: 'Après plusieurs avertissements (/warn), Otaku peut mettre l\'auteur en sourdine tout seul. Choisis la formule sur la carte.',
    items: {
      formule: {
        label: '⚙️ Formule de la sanction',
        desc: 'Combien d\'avertissements avant la sourdine, et pour combien de temps. « Désactiver » laisse les /warn seuls, sans mute automatique.',
      },
    },
  },
  ia: {
    label: '🤖 Intelligence artificielle',
    aide: 'Activer/couper par salon, personnalité',
    intro: 'Le mode discussion IA (commande /ask). Tu peux la couper dans certains salons et changer sa personnalité.',
    items: {
      ici: {
        label: '🔇 IA dans ce salon',
        desc: 'Coupe ou réactive l\'IA pour LE salon où tu te trouves en ce moment (celui où tu as tapé /config). Pratique pour les salons sérieux.',
      },
      personnalite: {
        label: '🎭 Personnalité de l\'IA',
        desc: 'Comment l\'IA doit se tenir : ton, longueur des réponses, spécialité… Exemple : « réponds en 2 phrases, ton pirate, parle japonais quand on te demande ». Vide = personnalité standard.',
      },
      memo: {
        label: '🧠 Oublier la conversation',
        desc: 'Efface la mémoire de l\'IA pour CE salon : elle repart de zéro (utile après une conversation partie en vrille).',
      },
    },
  },
};

const SECTIONS = Object.entries(RUBRIQUES).map(([valeur, r]) => ({ valeur, label: r.label, aide: r.aide }));

const rang = (...composants) => new ActionRowBuilder().addComponents(...composants);
const bouton = (id, libelle, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(libelle).setEmoji(emoji).setStyle(style);

const boutonRetour = () => rang(bouton('cfg:retour', '← Retour à la rubrique', '↩️'));

// ─── carte 1 : les rubriques, rien d'autre ───
function ecranRacine(note = null) {
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle('⚙️ Configuration d\'Otaku')
    .setDescription([
      note,
      note ? '' : null,
      'Choisis une **rubrique** dans le menu : tu verras ensuite ses réglages, **un par un, chacun sur sa carte** avec son explication.',
      'Tout se fait par menus — rien à taper dans le chat. Chaque changement est enregistré tout de suite.',
    ].filter((l) => l !== null && l !== undefined && l !== '').join('\n'));
  const select = rang(new StringSelectMenuBuilder()
    .setCustomId('cfg:section')
    .setPlaceholder('⚙️ Que veux-tu configurer ?')
    .addOptions(SECTIONS.map((s) => ({ label: s.label, value: s.valeur, description: s.aide.slice(0, 95) }))));
  return { embeds: [embed], components: [select] };
}

// ─── état lisible des réglages, pour les cartes ───
function etatAccueil(G) {
  const b = stockage.reglages(G).bienvenue || {};
  return {
    salon: b.salon ? `<#${b.salon}>` : '_non défini — accueil coupé_',
    role: b.role ? `<@&${b.role}>` : '_aucun_',
    langue: b.langue === 'en' ? 'WELCOME (anglais)' : 'BIENVENUE (français)',
    fond: b.fond ? `🖼️ image perso : <${b.fond}>` : '🌸 fond par défaut du serveur (cosmos)',
    message: b.message ? `\`${String(b.message).slice(0, 90)}\`` : '_le message standard du bot_',
  };
}

function carteRubrique(G, sec, channelId, note) {
  const r = stockage.reglages(G);
  const rub = RUBRIQUES[sec];
  const embed = new EmbedBuilder().setColor(COULEUR).setTitle(rub.label).setDescription(
    [note ? `**${note}**\n` : null, rub.intro, '\n👇 Choisis le réglage que tu veux changer — il aura sa propre carte.']
      .filter(Boolean).join('\n'),
  );
  const a = r.automod || {};
  if (sec === 'accueil') {
    const e = etatAccueil(G);
    embed.addFields(
      { name: '📋 Salon de bienvenue', value: e.salon, inline: true },
      { name: '🎭 Rôle automatique', value: e.role, inline: true },
      { name: '🌍 Langue de la carte', value: e.langue, inline: true },
      { name: '🖼️ Fond de la carte', value: e.fond, inline: true },
      { name: '✏️ Message', value: e.message },
    );
  } else if (sec === 'salons') {
    embed.addFields(
      { name: '🗂️ Journal du staff', value: r.logs ? `<#${r.logs}>` : '_non défini_', inline: true },
      { name: '📜 Salon des règles', value: r.guide.regles ? `<#${r.guide.regles}>` : '_non défini_', inline: true },
      { name: '🛟 Contacter le staff', value: r.guide.support ? `<#${r.guide.support}>` : '_non défini_', inline: true },
    );
  } else if (sec === 'automod') {
    const actifs = Object.entries(MODULES).filter(([cle]) => a[cle]).map(([, m]) => m.nom);
    embed.addFields(
      { name: '🧰 Modules actifs', value: actifs.length ? actifs.join(' · ') : '_aucun — tout est coupé_' },
      { name: '🤫 Salon exempté', value: a.salonExempt ? `<#${a.salonExempt}>` : '_aucun_', inline: true },
    );
  } else if (sec === 'sanctions') {
    embed.addFields({
      name: '⚖️ Formule actuelle',
      value: a.sanctionAuto ? `**${a.seuilAvert || 3}** avertissement(s) → sourdine **${a.dureeSanction || 60} min**` : '_désactivée — les avertissements s\'empilent sans effet_',
    });
  } else if (sec === 'ia') {
    const iaR = r.ia || {};
    const coupeeIci = Boolean(channelId && (iaR.salonBloques || []).includes(channelId));
    embed.addFields(
      { name: '🤖 État pour ce salon', value: iaR.active === false ? '_coupée partout_' : (coupeeIci ? '🔇 coupée ici' : '🟢 active ici'), inline: true },
      { name: '🎭 Personnalité', value: iaR.consigne ? `> ${String(iaR.consigne).slice(0, 90)}` : '_standard_', inline: true },
    );
  }
  const menu = rang(new StringSelectMenuBuilder()
    .setCustomId('cfg:item')
    .setPlaceholder('🔧 Quel réglage veux-tu changer ?')
    .addOptions(Object.entries(rub.items).map(([cle, it]) => ({
      label: it.label.slice(0, 90), value: `${sec}:${cle}`, description: it.desc.split('\n')[0].replace(/[*`]/g, '').slice(0, 95),
    }))));
  return { embeds: [embed], components: [menu, rang(bouton('cfg:racine', 'Changer de rubrique', '🏠'))] };
}

// ─── la carte PROPRE d'un réglage : description + valeur + son seul contrôle ───
function boutonFondPersonnalisee() {
  return [
    bouton('cfg:accueil:fond-pj', 'Choisir une image', '📱', ButtonStyle.Primary),
    bouton('cfg:accueil:fond-url', 'Adresse d\'image (URL)', '🔗'),
    bouton('cfg:accueil:fond-off', 'Fond par défaut', '🌸'),
  ];
}

function carteReglage(G, sec, cle, channelId, note = null, opts = {}) {
  const it = (RUBRIQUES[sec].items || {})[cle];
  if (!it) return carteRubrique(G, sec, channelId, note);
  const r = stockage.reglages(G);
  const a = r.automod || {};
  const b = r.bienvenue || {};
  const iaR = r.ia || {};
  const embed = new EmbedBuilder()
    .setColor(COULEUR)
    .setTitle(`${it.label}  —  ${RUBRIQUES[sec].label}`)
    .setDescription([note ? `**${note}**\n` : null, it.desc].filter(Boolean).join('\n'));

  const rows = [];
  const selectCanal = (id, place) => rang(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(place)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

  if (sec === 'accueil' && cle === 'salon') {
    embed.addFields({ name: 'Actuellement', value: b.salon ? `<#${b.salon}>` : '_aucun salon — accueil coupé_' });
    rows.push(selectCanal('cfg:accueil:salon', '📋 Dans quel salon souhaiter la bienvenue ?'));
  } else if (sec === 'accueil' && cle === 'role') {
    embed.addFields({ name: 'Actuellement', value: b.role ? `<@&${b.role}>` : '_aucun rôle automatique_' });
    rows.push(
      rang(new RoleSelectMenuBuilder().setCustomId('cfg:accueil:role')
        .setPlaceholder('🎭 Choisis le rôle à donner automatiquement aux nouveaux')),
      rang(bouton('cfg:accueil:role-off', 'Retirer le rôle', '🧹')),
    );
  } else if (sec === 'accueil' && cle === 'langue') {
    embed.addFields({ name: 'Actuellement', value: b.langue === 'en' ? 'WELCOME (anglais)' : 'BIENVENUE (français)' });
    rows.push(rang(new StringSelectMenuBuilder().setCustomId('cfg:accueil:langue').setPlaceholder('🌍 Choisis la langue de la carte')
      .addOptions(
        { label: 'BIENVENUE (français)', value: 'fr', default: b.langue !== 'en' },
        { label: 'WELCOME (anglais)', value: 'en', default: b.langue === 'en' },
      )));
  } else if (sec === 'accueil' && cle === 'fond') {
    embed.addFields({ name: 'Actuellement', value: b.fond ? `🖼️ image perso : <${b.fond}>` : '🌸 fond par défaut du serveur (cosmos)' });
    rows.push(rang(...boutonFondPersonnalisee()));
  } else if (sec === 'accueil' && cle === 'message') {
    embed.addFields({ name: 'Actuellement', value: b.message ? `\`${String(b.message).slice(0, 90)}\`` : '_le message standard_\n> ' + MESSAGE_DEFAUT.slice(0, 90) });
    rows.push(rang(bouton('cfg:accueil:msg', 'Écrire le message', '✏️', ButtonStyle.Primary),
      bouton('cfg:accueil:msg-off', 'Revenir au standard', '🧹')));
  } else if (sec === 'accueil' && cle === 'couper') {
    embed.addFields({ name: 'Actuellement', value: b.salon ? `✅ accueil actif → <#${b.salon}>` : '🔕 accueil déjà coupé' });
    rows.push(rang(bouton('cfg:accueil:off', b.salon ? 'Couper l\'accueil maintenant' : 'L\'accueil est déjà coupé', '🔕', b.salon ? ButtonStyle.Danger : ButtonStyle.Secondary)));
  } else if (sec === 'salons') {
    const actuel = cle === 'logs' ? r.logs : (r.guide || {})[cle];
    embed.addFields({ name: 'Actuellement', value: actuel ? `<#${actuel}>` : '_non défini_' });
    const libelles = { logs: '🗂️ Salon des journaux du staff', regles: '📜 Salon des règles', support: '🛟 Salon pour contacter le staff' };
    rows.push(selectCanal(`cfg:salons:${cle}`, libelles[cle]));
    rows.push(rang(bouton(`cfg:salons:${cle}-off`, 'Retirer ce salon', '🧹')));
  } else if (sec === 'automod' && cle === 'modules') {
    rows.push(rang(new StringSelectMenuBuilder()
      .setCustomId('cfg:modules')
      .setPlaceholder('🧰 Coche ce qui doit rester ACTIF (décoche = coupé)')
      .setMinValues(0)
      .setMaxValues(Object.keys(MODULES).length)
      .addOptions(Object.entries(MODULES).map(([cle2, m]) => ({
        label: m.nom, value: cle2, description: m.aide.slice(0, 95), default: Boolean(a[cle2]),
      })))));
  } else if (sec === 'automod' && cle === 'exempt') {
    embed.addFields({ name: 'Actuellement', value: a.salonExempt ? `<#${a.salonExempt}>` : '_aucun salon exempté_' });
    rows.push(selectCanal('cfg:exempt', '🤫 Un salon où l\'auto-mod ne filtre jamais ?'));
    rows.push(rang(bouton('cfg:exempt-off', 'Retirer l\'exemption', '🧹')));
  } else if (sec === 'sanctions' && cle === 'formule') {
    embed.addFields({
      name: 'Actuellement',
      value: a.sanctionAuto ? `**${a.seuilAvert || 3}** avertissement(s) → sourdine **${a.dureeSanction || 60} min**` : '_désactivée_',
    });
    rows.push(rang(new StringSelectMenuBuilder()
      .setCustomId('cfg:sanction')
      .setPlaceholder('⚖️ Choisis une formule')
      .addOptions(
        { label: 'Désactiver la sanction automatique', value: 'off', emoji: '⚪', default: !a.sanctionAuto },
        { label: '3 avertissements → mute 1 h', value: '3:60', emoji: '🔇', default: a.sanctionAuto && a.seuilAvert === 3 && a.dureeSanction === 60 },
        { label: '3 avertissements → mute 24 h', value: '3:1440', emoji: '🔇', default: a.sanctionAuto && a.seuilAvert === 3 && a.dureeSanction === 1440 },
        { label: '5 avertissements → mute 1 h', value: '5:60', emoji: '🔇', default: a.sanctionAuto && a.seuilAvert === 5 && a.dureeSanction === 60 },
        { label: 'Mute de 10 min dès le 1er avertissement', value: '1:10', emoji: '⏱️', default: a.sanctionAuto && a.seuilAvert === 1 && a.dureeSanction === 10 },
      )));
  } else if (sec === 'ia' && cle === 'ici') {
    const coupee = Boolean(channelId && (iaR.salonBloques || []).includes(channelId));
    embed.addFields({ name: 'Dans ce salon', value: iaR.active === false ? '_IA coupée partout (valeur par défaut)_' : (coupee ? '🔇 coupée' : '🟢 active') });
    rows.push(rang(bouton('cfg:ia-ici', coupee ? 'Réactiver l\'IA ici' : 'Couper l\'IA ici', coupee ? '🟢' : '🔇', coupee ? ButtonStyle.Success : ButtonStyle.Danger)));
  } else if (sec === 'ia' && cle === 'personnalite') {
    embed.addFields({ name: 'Actuellement', value: iaR.consigne ? `> ${String(iaR.consigne).slice(0, 120)}` : '_standard_' });
    rows.push(rang(bouton('cfg:perso', 'Écrire la personnalité', '🎭', ButtonStyle.Primary)));
  } else if (sec === 'ia' && cle === 'memo') {
    rows.push(rang(bouton('cfg:memo', 'Oublier la conversation de CE salon', '🧠', ButtonStyle.Danger)));
  }

  rows.push(boutonRetour());
  return { embeds: [embed], components: rows };
}

// ─── l'écran à afficher selon l'endroit où on est (rubrique ou réglage) ───
function ecranCourant(G, channelId, note, forcerRubrique = false, opts = {}) {
  const r = stockage.reglages(G);
  const sec = r.cfgSection;
  if (!sec) return ecranRacine(note);
  if (!forcerRubrique && r.cfgItem && RUBRIQUES[sec].items[r.cfgItem]) {
    return carteReglage(G, sec, r.cfgItem, channelId, note, opts);
  }
  return carteRubrique(G, sec, channelId, note);
}

/** Faut-il le lien du sélecteur d'image pour l'écran affiché ? (uniquement la carte « fond ») */
function carteFondAffichee(G, forcerRubrique) {
  const r = stockage.reglages(G);
  return !forcerRubrique && r.cfgSection === 'accueil' && r.cfgItem === 'fond';
}

// Compat : le test d'aperçu et /tmp/parcours utilisent ce nom.
function panneauPrincipal(guildId, channelId = null, section = null, note = null) {
  if (section) return carteRubrique(guildId, section, channelId, note);
  const courant = stockage.reglages(guildId).cfgSection;
  return courant ? carteRubrique(guildId, courant, channelId, note) : ecranRacine(note);
}

// ─── la commande ───
module.exports = {
  categorie: 'configuration',

  data: new SlashCommandBuilder()
    .setName('config')
    .setDescription('Le panneau de configuration : une carte par réglage, zéro saisie')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);
    // Règle posée par l'admin : /config ouvre TOUJOURS le sélecteur de rubriques seul.
    return interaction.reply({ ...ecranRacine(), flags: MessageFlags.Ephemeral }).catch(() => null);
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
    const montrer = (note, forcerRubrique = false) => rafraichir(interaction, note, forcerRubrique);
    // appliquer un réglage = enregistrer + rester sur la carte (avec le ✓), sauf navigation
    const maj = (morceau, note) => { stockage.majReglages(G, morceau); return montrer(note); };

    // ── navigation ──
    if (id === 'cfg:section' && interaction.isStringSelectMenu()) {
      stockage.majReglages(G, { cfgSection: interaction.values[0], cfgItem: null });
      await rafraichir(interaction, null, true);   // on entre dans la rubrique : jamais la carte d'un réglage
      return true;
    }
    if (id === 'cfg:item' && interaction.isStringSelectMenu()) {
      const [sec, cle] = String(interaction.values[0]).split(':');
      stockage.majReglages(G, { cfgSection: sec, cfgItem: RUBRIQUES[sec]?.items?.[cle] ? cle : null });
      await rafraichir(interaction, null, false);
      return true;
    }
    if (id === 'cfg:retour') {
      stockage.majReglages(G, { cfgItem: null });
      await rafraichir(interaction, null, true);
      return true;
    }
    if (id === 'cfg:racine') {
      stockage.majReglages(G, { cfgSection: null, cfgItem: null });
      await rafraichir(interaction, null, true);
      return true;
    }

    // ── accueil ─
    if (id === 'cfg:accueil:salon' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ bienvenue: { salon: salon ? salon.id : null } },
        salon ? `✅ Bienvenue envoyée dans <#${salon.id}>.` : '✅ Bienvenue mise à jour.');
    }
    if (id === 'cfg:accueil:role') {
      const role = interaction.roles?.first?.() || null;
      return maj({ bienvenue: { role: role ? role.id : null } },
        role ? `✅ Les nouveaux membres recevront **${role.name}** automatiquement.` : '✅ Rôle mis à jour.');
    }
    if (id === 'cfg:accueil:role-off') {
      return maj({ bienvenue: { role: null } }, '🧹 Rôle automatique retiré.');
    }
    if (id === 'cfg:accueil:langue' && interaction.isStringSelectMenu()) {
      const langue = interaction.values[0] === 'en' ? 'en' : 'fr';
      return maj({ bienvenue: { langue } },
        langue === 'en' ? '🌍 La carte affichera « WELCOME ».' : '🌍 La carte affichera « BIENVENUE ».');
    }
    if (id === 'cfg:accueil:fond-off') {
      return maj({ bienvenue: { fond: null, fondTheme: null } }, '🌸 Retour au fond par défaut du serveur.');
    }
    if (id === 'cfg:accueil:fond-url') {
      return ouvrirFondModal(interaction);
    }
    if (id === 'cfg:accueil:fond-pj') {
      // Discord refuse les champs « fichier » dans ses formulaires (testé en live,
      // logs Render du 06/11/2026) : on passe donc par une réponse dans le salon —
      // le 📎 natif ouvre la galerie du téléphone (ou les fichiers sur PC), le bot
      // range l'image puis efface les deux messages. Zéro MP, zéro trace, zéro URL.
      const choixFond = require('../utils/choix-fond');
      // double clic ? on renvoie vers l'invitation déjà en cours, sans en poster une 2e
      const enCours = choixFond.chercherEnAttente(interaction.user.id);
      if (enCours && enCours.guildId === interaction.guildId) {
        return montrer('⬆️ Ton invitation t’attend déjà dans le salon — réponds-lui avec ton image.');
      }
      let invitation = null;
      try {
        invitation = await interaction.channel.send({
          content: `📎 ${interaction.user}, réponds à ce message avec ton image de fond : `
            + 'touche le trombone 📎 → galerie sur téléphone, fichiers sur PC. '
            + 'Dès reçue, je vérifie, je te montre l’aperçu, et j’efface ces deux messages.',
          allowedMentions: { users: [interaction.user.id] },
        });
      } catch {
        return montrer('⚠️ Je ne peux pas écrire dans ce salon — utilise « 🔗 Adresse d’image » juste en dessous.');
      }
      choixFond.demander(interaction, invitation);
      // si l'admin ne répond pas dans les 10 minutes, on nettoie l'invitation
      const utilisateur = interaction.user.id;
      const retard = setTimeout(() => {
        if (choixFond.chercherEnAttente(utilisateur)) {
          choixFond.__enAttente.delete(utilisateur);
          invitation.delete().catch(() => null);
        }
      }, 10 * 60 * 1000);
      if (retard.unref) retard.unref();   // ne retient jamais le processus (arrêts, tests)
      return montrer('⬆️ Regarde juste au-dessus : **réponds au message du bot avec ton image**. '
        + 'Il te montrera l’aperçu réel de la carte, enregistrera le fond, et effacera les messages.');
    }
    if (id === 'cfg:accueil:fond-modal') {
      const brut = String(interaction.fields?.getTextInputValue('url') || '').trim();
      const verdict = bienvenueImage.validerUrlFond(brut);
      if (!verdict.ok) {
        return maj({ bienvenue: { fond: null } },
          '⚠️ Cette adresse n\'est pas une image en http(s) — fond par thème rétabli.');
      }
      return maj({ bienvenue: { fond: verdict.valeur } },
        verdict.valeur ? '🖼️ Fond enregistré : les cartes utiliseront cette image.' : '🖼️ Fond retiré — le thème du bot reprend la main.');
    }
    if (id === 'cfg:accueil:off') {
      // « couper » se fait depuis la carte du réglage : on revient à la rubrique après.
      stockage.majReglages(G, { bienvenue: { salon: null }, cfgItem: null });
      return montrer('🔕 Accueil coupé — plus de message de bienvenue.', true);
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
    if (id === 'cfg:accueil:msg-off') {
      return maj({ bienvenue: { message: null } }, '🧹 Message standard rétabli.');
    }

    // ── salons & repères ──
    if (id === 'cfg:salons:logs' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ logs: salon ? salon.id : null }, salon ? `✅ Journal du staff : <#${salon.id}>.` : '✅ Journal mis à jour.');
    }
    if (id === 'cfg:salons:regles' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ guide: { regles: salon ? salon.id : null } },
        salon ? `✅ Règles : les membres seront orientés vers <#${salon.id}>.` : '✅ Règles mises à jour.');
    }
    if (id === 'cfg:salons:support' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ guide: { support: salon ? salon.id : null } },
        salon ? `✅ Contacter le staff : les membres seront orientés vers <#${salon.id}>.` : '✅ Staff mis à jour.');
    }
    if (id === 'cfg:salons:logs-off') return maj({ logs: null }, '🧹 Journal retiré.');
    if (id === 'cfg:salons:regles-off') return maj({ guide: { regles: null } }, '🧹 Salon des règles retiré.');
    if (id === 'cfg:salons:support-off') return maj({ guide: { support: null } }, '🧹 Salon de support retiré.');

    // ── auto-mod ──
    if (id === 'cfg:modules' && interaction.isStringSelectMenu()) {
      const choisis = interaction.values;
      const seuil = stockage.reglages(G).automod.seuilAvert || 3;
      const automod = { seuilAvert: seuil };
      for (const cle of Object.keys(MODULES)) automod[cle] = choisis.includes(cle);
      return maj({ automod }, choisis.length
        ? `✅ Actifs : ${choisis.map((c) => MODULES[c]?.nom).filter(Boolean).join(', ')}.`
        : '⚪ Tous les modules sont désactivés.');
    }
    if (id === 'cfg:exempt' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ automod: { salonExempt: salon ? salon.id : null } },
        salon ? `✅ <#${salon.id}> ne sera jamais filtré.` : '✅ Exemption mise à jour.');
    }
    if (id === 'cfg:exempt-off') return maj({ automod: { salonExempt: null } }, '🔕 Plus aucun salon exempté.');

    // ── sanctions ──
    if (id === 'cfg:sanction' && interaction.isStringSelectMenu()) {
      const valeur = interaction.values[0];
      if (valeur === 'off') return maj({ automod: { sanctionAuto: false } }, '⚪ Sanction automatique désactivée.');
      const [seuil, duree] = valeur.split(':').map(Number);
      return maj({ automod: { sanctionAuto: true, seuilAvert: seuil, dureeSanction: duree } },
        `⚖️ Activé : **${seuil} avertissement(s) → sourdine ${duree} min**.`);
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
      return montrer('🧠 Mémoire du salon oubliée.');
    }

    await montrer(null);
    return true;
  },

  MODULES,
  SECTIONS,
  RUBRIQUES,
  panneauPrincipal,
  ecranCourant,
  carteRubrique,
  carteReglage,
  etatAccueil,
};

/** Ouvre le formulaire « image de fond perso ». */
async function ouvrirFondModal(interaction) {
  const actuelle = (stockage.reglages(interaction.guildId).bienvenue || {}).fond || '';
  const modal = new ModalBuilder().setCustomId('cfg:accueil:fond-modal').setTitle('🖼️ Image de fond de la carte');
  const champ = new TextInputBuilder()
    .setCustomId('url')
    .setLabel('Adresse de l\'image (https://…)')
    .setPlaceholder('Colle une URL d\'image · vide = thème du bot')
    .setStyle(TextInputStyle.Short).setMaxLength(500).setRequired(false)
    .setValue(actuelle.slice(0, 500));
  modal.addComponents(new ActionRowBuilder().addComponents(champ));
  await interaction.showModal(modal).catch(() => null);
  return true;
}

/** Rafraîchit l'écran courant (ou l'envoie si le message d'origine n'est plus éditable). */
async function rafraichir(interaction, note, forcerRubrique = false) {
  const paquet = ecranCourant(interaction.guildId, interaction.channelId, note, forcerRubrique);
  try {
    await interaction.update(paquet);
  } catch {
    await interaction.reply({ ...paquet, flags: MessageFlags.Ephemeral }).catch(() => null);
  }
}
