# -*- coding: utf-8 -*-
import re

# ─────────── config.js : bouton → message-invitation dans le salon (plus de modale) ───────────
p = 'commands/config.js'
s = open(p, encoding='utf-8').read()

i = s.index("    if (id === 'cfg:accueil:fond-pj') {")
j = s.index("    if (id === 'cfg:accueil:fond-url') {")
bloc_actuel = s[i:j]
nouveau = """    if (id === 'cfg:accueil:fond-pj') {
      // Discord refuse les champs « fichier » dans ses formulaires (testé en live) :
      // on passe donc par une réponse au salon — la galerie du téléphone s'ouvre
      // avec le 📎 natif, et le bot efface tout juste après. Zéro MP, zéro trace.
      const choixFond = require('../utils/choix-fond');
      let invitation = null;
      try {
        invitation = await interaction.channel.send({
          content: `\u{1F4CE} ${interaction.user}, r\u00e9ponds \u00e0 ce message avec ton image de fond `
            + '(bouton \u{1F4CE} \u2192 galerie sur t\u00e9l\u00e9phone, \u00e0 c\u00f4t\u00e9 du champ d\u2019\u00e9criture ; fichiers sur PC). '
            + "D\u00e8s re\u00e7ue, je range tout et j\u2019efface ces deux messages \u2014 rien ne tra\u00eenera ici.",
          allowedMentions: { users: [interaction.user.id] },
        });
      } catch {
        return montrer('\u26a0\ufe0f Je ne peux pas \u00e9crire dans ce salon \u2014 utilise \u00ab \u{1F517} Adresse d\u2019image \u00bb juste en dessous.');
      }
      choixFond.demander(interaction, invitation);
      // l'aperçu s'auto-nettoie aussi, pour ne pas laisser 3 messages à quai
      setTimeout(() => {
        if (choixFond.chercherEnAttente(interaction.user.id)) {
          choixFond.__enAttente.delete(interaction.user.id);
          invitation.delete().catch(() => null);
        }
      }, 10 * 60 * 1000);
      return montrer('\u2b06\ufe0f Regarde juste au-dessus : **r\u00e9ponds au message du bot avec ton image** '
        + '(\u{1F4CE} \u2192 galerie). Je l\u2019affiche en aper\u00e7u, j\u2019enregistre, et j\u2019efface tout.');
    }
"""
s = s[:i] + nouveau + s[j:]

# supprimer le handler de la modale (plus de modale du tout)
i = s.index("    if (id === 'cfg:accueil:fond-pj-modal') {")
j = s.index("    if (id === 'cfg:accueil:fond-url') {", i) if "cfg:accueil:fond-url" in s[i:i+4000] else None
# trouver la fin du bloc : jusqu'au prochain « if (id === » après ce bloc
m = re.search(r"\n    if \(id === '", s[i+10:])
assert m
s = s[:i] + s[i + m.start() + 1:]

# retirer l'import FileUploadBuilder (plus utilisé)
s = s.replace("  ModalBuilder, TextInputBuilder, TextInputStyle, FileUploadBuilder,\n", "  ModalBuilder, TextInputBuilder, TextInputStyle,\n")

# textes de la carte : nouveau parcours
old_desc = re.search(r"      fond: \{\n        label: '🖼️ Image de fond de la carte',\n        desc: '.*?',\n      \},", s, re.S)
assert old_desc, 'desc fond introuvable'
s = s[:old_desc.start()] + """      fond: {
        label: '🖼️ Image de fond de la carte',
        desc: 'Le décor derrière la photo du nouveau.\\n• **Rien à faire par défaut** : le bot utilise l\\'image prévue pour ton serveur (prairie de cosmos).\\n• **Envie d\\'une autre image ?** Touche « 📱 Choisir une image » : le bot poste une invitation juste au-dessus — tu y **réponds avec ton image** (📎 → galerie du téléphone, fichiers du PC). Il vérifie, recadre tout seul au format de la carte, te montre l\\'aperçu, et **efface les messages** : rien ne traîne dans le salon, aucun message privé.\\n• « 🔗 Adresse d\\'image » : si tu préfères coller un lien. « 🌸 Fond par défaut » : pour y revenir à tout moment.',
      },""" + s[old_desc.end():]

