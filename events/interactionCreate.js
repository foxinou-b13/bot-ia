/**
 * events/interactionCreate.js — reçoit toutes les commandes.
 * Règle d'or : l'utilisateur reçoit TOUJOURS une réponse, jamais de silence.
 */
const { Events, MessageFlags,
} = require('discord.js');
const panneaux = require('../utils/panneaux');

module.exports = {
  nom: Events.InteractionCreate,
  uneFois: false,

  async executer(client, interaction) {
    // ─── appels entre membres transmis par Otaku (« app:… ») ───
    if (interaction.isMessageComponent?.() && String(interaction.customId || '').startsWith('app:')) {
      try {
        await require('../utils/appels').traiterBouton(interaction);
      } catch (erreur) {
        console.warn('⚠️ Appel membre :', erreur.message);
      }
      return;
    }

    // ─── menus déroulants, boutons, sélecteurs ───
    if (interaction.isMessageComponent?.() || interaction.isModalSubmit?.()) {
      // isMessageComponent couvre TOUS les composants : boutons, menus texte/salon/rôle/utilisateur/membles.
      // (Un ancien oubli du sélecteur de rôle faisait « l'application n'a pas répondu » — ne jamais retirer.)
      for (const commande of client.commands.values()) {
        if (typeof commande.composant !== 'function') continue;
        try {
          const pris = await commande.composant(interaction);
          if (pris) return;
        } catch (erreur) {
          console.error(`⚠️ Composant ${interaction.customId} :`, erreur.message);
          if (!interaction.replied && !interaction.deferred) {
            await interaction.reply({
              embeds: [panneaux.erreur('❌ Petit souci', 'Je n\'ai pas pu enregistrer ce réglage. Réessaie.')],
              flags: MessageFlags.Ephemeral,
            }).catch(() => null);
          }
          return;
        }
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;

    const commande = client.commands.get(interaction.commandName);
    if (!commande) {
      return panneaux.oups(interaction, '🤔 Commande inconnue',
        'Cette commande n\'existe pas (ou plus). Utilise `/aide` pour voir la liste à jour.');
    }

    try {
      await commande.executer(interaction);
    } catch (erreur) {
      console.error(`⚠️ /${interaction.commandName} :`, erreur);
      const message = {
        embeds: [panneaux.erreur('❌ Une erreur est survenue',
          'Je n\'ai pas réussi à terminer cette action. Réessaie, et si ça se répète préviens un administrateur.')],
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.editReply(message);
        } else {
          await interaction.reply({ ...message, flags: MessageFlags.Ephemeral });
        }
      } catch {
        // Rien de plus à faire : on ne laisse jamais le bot planter pour ça.
      }
    }
  },
};
