/**
 * utils/panneaux.js — les réponses visuelles du bot.
 * Un seul style, en français, jamais de jargon technique à l'écran.
 */
const { EmbedBuilder } = require('discord.js');

const COULEUR = 0x5865f2;          // bleu Discord : sobre et lisible
const COULEUR_OK = 0x3ba55d;
const COULEUR_ATTENTION = 0xfaa61a;
const COULEUR_ERREUR = 0xed4245;

function base(titre, description, couleur) {
  return new EmbedBuilder()
    .setColor(couleur)
    .setTitle(titre)
    .setDescription(description || null);
}

const succes = (titre, description) => base(titre, description, COULEUR_OK);
const info = (titre, description) => base(titre, description, COULEUR);
const attention = (titre, description) => base(titre, description, COULEUR_ATTENTION);
const erreur = (titre, description) => base(titre, description, COULEUR_ERREUR);

/** Répond simplement, en gérant les deux cas (réponse ou suivi). */
async function repondre(interaction, embed, options = {}) {
  const paquet = { embeds: [embed], ephemeral: options.ephemere !== false };
  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(paquet).catch(() => null);
  }
  return interaction.reply(paquet).catch(() => null);
}

const ok = (interaction, titre, description, options) =>
  repondre(interaction, succes(titre, description), options);
const oups = (interaction, titre, description, options) =>
  repondre(interaction, erreur(titre, description), options);

module.exports = { COULEUR, succes, info, attention, erreur, repondre, ok, oups };
