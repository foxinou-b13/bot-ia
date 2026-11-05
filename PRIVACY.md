# Politique de confidentialité — Otaku

## Données stockées (par le bot lui-même)
- **Réglages du serveur** (auto-mod, logs, bienvenue, personnalité IA) : fichier `données/data.json` sur l'hébergement (Render).
- **Avertissements de modération** : identifiant Discord + raison + modérateur + date.
- Le bot ne stocke **aucun** contenu de message sur disque, aucun e-mail, aucun nom réel.

## Conversation IA
- Les questions envoyées à l'IA transitent par **Groq** (modèle `qwen/qwen3.8-27b`) puis **Google Gemini** (`gemini-flash-lite-latest`) en secours.
- Le bot ne conserve le contexte qu'**en mémoire vive** : 12 derniers messages par salon, effacés au redémarrage.
- Le bot n'**entraîne aucun modèle** avec les messages (conforme aux règles développeur de Discord).
- Chaque fournisseur applique sa propre politique : Groq n'utilise pas les données API pour l'entraînement ; pour Google Gemini (offre gratuite), consulter la politique Google AI.
- Toute question visiblement inappropriée (contenu adulte, mineurs, piratage) est **bloquée localement avant** d'être envoyée aux fournisseurs.

## Droits des utilisateurs
- `/donnees` : voir et effacer ses avertissements + sa limite anti-flood.
- `/confidentialite` : rappel de cette politique dans Discord.
- Un administrateur peut retirer tout avertissement via `/avertissement-retirer`.

## Conformité Discord
- Intents privilégiés (Message Content, Server Members) activés manuellement par le propriétaire.
- Le bot ne répond aux messages que s'il est mentionné ou via commande — pas de lecture de masse.
- Si le bot atteint 75 serveurs : passage en vérification Discord requis avant usage accru.
