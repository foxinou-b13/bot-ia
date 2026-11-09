const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const ia = require('../utils/ia');
const panneaux = require('../utils/panneaux');
const securite = require('../utils/securite-ia');
const journal = require('../utils/journal');
const stockage = require('../utils/stockage');

module.exports = {
  categorie: 'ia',
  data: new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Pose une question à l\'IA du serveur')
    .addStringOption((o) => o
      .setName('question')
      .setDescription('Ta question — l\u2019IA répond dans ta langue')
      .setMaxLength(1500)
      .setRequired(true)),

  async executer(interaction) {
    const question = interaction.options.getString('question').trim();
    if (!question) {
      return panneaux.oups(interaction, '❓ Question vide', 'Écris une vraie question et je m\'en occupe.');
    }

    // ─── sécurité pro : on filtre AVANT d'appeler l'IA (réglages + salon + sujet) ───
    const acces = securite.verifierAcces(interaction.guildId, interaction.channelId, question);
    if (!acces.ok) {
      if (acces.bloc) {
        await journal.journaliser(interaction.guild, {
          type: 'auto',
          titre: '🛡️ Question IA bloquée par le filtre',
          auteur: interaction.user.tag,
          cible: `#${interaction.channel?.name || 'salon'}`,
          raison: acces.bloc,
          details: question.slice(0, 180),
        });
      }
      return panneaux.oups(interaction, '🛡️ Je ne peux pas répondre là-dessus', acces.raison);
    }

    // ─── intelligence : l'IA répond dans la langue de la question ───
    const langue = ia.detecterLangue(question);

    const limite = ia.tropRapide(interaction.user.id);
    if (limite.bloque) {
      return panneaux.oups(interaction, '⏳ Doucement',
        `Attends encore **${limite.resteSecondes} seconde(s)** avant de me reposer une question.`);
    }

    await interaction.deferReply();

    try {
      let { texte, fournisseur } = await ia.demander({
        systeme: ia.consigneSysteme({
          serveur: interaction.guild?.name,
          pseudo: interaction.member?.displayName || interaction.user.username,
          consigneServeur: (stockage.reglages(interaction.guildId).ia || {}).consigne,
          guide: stockage.repereIA(interaction.guildId),
          langue,
        }),
        messages: [
          ...ia.historiquePourPrompt(interaction.guildId, interaction.channelId),
          { role: 'user', contenu: question },
        ],
      });

      // ─── filtrage SORTANT : si le modèle dérape, rien ne paraît ───
      const propre = securite.filtrerSortie(texte);
      if (propre === null) {
        await journal.journaliser(interaction.guild, {
          type: 'auto',
          titre: '🛡️ Réponse IA bloquée avant publication',
          auteur: `${fournisseur} (${interaction.user.tag})`,
          cible: `#${interaction.channel?.name || 'salon'}`,
          raison: 'contenu hors limites',
        });
        return interaction.editReply({
          embeds: [panneaux.attention('🛡️ Réponse retenue', "Le modèle a produit quelque chose que je ne peux pas publier ici. Reformule ta question et je retente.")],
        }).catch(() => null);
      }
      texte = propre;

      ia.memoriser(interaction.guildId, interaction.channelId, 'user', question,
        interaction.member?.displayName || interaction.user.username);
      ia.memoriser(interaction.guildId, interaction.channelId, 'assistant', texte);

      const morceaux = ia.decouper(texte);

      const carte = new EmbedBuilder()
        .setColor(panneaux.COULEUR)
        .setDescription(morceaux[0])
        .setTimestamp();
      await interaction.editReply({ embeds: [carte] }).catch(() => null);
      for (const suite of morceaux.slice(1)) {
        await interaction.followUp({
          embeds: [new EmbedBuilder().setColor(panneaux.COULEUR).setDescription(suite)],
        }).catch(() => null);
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
