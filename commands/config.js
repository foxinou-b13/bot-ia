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
const MESSAGE_DEFAUT = 'Bienvenue {membre} sur **{serveur}** !';

// ─── les modules de l'auto-mod ───
const MODULES = {
  spam: { nom: 'Spam', emoji: '🐢', aide: 'Trop de messages d\'un coup' },
  liens: { nom: 'Liens et invitations', emoji: '🔗', aide: 'Invitations, arnaques nitro/steam, rafales de liens' },
  insultes: { nom: 'Insultes', emoji: '🤬', aide: 'Gros mots, même déguisés, au pluriel ou au féminin' },
  majuscules: { nom: 'Majuscules', emoji: '🔠', aide: 'Messages écrits en gueulant' },
  raid: { nom: 'Raid', emoji: '🚨', aide: 'Arrivées massives soudaines' },
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
    intro: 'Quand un membre arrive, Otaku envoie la **carte-image de bienvenue** (sa photo + BIENVENUE) et le mentionne.',
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
        desc: 'Le décor derrière la photo du nouveau.\n'
        + '• **Par défaut** : le fond préparé pour ton serveur (prairie de cosmos) — rien à faire.\n'
        + '• **📱 Choisir une image** : une fenêtre s\u2019ouvre, ton image part directement au bot — rien n\u2019est posté dans le salon — et tu reçois l\u2019aperçu réel de la carte en privé.\n'
        + '• **🔗 Adresse d\u2019image** : coller un lien http(s).\n'
        + '• **🌸 Fond par défaut** : pour y revenir à tout moment.',
      },
      message: {
        label: '✏️ Message d\'accroche',
        desc: 'Un petit texte écrit par-dessus la carte, si tu veux ajouter quelque chose (facultatif).\nLes mots-clés sont remplacés tout seuls : `{membre}` = la mention du nouveau, `{serveur}` = le nom du serveur.',
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
        desc: 'Salon PRIVÉ où Otaku note tout ce qui compte : sanctions, alertes d\'auto-modération, messages supprimés ou modifiés, départs de membres. Choisis un salon que seuls tes modérateurs voient.',
      },
      regles: {
        label: '📜 Salon des règles',
        desc: 'Quand un membre demande les règles (commande /guide), Otaku l\'oriente vers ce salon.',
      },
      support: {
        label: '🛟 Contacter le staff',
        desc: 'Quand un membre demande de l\'aide (commande /aide), Otaku l\'oriente vers ce salon où le staff le verra.',
      },
      journal: {
        label: '📓 Contenu du journal',
        desc: 'En plus des sanctions et des alertes d\'auto-modération (toujours notées), Otaku peut garder une trace des messages supprimés, des modifications et des départs. Coche ce qui t\'intéresse.',
      },
    },
  },
  automod: {
    label: '🛡️ Auto-modération',
    aide: 'Spam, liens, insultes, majuscules, raid',
    intro: 'Otaku filtre tout seul les comportements problématiques. Chaque message retiré ajoute un avertissement, notifie la personne en MP (si elle les accepte) et applique la sourdine au seuil réglé dans ⚖️ Sanctions.',
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
        desc: 'Combien d\'avertissements avant la sourdine, et pour combien de temps. Le seuil compte les /warn du staff ET les avertissements automatiques de l\'auto-modération (insulte ou lien retiré). « Désactiver » garde les retraits de messages, sans sourdine automatique.',
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
  assistant: {
    label: '🤝 Assistant dans les tickets',
    aide: 'Otaku accueille dans les tickets, questionne, résume pour le staff',
    intro: 'Quand un membre ouvre un ticket (créé par n\'importe quel bot de tickets), Otaku l\'accueil à la place du staff arrivant : il pose les questions utiles, demande si c\'est tout, puis publie un **récapitulatif propre** pour le staff. Un clic « 🙌 Je prends en charge » et il se retire pour de bon.',
    items: {
      couper: {
        label: '🎛️ Activer ou couper',
        desc: 'L\'interrupteur général. Coupé, Otaku ne dit plus rien dans les tickets, même si tout le reste est réglé.',
      },
      categorie: {
        label: '📁 Catégorie des tickets',
        desc: 'La catégorie SOUS LAQUELLE les salons de ticket sont créés. C\'est comme ça qu\'Otaku les reconnaît — choisis-la dans le menu (les salons de sa catégorie déclenchent l\'assistant).',
      },
      panneau: {
        label: '🧾 Salon du panneau de tickets',
        desc: 'Facultatif : le salon où se trouve le panneau « ouvrir un ticket ». Otaku le cite en pied de récapitulatif pour que le staff retrouve l\'origine.',
      },
      staff: {
        label: '🧑‍💼 Rôle du staff',
        desc: 'Un seul rôle. Dès qu\'un membre portant ce rôle écrit dans le ticket, Otaku s\'arrête net et livre son récapitulatif : « le staff est là, je file ». (Les détenteurs de « Gérer les messages » comptent aussi comme staff.)',
      },
      alerte: {
        label: '📣 Salon d\'alerte',
        desc: 'Si le membre demande un humain (ou ne répond plus du tout), Otaku prévient ici. Idéalement un salon privé du staff. Sans réglage, il se contente du récapitulatif dans le ticket.',
      },
      questions: {
        label: '❓ Les questions à poser',
        desc: 'Une par ligne (6 maximum) : exactement ce que ton staff demande d\'habitude. Vide = Otaku improvise les questions avec l\'IA (et redemande « c\'est tout ? » à la fin).',
      },
    },
  },
  tickets: {
    label: '🎫 Tickets (système maison)',
    aide: 'Panneau bouton ou menu, catégorie, logs, types de tickets',
    intro: 'Le système de tickets d\'Otaku, réglé ici étape par étape : d\'abord **le format du panneau** (boutons ou menu déroulant comme les grands bots de tickets), puis où vivent les tickets, qui s\'en occupe, et où partent les transcriptions. Toujours **sans image générée** : une carte propre et le choix du type de demande.',
    items: {
      couper: {
        label: '🎛️ Activer ou couper',
        desc: 'L\'interrupteur général du système de tickets. Coupé : le panneau affiche une réponse polie et plus rien ne se crée.',
      },
      format: {
        label: '🕹️ Format du panneau',
        desc: 'Comment les membres choisissent leur type de demande : **Boutons** — un bouton par type, sous la carte ; **Menu** — un menu déroulant « Choisis le type ». Sans types réglés, les deux formats affichent juste un gros bouton « Ouvrir un ticket ».',
      },
      categorie: {
        label: '📁 Catégorie des tickets',
        desc: 'Sous cette catégorie que les salons privés « ticket-… » sont créés. C\'est aussi elle qui déclenche l\'assistant d\'accueil (rubrique 🤝) quand un membre y écrit.',
      },
      panneau: {
        label: '🧾 Salon du panneau',
        desc: 'Le salon où vit la carte « Ouvrir un ticket ». C\'est ici que le bouton / le menu doit être cliquable par tout le monde.',
      },
      logs: {
        label: '📜 Salon des transcriptions',
        desc: 'À la fermeture d\'un ticket, la conversation résumée part ici, avec le bouton « 🔁 Rouvrir ». Idéalement un salon privé du staff.',
      },
      staff: {
        label: '🧑‍💼 Rôle du staff',
        desc: 'Qui a le droit de prendre en charge, ajouter des gens, rouvrir des tickets. Les détenteurs de « Gérer les messages » comptent toujours aussi.',
      },
      types: {
        label: '🏷️ Les types de tickets',
        desc: 'Un par ligne (6 max), optionnellement précédé d\'un emoji : « 😀 Support », « 🤝 Partenariat »… Ce sont les boutons du mode Boutons et les choix du mode Menu. Vide = un seul bouton « Ouvrir un ticket ».',
      },
      textes: {
        label: '✏️ Titre et texte du panneau',
        desc: 'Ce que dit la carte au-dessus des boutons. Par défaut : « Besoin d\'aide ? Ouvre un ticket » + une phrase d\'accueil.',
      },
    },
  },
};

