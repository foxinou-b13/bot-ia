/**
 * commands/confidentialite.js — transparence obligatoire pour un bot IA.
 * Discord (règle bots IA + vérification) et le RGPD demandent de dire
 * clairement ce qui est stocké et ce qui part chez les fournisseurs d'IA.
 */
const { SlashCommandBuilder } = require('discord.js');
const panneaux = require('../utils/panneaux');
const { fournisseursIA } = require('../config');

module.exports = {
  categorie: 'utilisateurs',

  data: new SlashCommandBuilder()
    .setName('confidentialite')
    .setDescription('Ce que ce bot stocke, ce qu\'il envoie à l\'IA, et comment se faire oublier'),

  async executer(interaction) {
    const cerveaux = fournisseursIA()
      .map((f) => (f === 'gemini' ? 'Google Gemini' : 'Groq (modèles open source)'))
      .join(' et ') || 'aucun (IA désactivée sur cet hébergement)';

    const texte = [
      '**Ce que je sais de toi**',
      '• Ton identifiant Discord + pseudo, uniquement si tu reçois un avertissement ou une sanction.',
      '• Rien d\'autre : pas d\'e-mail, pas de numéro, pas de nom réel.',
      '',
      '**Ce que je stocke, et où**',
      '• Avertissements et réglages du serveur : dans un fichier sur l\'hébergement du bot (Render), jamais publiés ailleurs.',
      '• Conversation avec l\'IA : en mémoire seulement, 12 derniers messages par salon, effacée au redémarrage.',
      '',
      '**Ce qui part vers une IA externe**',
      `• Quand tu poses une question, elle est envoyée à ${cerveaux} pour obtenir la réponse.`,
      '• Tes questions ne sont PAS utilisées par le bot pour entraîner quoi que ce soit.',
      '• Les réponses peuvent être conservées côté fournisseur selon SES règles — c\'est écrit dans sa propre politique.',
      '',
      '**Tes droits ici, tout de suite**',
      '• `/donnees` → voir ce que le bot garde sur toi, et tout effacer en un clic.',
      '• Un membre du staff peut aussi retirer tes avertissements (`/avertissement-retirer`).',
      '',
      '_Cette politique est celle de ce bot. Pour poser une question : tape `/aide`._',
    ].join('\n');

    return panneaux.repondre(interaction, panneaux.info('🔒 Confidentialité & données', texte), { ephemere: true });
  },
};
