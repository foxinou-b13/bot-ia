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
      .setDescription('Lequel régler ? (vide = voir l\'état complet)')
      .setRequired(false)
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

    // `/automod` seul, ou avec « voir » : l'état complet — rien à choisir d'abord.
    if (!module || module === 'voir') {
      const lignes = Object.entries(MODULES).map(([cle, libelle]) => (
        `${reglages.automod[cle] ? '✅' : '⬜'} ${libelle}`
      ));
      lignes.push(`\n${reglages.automod.salonExempt ? `🔕 Salon exempté : <#${reglages.automod.salonExempt}>` : '🔕 Aucun salon exempté'}`);
      const sanction = reglages.automod.sanctionAuto
        ? `⚖️ Sanction auto : **${reglages.automod.seuilAvert || 3}** avertissements → sourdine **${reglages.automod.dureeSanction || 60} min**`
        : '⚖️ Sanction automatique : désactivée (les avertissements s\u2019empilent sans effet)';
      return panneaux.repondre(interaction, panneaux.info(
        '🛡️ Auto-modération — état',
        `${lignes.join('\n')}\n\n${sanction}\n\n`
        + '_Un réglage rapide, c\u2019est ici. Tout le détail (formule des sanctions, exemptions fines) se fait dans le panneau : **/config**._',
      ));
    }

    if (module === 'exempt') {
      if (!salon) {
        // Pas de salon = on retire l'exemption en place (propre, sans syntaxe à retenir).
        if (!reglages.automod.salonExempt) {
          return panneaux.repondre(interaction, panneaux.attention('ℹ️ Rien à retirer',
            'Aucun salon n\u2019est exempté en ce moment. Choisis un salon avec le champ « salon » pour en exempter un.'));
        }
        stockage.majReglages(interaction.guildId, { automod: { salonExempt: null } });
        return panneaux.ok(interaction, '✅ Exemption retirée',
          'La modération automatique s\u2019applique de nouveau partout.');
      }
      const valeur = reglages.automod.salonExempt === salon.id ? null : salon.id;
      stockage.majReglages(interaction.guildId, { automod: { salonExempt: valeur } });
      return panneaux.ok(interaction, valeur ? '🔕 Salon exempté' : '✅ Exemption retirée',
        valeur
          ? `La modération automatique ne s'appliquera pas dans <#${salon.id}>.`
          : 'La modération automatique s’applique de nouveau partout.');
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