const SECTIONS = Object.entries(RUBRIQUES).map(([valeur, r]) => ({ valeur, label: r.label, aide: r.aide }));

const rang = (...composants) => new ActionRowBuilder().addComponents(...composants);
const bouton = (id, libelle, emoji, style = ButtonStyle.Secondary) =>
  new ButtonBuilder().setCustomId(id).setLabel(libelle).setEmoji(emoji).setStyle(style);

const boutonRetour = () => rang(bouton('cfg:retour', '← Retour à la rubrique', '↩️'));

// ─── propreté commune : un seul style pour toutes les cartes ───
const VIDE = '— non défini —';
/** Titre propre : on retire l'emoji du libellé (le titre garde ⚙️ tout seul). */
function titreNet(libelle) { return String(libelle).replace(/^[^\p{L}\p{N}]+/u, '').trim(); }
/** Le champ d'état unique de toutes les cartes de réglage. */
function valeurActuelle(embed, valeur) {
  embed.addFields({ name: '📌 Valeur actuelle', value: String(valeur || VIDE) });
  return embed;
}

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
    ].filter((l) => l !== null && l !== undefined && l !== '').join('\n'))
    .setFooter({ text: 'Otaku · configuration du serveur' });
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
    salon: b.salon ? `<#${b.salon}>` : VIDE,
    role: b.role ? `<@&${b.role}>` : VIDE,
    langue: b.langue === 'en' ? 'WELCOME (anglais)' : 'BIENVENUE (français)',
    fond: b.fond ? `🖼️ image perso : <${b.fond}>` : '🌸 fond par défaut (cosmos)',
    message: b.message ? `\`${String(b.message).slice(0, 90)}\`` : VIDE,
  };
}

const NOMS_JOURNAL = { suppressions: 'messages supprimés', modifications: 'messages modifiés', sorties: 'départs de membres' };

const DESCRIPTIONS_JOURNAL = {
  suppressions: 'auteur, salon et extrait du message effacé',
  modifications: 'avant / après de chaque modification',
  sorties: 'qui part, depuis quand, compte jeune signalé',
};