# flags au lieu d'ephemeral (le warning des logs)
s = s.replace("return interaction.reply({ ...ecranRacine(), ephemeral: true }).catch(() => null);",
              "return interaction.reply({ ...ecranRacine(), flags: MessageFlags.Ephemeral }).catch(() => null);")
s = s.replace("await interaction.reply({ ...paquet, ephemeral: true }).catch(() => null);",
              "await interaction.reply({ ...paquet, flags: MessageFlags.Ephemeral }).catch(() => null);")
s = s.replace("} = require('discord.js');", "} = require('discord.js');", 1)
s = s.replace("  ModalBuilder, TextInputBuilder, TextInputStyle,\n} = require('discord.js');",
              "  ModalBuilder, TextInputBuilder, TextInputStyle, MessageFlags,\n} = require('discord.js');")
open(p, 'w', encoding='utf-8').write(s)
print('config.js : parcours réponse-au-salon branché, modale supprimée')

# ─────────── messageCreate : hook salon + retour au silence en MP ───────────
p = 'events/messageCreate.js'
s = open(p, encoding='utf-8').read()
old = """    if (!message.guild) {
      // seul cas de MP utile : l'admin envoie son image pour le fond de bienvenue
      const choixFond = require('../utils/choix-fond');
      await choixFond.traiterMp(message);
      return;
    }"""
new = "    if (!message.guild) return;                       // on ignore les MP"
assert old in s, 'bloc MP introuvable'
s = s.replace(old, new)
old = """  async executer(client, message) {
    try {"""
new = """  async executer(client, message) {
    try {
      // réponse attendue au message-invitation « envoie ton image de fond » ?
      const choixFond = require('../utils/choix-fond');
      if (await choixFond.traiterReponse(message)) return;"""
assert old in s, 'début executer introuvable'
s = s.replace(old, new, 1)
open(p, 'w', encoding='utf-8').write(s)
print('messageCreate : hook branché, MP de nouveau ignorés')

# ─────────── panneaux.js : flags Ephemeral ───────────
p = 'utils/panneaux.js'
s = open(p, encoding='utf-8').read()
old = """const { EmbedBuilder } = require('discord.js');"""
new = """const { EmbedBuilder, MessageFlags } = require('discord.js');"""
assert old in s
s = s.replace(old, new)
old = """  const paquet = { embeds: [embed], ephemeral: options.ephemere !== false };"""
new = """  const paquet = { embeds: [embed] };
  if (options.ephemere !== false) paquet.flags = MessageFlags.Ephemeral;"""
assert old in s, 'repondre introuvable'
s = s.replace(old, new)
open(p, 'w', encoding='utf-8').write(s)
print('panneaux.js : flags Ephemeral')

# ─────────── image-bienvenue : flags Ephemeral ───────────
p = 'commands/image-bienvenue.js'
s = open(p, encoding='utf-8').read()
s = s.replace("        ephemeral: true,\n", "        flags: MessageFlags.Ephemeral,\n")
s = s.replace("paquet = { content: '✅ Fond enregistré. (Impossible de générer l’aperçu ici, mais les cartes l’utiliseront.)', ephemeral: true };",
              "paquet = { content: '✅ Fond enregistré. (Impossible de générer l’aperçu ici, mais les cartes l’utiliseront.)', flags: MessageFlags.Ephemeral };")
s = s.replace("const {\n  SlashCommandBuilder, PermissionsBitField, AttachmentBuilder, EmbedBuilder,\n} = require('discord.js');",
              "const {\n  SlashCommandBuilder, PermissionsBitField, AttachmentBuilder, EmbedBuilder, MessageFlags,\n} = require('discord.js');")
open(p, 'w', encoding='utf-8').write(s)
print('image-bienvenue : flags Ephemeral')
