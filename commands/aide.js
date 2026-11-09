const { SlashCommandBuilder } = require('discord.js');
const panneaux = require('../utils/panneaux');
const { config, fournisseursIA } = require('../config');

module.exports = {
  categorie: 'ia',
  data: new SlashCommandBuilder()
    .setName('aide')
    .setDescription('Affiche toutes les commandes du bot'),

  async executer(interaction) {
    const dispo = fournisseursIA();
    const cerveau = dispo.length
      ? dispo.map((f) => (f === 'gemini' ? 'Google Gemini' : 'Groq')).join(' puis ')
      : 'aucune clé IA configurée';

    const description = [
      '**ℹ️ Ce bot en bref**',
      '`/aide` — cette liste, en privé (le salon d’accueil et les repères sont dans `/guide`)',
      '',
      '**🤖 Intelligence artificielle**',
      '`/ask` — pose une question, je réponds **dans ta langue** (mémoire du salon conservée)',
      'Mentionne-moi dans un message, ou écris juste « ota » + ta question : pas besoin de mention',
      'Une vraie question posée dans le salon, sans ping ? J’y réponds aussi (réglable dans /config → IA)',
      '« ota, appelle Jordan » : je demande la raison, je fais choisir au besoin, et je préviens la personne',
      '`/ia-reset` — j\'oublie la conversation en cours',
      '',
      '**🛡️ Modération**',
      '`/ban` `/kick` `/mute` — sanctions',
      '`/warn` `/avertissements` `/avertissement-retirer` — suivi des avertissements',
      '`/clear` `/slowmode` `/lock` `/unlock` `/role` — gestion du salon',
      '**📓 Journal du staff** — sanctions, auto-mod, messages supprimés/modifiés, départs : salon + contenu réglés dans `/config` → « Salons & repères »',
      '',
      '**⚙️ Réglages**',
      '`/config` — ⭐ LE PANNEAU : sections, menus déroulants, zéro saisie (auto-mod, salons, accueil, sanctions, IA)',
      '`/automod` `/logs` `/image-bienvenue` — réglages rapides, en commande directe',
      '',
      '**🔒 Tes données**',
      '`/donnees` — voir et effacer ce que le bot garde sur toi',
      '`/guide` — les repères du serveur (règles, support, accueil)',
      '`/confidentialite` — ce qui est stocké et ce qui part vers l\'IA',
      '',
      `_Cerveau : ${cerveau} · version ${config.version}_`,
    ].join('\n');

    return panneaux.repondre(interaction, panneaux.info('📖 Commandes d\'Otaku', description), { ephemere: true });
  },
};