function journalActif(r) {
  const j = r.journal || {};
  const actifs = Object.keys(NOMS_JOURNAL).filter((cle) => j[cle] !== false);
  return actifs.length === 3 ? '✅ tout (suppressions · modifications · départs)'
    : (actifs.length ? `📝 ${actifs.map((c) => NOMS_JOURNAL[c]).join(' · ')}` : '🔇 rien de plus que les sanctions');
}

function carteRubrique(G, sec, channelId, note) {
  const r = stockage.reglages(G);
  const rub = RUBRIQUES[sec];
  const embed = new EmbedBuilder().setColor(COULEUR).setTitle(rub.label).setDescription(
    [note ? `**${note}**\n` : null, rub.intro, '\n👇 Choisis le réglage que tu veux changer — il aura sa propre carte.']
      .filter(Boolean).join('\n'),
  ).setFooter({ text: 'Otaku · configuration du serveur' });
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
      { name: '🗂️ Journal du staff', value: r.logs ? `<#${r.logs}>` : VIDE, inline: true },
      { name: '📜 Salon des règles', value: r.guide.regles ? `<#${r.guide.regles}>` : VIDE, inline: true },
      { name: '🛟 Contacter le staff', value: r.guide.support ? `<#${r.guide.support}>` : VIDE, inline: true },
      { name: '📓 Traces notées', value: journalActif(r) },
    );
  } else if (sec === 'automod') {
    const actifs = Object.entries(MODULES).filter(([cle]) => a[cle]).map(([, m]) => m.nom);
    embed.addFields(
      { name: '🧰 Modules actifs', value: actifs.length ? `✅ ${actifs.join(' · ')}` : '🔇 tous coupés' },
      { name: '🤫 Salon exempté', value: a.salonExempt ? `<#${a.salonExempt}>` : '🔓 aucun salon exempté', inline: true },
    );
  } else if (sec === 'sanctions') {
    embed.addFields({
      name: '⚖️ Formule actuelle',
      value: a.sanctionAuto ? `**${a.seuilAvert || 3}** avertissement(s) → sourdine **${a.dureeSanction || 60} min**` : '_désactivée — les avertissements s\'empilent sans effet_',
    });
  } else if (sec === 'assistant') {
    const as = r.assistant || {};
    const nb = (as.questions || []).filter(Boolean).length;
    embed.addFields(
      { name: '🎛️ Interrupteur', value: as.actif ? '✅ actif' : '⬜ coupé', inline: true },
      { name: '📁 Catégorie', value: as.categorie ? `<#${as.categorie}>` : VIDE, inline: true },
      { name: '❓ Questions', value: nb ? `${nb} sur 6 réglées` : 'improvisées par l\u2019IA', inline: true },
      { name: '📣 Alerte', value: as.alerte ? `<#${as.alerte}>` : 'récap dans le ticket seulement', inline: true },
    );
  } else if (sec === 'tickets') {
    const t = r.tickets || {};
    const nt = (t.types || []).filter(Boolean).length;
    embed.addFields(
      { name: '🎛️ Interrupteur', value: t.actif ? '✅ actif' : '⬜ coupé', inline: true },
      { name: '🕹️ Format du panneau', value: t.mode === 'menu' ? '📋 menu déroulant' : '🎛️ boutons', inline: true },
      { name: '🏷️ Types', value: nt ? `${nt} sur 6` : 'aucun — bouton unique', inline: true },
      { name: '📁 Catégorie', value: t.categorie ? `<#${t.categorie}>` : VIDE, inline: true },
      { name: '🧾 Panneau', value: t.panneau ? `<#${t.panneau}>` : VIDE, inline: true },
      { name: '📜 Transcriptions', value: t.logs ? `<#${t.logs}>` : VIDE, inline: true },
    );
  } else if (sec === 'ia') {
    const iaR = r.ia || {};
    const coupeeIci = Boolean(channelId && (iaR.salonBloques || []).includes(channelId));
    embed.addFields(
      { name: '🤖 État pour ce salon', value: iaR.active === false ? '🔇 coupée partout' : (coupeeIci ? '🔇 coupée ici' : '🟢 active ici'), inline: true },
      { name: '🎭 Personnalité', value: iaR.consigne ? `> ${String(iaR.consigne).slice(0, 90)}` : 'standard', inline: true },
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
    .setTitle(`⚙️ ${titreNet(it.label)}`)
    .setDescription([note ? `**${note}**\n` : null, it.desc].filter(Boolean).join('\n'))
    .setFooter({ text: `Otaku · ${RUBRIQUES[sec].label}` });

  const rows = [];
  const selectCanal = (id, place) => rang(new ChannelSelectMenuBuilder().setCustomId(id).setPlaceholder(place)
    .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement));

  if (sec === 'accueil' && cle === 'salon') {
    valeurActuelle(embed, b.salon ? `<#${b.salon}>` : '🔕 aucun — accueil coupé');
    rows.push(selectCanal('cfg:accueil:salon', '📋 Dans quel salon souhaiter la bienvenue ?'));
  } else if (sec === 'accueil' && cle === 'role') {
    valeurActuelle(embed, b.role ? `<@&${b.role}>` : '🧹 aucun rôle automatique');
    rows.push(
      rang(new RoleSelectMenuBuilder().setCustomId('cfg:accueil:role')
        .setPlaceholder('🎭 Choisis le rôle à donner automatiquement aux nouveaux')),
      rang(bouton('cfg:accueil:role-off', 'Retirer le rôle', '🧹')),
    );
  } else if (sec === 'accueil' && cle === 'langue') {
    valeurActuelle(embed, b.langue === 'en' ? 'WELCOME (anglais)' : 'BIENVENUE (français)');
    rows.push(rang(new StringSelectMenuBuilder().setCustomId('cfg:accueil:langue').setPlaceholder('🌍 Choisis la langue de la carte')
      .addOptions(
        { label: 'BIENVENUE (français)', value: 'fr', default: b.langue !== 'en' },
        { label: 'WELCOME (anglais)', value: 'en', default: b.langue === 'en' },
      )));
  } else if (sec === 'accueil' && cle === 'fond') {
    valeurActuelle(embed, b.fond ? `🖼️ image perso : <${b.fond}>` : '🌸 fond par défaut (prairie de cosmos)');
    rows.push(rang(...boutonFondPersonnalisee()));
  } else if (sec === 'accueil' && cle === 'message') {
    valeurActuelle(embed, b.message ? `\`${String(b.message).slice(0, 90)}\`` : '*Standard :*\n> `' + MESSAGE_DEFAUT + '`');
    rows.push(rang(bouton('cfg:accueil:msg', 'Écrire le message', '✏️', ButtonStyle.Primary),
      bouton('cfg:accueil:msg-off', 'Revenir au standard', '🧹')));
  } else if (sec === 'accueil' && cle === 'couper') {
    valeurActuelle(embed, b.salon ? `✅ accueil actif — la carte part dans <#${b.salon}>` : '🔕 accueil coupé');
    rows.push(rang(bouton('cfg:accueil:off', b.salon ? 'Couper l\'accueil maintenant' : 'L\'accueil est déjà coupé', '🔕', b.salon ? ButtonStyle.Danger : ButtonStyle.Secondary)));
  } else if (sec === 'salons' && cle === 'journal') {
    const jj = r.journal || {};
    valeurActuelle(embed, journalActif(r));
    rows.push(rang(new StringSelectMenuBuilder()
      .setCustomId('cfg:journal')
      .setPlaceholder('📓 Que doit noter le journal ? (les sanctions restent toujours notées)')
      .setMinValues(0)
      .setMaxValues(3)
      .addOptions(Object.entries(NOMS_JOURNAL).map(([cleJ, nom]) => ({
        label: nom, value: cleJ, description: DESCRIPTIONS_JOURNAL[cleJ], default: jj[cleJ] !== false,
      })))));
  } else if (sec === 'salons') {
    const actuel = cle === 'logs' ? r.logs : (r.guide || {})[cle];
    valeurActuelle(embed, actuel);
    const libelles = { logs: '🗂️ Salon des journaux du staff', regles: '📜 Salon des règles', support: '🛟 Salon pour contacter le staff' };
    rows.push(selectCanal(`cfg:salons:${cle}`, libelles[cle]));
    rows.push(rang(bouton(`cfg:salons:${cle}-off`, 'Retirer ce salon', '🧹')));
  } else if (sec === 'automod' && cle === 'modules') {
    const actifsM = Object.entries(MODULES).filter(([cleM]) => a[cleM]).map(([, m]) => m.nom);
    valeurActuelle(embed, actifsM.length ? `✅ ${actifsM.join(' · ')}` : '🔇 aucun module actif');
    rows.push(rang(new StringSelectMenuBuilder()
      .setCustomId('cfg:modules')
      .setPlaceholder('🧰 Coche ce qui doit rester ACTIF (décoche = coupé)')
      .setMinValues(0)
      .setMaxValues(Object.keys(MODULES).length)
      .addOptions(Object.entries(MODULES).map(([cle2, m]) => ({
        label: m.nom, value: cle2, description: m.aide.slice(0, 95), default: Boolean(a[cle2]),
      })))));
  } else if (sec === 'automod' && cle === 'exempt') {
    valeurActuelle(embed, a.salonExempt ? `<#${a.salonExempt}>` : '🔓 aucun — tous les salons sont filtrés');
    rows.push(selectCanal('cfg:exempt', '🤫 Un salon où l\'auto-mod ne filtre jamais ?'));
    rows.push(rang(bouton('cfg:exempt-off', 'Retirer l\'exemption', '🧹')));
  } else if (sec === 'sanctions' && cle === 'formule') {
    valeurActuelle(embed, a.sanctionAuto ? `**${a.seuilAvert || 3}** avertissements → sourdine **${a.dureeSanction || 60} min**` : '⚪ désactivée');
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
    valeurActuelle(embed, iaR.active === false ? '🔇 coupée partout' : (coupee ? '🔇 coupée dans ce salon' : '🟢 active dans ce salon'));
    rows.push(rang(bouton('cfg:ia-ici', coupee ? 'Réactiver l\'IA ici' : 'Couper l\'IA ici', coupee ? '🟢' : '🔇', coupee ? ButtonStyle.Success : ButtonStyle.Danger)));
  } else if (sec === 'ia' && cle === 'personnalite') {
    valeurActuelle(embed, iaR.consigne ? `> ${String(iaR.consigne).slice(0, 120)}` : 'Personnalité standard (polie et concise)');
    rows.push(rang(bouton('cfg:perso', 'Écrire la personnalité', '🎭', ButtonStyle.Primary)));
  } else if (sec === 'ia' && cle === 'memo') {
    rows.push(rang(bouton('cfg:memo', 'Oublier la conversation de CE salon', '🧠', ButtonStyle.Danger)));
  } else if (sec === 'assistant' && cle === 'couper') {
    const as = r.assistant || {};
    valeurActuelle(embed, as.actif ? '✅ actif — Otaku accueille dans les tickets' : '⬜ coupé');
    rows.push(rang(bouton('cfg:asst:toggle', as.actif ? 'Couper l\'assistant' : 'Activer l\'assistant', as.actif ? '🔕' : '🟢',
      as.actif ? ButtonStyle.Danger : ButtonStyle.Success)));
  } else if (sec === 'assistant' && cle === 'categorie') {
    const as = r.assistant || {};
    valeurActuelle(embed, as.categorie ? `<#${as.categorie}>` : '🔇 aucune — l\'assistant ne saura pas reconnaître les tickets');
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:asst:categorie')
      .setPlaceholder('📁 La catégorie où les salons de ticket sont créés')
      .addChannelTypes(ChannelType.GuildCategory)));
    rows.push(rang(bouton('cfg:asst:categorie-off', 'Retirer la catégorie', '🧹')));
  } else if (sec === 'assistant' && cle === 'panneau') {
    const as = r.assistant || {};
    valeurActuelle(embed, as.panneau ? `<#${as.panneau}>` : null);
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:asst:panneau')
      .setPlaceholder('🧾 Le salon du panneau de tickets (facultatif)')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
  } else if (sec === 'assistant' && cle === 'staff') {
    const as = r.assistant || {};
    valeurActuelle(embed, as.staffRole ? `<@&${as.staffRole}>` : '👥 juste « Gérer les messages » compte comme staff');
    rows.push(rang(new RoleSelectMenuBuilder().setCustomId('cfg:asst:staff')
      .setPlaceholder('🧑‍💼 Le rôle qui dit à Otaku de se retirer')));
    rows.push(rang(bouton('cfg:asst:staff-off', 'Retirer le rôle', '🧹')));
  } else if (sec === 'assistant' && cle === 'alerte') {
    const as = r.assistant || {};
    valeurActuelle(embed, as.alerte ? `<#${as.alerte}>` : null);
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:asst:alerte')
      .setPlaceholder('📣 Où prévenir quand le membre veut un humain')
      .addChannelTypes(ChannelType.GuildText)));
  } else if (sec === 'assistant' && cle === 'questions') {
    const as = r.assistant || {};
    const qs = (as.questions || []).filter(Boolean);
    valeurActuelle(embed, qs.length ? qs.map((q, i) => `**${i + 1}.** ${q}`.slice(0, 150)).join('\n').slice(0, 900) : null);
    rows.push(rang(bouton('cfg:asst:questions', 'Écrire les questions', '✏️', ButtonStyle.Primary),
      bouton('cfg:asst:questions-off', 'Laisser l\'IA improviser', '🪄')));
  } else if (sec === 'tickets' && cle === 'couper') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.actif ? '✅ actif — le panneau et les salons privés tournent' : '⬜ coupé');
    rows.push(rang(bouton('cfg:tik:toggle', t.actif ? 'Couper les tickets' : 'Activer les tickets', t.actif ? '🔕' : '🟢',
      t.actif ? ButtonStyle.Danger : ButtonStyle.Success)));
  } else if (sec === 'tickets' && cle === 'format') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.mode === 'menu' ? '📋 menu déroulant (« Choisis le type… »)' : '🎛️ boutons (un par type)');
    rows.push(rang(new StringSelectMenuBuilder().setCustomId('cfg:tik:mode').setPlaceholder('🕹️ Comment présenter le choix ?')
      .addOptions(
        { label: 'Boutons — un par type', value: 'bouton', description: 'Des boutons verts sous la carte, comme les grands bots de tickets' },
        { label: 'Menu déroulant', value: 'menu', description: 'Un seul menu « Choisis le type de ta demande »' },
      )));
  } else if (sec === 'tickets' && cle === 'categorie') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.categorie ? `<#${t.categorie}>` : '🔇 aucune — impossible de créer les tickets');
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:tik:categorie')
      .setPlaceholder('📁 La catégorie où naîtront les salons de ticket')
      .addChannelTypes(ChannelType.GuildCategory)));
  } else if (sec === 'tickets' && cle === 'panneau') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.panneau ? `<#${t.panneau}>` : null);
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:tik:panneau')
      .setPlaceholder('🧾 Le salon où vit la carte « Ouvrir un ticket »')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));
  } else if (sec === 'tickets' && cle === 'logs') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.logs ? `<#${t.logs}>` : null);
    rows.push(rang(new ChannelSelectMenuBuilder().setCustomId('cfg:tik:logs')
      .setPlaceholder('📜 Où envoyer les transcriptions à la fermeture')
      .addChannelTypes(ChannelType.GuildText)));
  } else if (sec === 'tickets' && cle === 'staff') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.staffRole ? `<@&${t.staffRole}>` : '👥 juste « Gérer les messages » compte comme staff');
    rows.push(rang(new RoleSelectMenuBuilder().setCustomId('cfg:tik:staff')
      .setPlaceholder('🧑‍💼 Le rôle qui gère les tickets')));
    rows.push(rang(bouton('cfg:tik:staff-off', 'Retirer le rôle', '🧹')));
  } else if (sec === 'tickets' && cle === 'types') {
    const t = r.tickets || {};
    const ts = (t.types || []).filter(Boolean);
    valeurActuelle(embed, ts.length ? ts.map((x, i) => `**${i + 1}.** ${x}`.slice(0, 150)).join('\n').slice(0, 900) : null);
    rows.push(rang(bouton('cfg:tik:types', 'Écrire les types de tickets', '✏️', ButtonStyle.Primary),
      bouton('cfg:tik:types-off', 'Un seul bouton', '🧹')));
  } else if (sec === 'tickets' && cle === 'textes') {
    const t = r.tickets || {};
    valeurActuelle(embed, t.titre || t.texte
      ? `${t.titre ? `**${t.titre}**\n` : ''}${t.texte ? `> ${String(t.texte).slice(0, 140)}` : ''}`
      : 'par défaut (« 📩 Besoin d\'aide ? Ouvre un ticket »)');
    rows.push(rang(bouton('cfg:tik:textes', 'Écrire titre et texte', '✏️', ButtonStyle.Primary),
      bouton('cfg:tik:textes-off', 'Revenir aux textes par défaut', '🧹')));
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
      const bOff = stockage.reglages(G).bienvenue || {};
      if (bOff.fondStock) require('../utils/choix-fond').supprimerCopie(interaction.guild, bOff.fondStock);
      return maj({ bienvenue: { fond: null, fondTheme: null, fondStock: null } }, '🌸 Retour au fond par défaut du serveur.');
    }
    if (id === 'cfg:accueil:fond-url') {
      return ouvrirFondModal(interaction);
    }
    if (id === 'cfg:accueil:fond-pj') {
      // Voie OFFICIELLE : la fenêtre native du client s'ouvre d'elle-même (modale
      // « Label + champ fichiers », structure exacte de la doc Discord, vérifiée
      // le 06/11/2026). Un tap dans la fenêtre → galerie du téléphone / dossiers
      // du PC ; l'image part direct au bot, RIEN n'est posté dans le salon.
      const choixFond = require('../utils/choix-fond');
      const enCours = choixFond.chercherEnAttente(interaction.user.id);
      // invitation de repli déjà en cours : un double clic ne doit pas en poster une deuxième
      if (enCours && enCours.guildId === interaction.guildId) {
        return montrer('⬆️ Ton invitation t\u2019attend déjà dans le salon — réponds-lui avec ton image.');
      }
      let invitation = null;
      try {
        await interaction.showModal(choixFond.modaleFond());
        // la fenêtre s'ouvre : si une invitation orpheline traînait d'une session précédente, on la range
        if (enCours && enCours.prompt) enCours.prompt.delete().catch(() => null);
        if (enCours) choixFond.__enAttente.delete(interaction.user.id);
        return true;
      } catch (erreur) {
        console.warn('⚠️ Fenêtre du sélecteur impossible (client trop ancien ?) — repli invitation :', erreur.message);
      }
      // Repli (appli très ancienne) : invitation dans le salon, réponse au 📎,
      // puis le bot range et efface les deux messages. Toujours zéro MP.
      try {
        invitation = await interaction.channel.send({
          content: `📎 ${interaction.user}, réponds à ce message avec ton image de fond : `
            + 'touche le trombone 📎 → galerie sur téléphone, fichiers sur PC. '
            + 'Dès reçue, je vérifie, je te montre l\u2019aperçu, et j\u2019efface ces deux messages.',
          allowedMentions: { users: [interaction.user.id] },
        });
      } catch {
        return montrer('⚠️ Je ne peux pas écrire dans ce salon — utilise « 🔗 Adresse d\u2019image » juste en dessous.');
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
      return montrer('📱 Ma fenêtre ne peut pas s\u2019ouvrir sur cette version de l\u2019appli (pense à la mettre à jour) : '
        + 'réponds au message du bot avec ton image (📎), je range et j\u2019efface tout.');
    }
    if (id === 'cfg:accueil:fond-pj-modal') {
      // la fenêtre est soumise : l'image arrive ICI, jamais dans le salon
      const choixFond = require('../utils/choix-fond');
      const bruts = typeof interaction.fields?.getUploadedFiles === 'function'
        ? interaction.fields.getUploadedFiles('fichier')
        : null;
      const piece = (bruts && typeof bruts.first === 'function' ? bruts.first()
        : (Array.isArray(bruts) ? bruts[0] : (bruts || null))) || null;
      const resultat = await choixFond.traiterPiece(interaction.guild, interaction.client, G, piece);
      if (!resultat.ok) {
        return interaction.reply({ content: choixFond.messageErreur(resultat.raison),
          flags: MessageFlags.Ephemeral }).catch(() => null);
      }
      const apercu = await choixFond.paquetApercu(resultat, interaction.user.username);
      return interaction.reply({ ...apercu, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
    if (id === 'cfg:accueil:fond-modal') {
      const brut = String(interaction.fields?.getTextInputValue('url') || '').trim();
      const verdict = bienvenueImage.validerUrlFond(brut);
      if (!verdict.ok) {
        return maj({ bienvenue: { fond: null } },
          '⚠️ Cette adresse n\'est pas une image en http(s) — fond par défaut rétabli.');
      }
      const bUrl = stockage.reglages(G).bienvenue || {};
      if (bUrl.fondStock) require('../utils/choix-fond').supprimerCopie(interaction.guild, bUrl.fondStock);
      return maj({ bienvenue: { fond: verdict.valeur, fondStock: null } },
        verdict.valeur ? '🖼️ Fond enregistré : les cartes utiliseront cette image.' : '🖼️ Fond retiré — le fond par défaut reprend la main.');
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
        .setPlaceholder('{membre} · {serveur} sont remplacés automatiquement')
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
    if (id === 'cfg:journal' && interaction.isStringSelectMenu()) {
      const v = interaction.values;
      return maj({ journal: {
        suppressions: v.includes('suppressions'),
        modifications: v.includes('modifications'),
        sorties: v.includes('sorties'),
      } }, v.length
        ? `📓 Journal : ${v.map((c) => NOMS_JOURNAL[c]).filter(Boolean).join(', ')} — enregistré.`
        : '📓 Journal : seules les sanctions et l\'auto-mod seront notés.');
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

    // ── assistant de tickets ──
    if (id === 'cfg:asst:toggle') {
      const as = stockage.reglages(G).assistant || {};
      return maj({ assistant: { actif: !as.actif } },
        as.actif ? '🔕 Assistant coupé — Otaku n\u2019interviendra plus dans les tickets.'
                 : '🟢 Assistant activé — il accueille désormais dans les salons de la catégorie réglée.');
    }
    if (id === 'cfg:asst:categorie' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ assistant: { categorie: salon ? salon.id : null } },
        salon ? `📁 Tickets reconnus : tout salon créé sous <#${salon.id}> (id).` : '✅ Catégorie mise à jour.');
    }
    if (id === 'cfg:asst:categorie-off') return maj({ assistant: { categorie: null } }, '🧹 Catégorie retirée — l\u2019assistant ne reconnaîtra plus les tickets.');
    if (id === 'cfg:asst:panneau' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ assistant: { panneau: salon ? salon.id : null } }, salon ? `🧾 Panneau noté : <#${salon.id}>.` : '✅ Retiré.');
    }
    if (id === 'cfg:asst:staff') {
      const role = interaction.roles?.first?.() || null;
      return maj({ assistant: { staffRole: role ? role.id : null } },
        role ? `🧑‍💼 Dès que « ${role.name} » écrit dans un ticket, Otaku livrera son récapitulatif et se retirera.` : '✅ Rôle mis à jour.');
    }
    if (id === 'cfg:asst:staff-off') return maj({ assistant: { staffRole: null } }, '🧹 Rôle staff retiré — seuls les « Gérer les messages » compteront.');
    if (id === 'cfg:asst:alerte' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ assistant: { alerte: salon ? salon.id : null } },
        salon ? `📣 Alertes envoyées dans <#${salon.id}>.` : '✅ Alerte retirée — le récap restera dans le ticket.');
    }
    if (id === 'cfg:asst:questions') {
      const actuelle = (stockage.reglages(G).assistant || {}).questions || [];
      const modal = new ModalBuilder().setCustomId('cfg:asst:questions-modal').setTitle('❓ Questions de l\u2019assistant');
      const champ = new TextInputBuilder()
        .setCustomId('questions')
        .setLabel('Une question par ligne (6 max)')
        .setPlaceholder('Quel est le problème exactement ?\nDepuis quand ça dure ?\nQu\u2019attends-tu du staff ?')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false)
        .setValue(actuelle.join('\n').slice(0, 1000));
      modal.addComponents(new ActionRowBuilder().addComponents(champ));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }
    if (id === 'cfg:asst:questions-modal') {
      const brut = String(interaction.fields?.getTextInputValue('questions') || '');
      const questions = brut.split('\n').map((q) => q.trim()).filter(Boolean).slice(0, 6);
      return maj({ assistant: { questions } }, questions.length
        ? `❓ ${questions.length} question(s) réglée(s) : c\u2019est celles-là que l\u2019assistant posera.`
        : '🪄 Plus de questions fixes : l\u2019IA improvise (et « c\u2019est tout ? » reste demandé à la fin).');
    }
    if (id === 'cfg:asst:questions-off') return maj({ assistant: { questions: [] } }, '🪄 Questions fixes effacées — l\u2019IA prend le relais.');

    // ── tickets maison ──
    if (id === 'cfg:tik:toggle') {
      const t = stockage.reglages(G).tickets || {};
      return maj({ tickets: { actif: !t.actif } },
        t.actif ? '🔕 Tickets coupés — le panneau répondra poliment que ce n\u2019est pas ouvert.'
                : '🟢 Tickets activés — le panneau (boutons ou menu) fait son travail.');
    }
    if (id === 'cfg:tik:mode' && interaction.isStringSelectMenu()) {
      const mode = interaction.values[0] === 'menu' ? 'menu' : 'bouton';
      const t = stockage.reglages(G).tickets || {};
      const nt = (t.types || []).filter(Boolean).length;
      return maj({ tickets: { mode } }, mode === 'menu'
        ? `📋 Mode menu : ${nt ? `${nt} choix dans « Choisis le type de ta demande ».` : 'ajoute des types (🏷️) — sans eux, un seul bouton s\u2019affichera.'}`
        : `🎛️ Mode boutons : ${nt ? `${nt} bouton(s) sous la carte.` : 'un gros bouton « Ouvrir un ticket » tant qu\u2019il n\u2019y a pas de types.'}`);
    }
    if (id === 'cfg:tik:categorie' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ tickets: { categorie: salon ? salon.id : null } },
        salon ? `📁 Les tickets naîtront sous « ${salon.name} » (l\u2019assistant 🤝 suivra automatiquement).` : '✅ Catégorie mise à jour.');
    }
    if (id === 'cfg:tik:panneau' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      if (!salon) return maj({ tickets: { panneau: null } }, '✅ Retiré.');
      maj({ tickets: { panneau: salon.id } });
      try {
        const t = require('../utils/tickets');
        await salon.send(t.panneauMessage(t.reglages(G), interaction.guild?.name)).catch(() => null);
        return montrer('🧾 Panneau envoyé dans ce salon, réglages enregistrés.');
      } catch { return montrer('🧾 Réglage enregistré — renvoie le panneau avec /tickets panneau si besoin.'); }
    }
    if (id === 'cfg:tik:logs' && interaction.isChannelSelectMenu()) {
      const salon = interaction.channels.first();
      return maj({ tickets: { logs: salon ? salon.id : null } },
        salon ? `📜 Transcriptions envoyées dans <#${salon.id}>.` : '✅ Transcriptions retirées — les tickets fermeront sans journal.');
    }
    if (id === 'cfg:tik:staff') {
      const role = interaction.roles?.first?.() || null;
      return maj({ tickets: { staffRole: role ? role.id : null } },
        role ? `🧑‍💼 Rôle staff des tickets : « ${role.name} ».` : '✅ Rôle mis à jour.');
    }
    if (id === 'cfg:tik:staff-off') return maj({ tickets: { staffRole: null } }, '🧹 Rôle retiré — seuls les « Gérer les messages » compteront.');
    if (id === 'cfg:tik:types') {
      const actuelle = (stockage.reglages(G).tickets || {}).types || [];
      const modal = new ModalBuilder().setCustomId('cfg:tik:types-modal').setTitle('🏷️ Types de tickets');
      const champ = new TextInputBuilder()
        .setCustomId('types')
        .setLabel('Un type par ligne (6 max) — emoji optionnel devant')
        .setPlaceholder('😀 Support\n🤝 Partenariat\n🧾 Réclamation')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(600).setRequired(false)
        .setValue(actuelle.join('\n').slice(0, 600));
      modal.addComponents(new ActionRowBuilder().addComponents(champ));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }
    if (id === 'cfg:tik:types-modal') {
      const brut = String(interaction.fields?.getTextInputValue('types') || '');
      const types = brut.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 6);
      return maj({ tickets: { types } }, types.length
        ? `🏷️ ${types.length} type(s) : c\u2019est eux que montreront les boutons ou le menu. Renvoie le panneau (🧾) pour les afficher.`
        : '🧹 Plus de types : le panneau affichera le bouton unique « Ouvrir un ticket ».');
    }
    if (id === 'cfg:tik:types-off') return maj({ tickets: { types: [] } }, '🧹 Types effacés — retour au bouton unique.');
    if (id === 'cfg:tik:textes') {
      const t = stockage.reglages(G).tickets || {};
      const modal = new ModalBuilder().setCustomId('cfg:tik:textes-modal').setTitle('✏️ Textes du panneau');
      const titre = new TextInputBuilder().setCustomId('titre').setLabel('Titre (laisse vide = par défaut)')
        .setStyle(TextInputStyle.Short).setMaxLength(80).setRequired(false).setValue(String(t.titre || '').slice(0, 80));
      const texte = new TextInputBuilder().setCustomId('texte').setLabel('Texte sous le titre (vide = par défaut)')
        .setStyle(TextInputStyle.Paragraph).setMaxLength(1000).setRequired(false).setValue(String(t.texte || '').slice(0, 1000));
      modal.addComponents(new ActionRowBuilder().addComponents(titre), new ActionRowBuilder().addComponents(texte));
      await interaction.showModal(modal).catch(() => null);
      return true;
    }
    if (id === 'cfg:tik:textes-modal') {
      const titre = String(interaction.fields?.getTextInputValue('titre') || '').trim() || null;
      const texte = String(interaction.fields?.getTextInputValue('texte') || '').trim() || null;
      return maj({ tickets: { titre, texte } }, '✏️ Textes du panneau enregistrés — renvoie le panneau (🧾) pour les voir.');
    }
    if (id === 'cfg:tik:textes-off') return maj({ tickets: { titre: null, texte: null } }, '🧹 Textes par défaut restaurés.');

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
  VIDE,
  titreNet,
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
