/**
 * events/interactionCreate.js — reçoit toutes les commandes.
 * Règle d'or : l'utilisateur reçoit TOUJOURS une réponse, jamais de silence.
 */
const { Events } = require('discord.js');
const panneaux = require('../utils/panneaux');

module.exports = {
  nom: Events.InteractionCreate,
  uneFois: false,

  async executer(client, interaction) {
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
          await interaction.reply({ ...message, ephemeral: true });
        }
      } catch {
        // Rien de plus à faire : on ne laisse jamais le bot planter pour ça.
      }
    }
  },
};
