const { SlashCommandBuilder } = require('discord.js');
const ia = require('../utils/ia');
const panneaux = require('../utils/panneaux');

module.exports = {
  categorie: 'ia',
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Pose une question à l\'IA du serveur')
    .addStringOption((o) => o
      .setName('question')
      .setDescription('Ta question, en français')
      .setMaxLength(1500)
      .setRequired(true)),

  async executer(interaction) {
    const question = interaction.options.getString('question').trim();
    if (!question) {
      return panneaux.oups(interaction, '❓ Question vide', 'Écris une vraie question et je m\'en occupe.');
    }

    const limite = ia.tropRapide(interaction.user.id);
    if (limite.bloque) {
      return panneaux.oups(interaction, '⏳ Doucement',
        `Attends encore **${limite.resteSecondes} seconde(s)** avant de me reposer une question.`);
    }

    await interaction.deferReply();

    try {
      const { texte, fournisseur } = await ia.demander({
        systeme: ia.consigneSysteme({
          serveur: interaction.guild?.name,
          pseudo: interaction.member?.displayName || interaction.user.username,
        }),
        messages: [
          ...ia.memoire(interaction.guildId, interaction.channelId),
          { role: 'user', contenu: question },
        ],
      });

      ia.memoriser(interaction.guildId, interaction.channelId, 'user', question);
      ia.memoriser(interaction.guildId, interaction.channelId, 'assistant', texte);

      const morceaux = ia.decouper(texte);
      await interaction.editReply({ content: morceaux[0] }).catch(() => null);
      for (const suite of morceaux.slice(1)) {
        await interaction.followUp({ content: suite }).catch(() => null);
      }
      return { fournisseur };
    } catch (erreur) {
      if (erreur instanceof ia.ErreurIA) {
        console.error('⚠️ IA indisponible :', JSON.stringify(erreur.details));
        return interaction.editReply({
          embeds: [panneaux.attention('🤖 Je ne peux pas répondre maintenant', ia.PHRASE_ECHEC)],
        }).catch(() => null);
      }
      console.error('⚠️ Erreur inattendue IA :', erreur.message);
      return interaction.editReply({
        embeds: [panneaux.erreur('❌ Petite panne', 'Quelque chose s\'est mal passé de mon côté. Réessaie dans un instant.')],
      }).catch(() => null);
    }
  },
};
