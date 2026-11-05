const { SlashCommandBuilder, PermissionsBitField } = require('discord.js');
const perms = require('../utils/permissions');
const panneaux = require('../utils/panneaux');
const stockage = require('../utils/stockage');

const MODULES = {
  spam: 'Spam (trop de messages d\'un coup)',
  liens: 'Liens et invitations Discord',
  insultes: 'Insultes',
  majuscules: 'Messages écrits en MAJUSCULES',
  raid: 'Raid (arrivées massives soudaines)',
};

module.exports = {
  categorie: 'moderation',
  MODULES,
  data: new SlashCommandBuilder()
    .setName('automod')
    .setDescription('Active ou désactive la modération automatique')
    .setDefaultMemberPermissions(PermissionsBitField.Flags.ManageGuild)
    .addStringOption((o) => o
      .setName('module')
      .setDescription('Lequel régler ? (ou « voir » pour l\'état complet)')
      .setRequired(true)
      .addChoices(
        { name: 'Voir l\'état', value: 'voir' },
        { name: 'Spam', value: 'spam' },
        { name: 'Liens / invitations', value: 'liens' },
        { name: 'Insultes', value: 'insultes' },
        { name: 'Majuscules', value: 'majuscules' },
        { name: 'Raid', value: 'raid' },
        { name: 'Salon exempté', value: 'exempt' },
      ))
    .addStringOption((o) => o
      .setName('etat')
      .setDescription('Activer ou désactiver le module')
      .setRequired(false)
      .addChoices(
        { name: 'Activer', value: 'activer' },
        { name: 'Désactiver', value: 'desactiver' },
      ))
    .addChannelOption((o) => o
      .setName('salon')
      .setDescription('À utiliser avec « salon exempté » : le salon où l\'auto-mod ne s\'applique pas')
      .setRequired(false)),

  async executer(interaction) {
    const refus = perms.verifier(interaction, PermissionsBitField.Flags.ManageGuild);
    if (refus) return panneaux.oups(interaction, '🚫 Action impossible', refus);

    const module = interaction.options.getString('module');
    const etat = interaction.options.getString('etat');
    const salon = interaction.options.getChannel('salon');
    const reglages = stockage.reglages(interaction.guildId);

    if (module === 'voir') {
      const lignes = Object.entries(MODULES).map(([cle, libelle]) => (
        `${reglages.automod[cle] ? '✅' : '⬜'} ${libelle}`
      ));
      lignes.push(`\n${reglages.automod.salonExempt ? `🔕 Salon exempté : <#${reglages.automod.salonExempt}>` : '🔕 Aucun salon exempté'}`);
      return panneaux.repondre(interaction, panneaux.info(
        '🛡️ Modération automatique',
        `${lignes.join('\n')}\n\n_Modifie avec \`/automod module:... etat:...\`_`,
      ));
    }

    if (module === 'exempt') {
      if (!salon) {
        return panneaux.oups(interaction, '❓ Salon manquant',
          "Choisis un salon : `/automod module:Salon exempté salon:#le-salon` (ou aucun salon pour désactiver l'exemption).");
      }
      const valeur = reglages.automod.salonExempt === salon.id ? null : salon.id;
      stockage.majReglages(interaction.guildId, { automod: { salonExempt: valeur } });
      return panneaux.ok(interaction, valeur ? '🔕 Salon exempté' : '✅ Exemption retirée',
        valeur
          ? `La modération automatique ne s'appliquera pas dans <#${salon.id}>.`
          : `La modération automatique s'applique de nouveau partout.`);
    }

    if (!etat) {
      return panneaux.oups(interaction, '❓ État manquant',
        `Précise **Activer** ou **Désactiver** pour le module « ${MODULES[module] || module} ».`);
    }

    const actif = etat === 'activer';
    stockage.majReglages(interaction.guildId, { automod: { [module]: actif } });

    return panneaux.ok(interaction,
      actif ? '✅ Module activé' : '⬜ Module désactivé',
      `**${MODULES[module] || module}** : ${actif ? 'activé' : 'désactivé'}.`);
  },
};
