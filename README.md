# 🤖 Otaku — bot Discord IA + modération

Bot Discord en français, fait pour tourner **gratuitement** sur Render.
Deux métiers :

- **IA** : `/ask` ou une simple mention du bot → réponse en français, avec mémoire de la conversation.
  Deux fournisseurs gratuits, bascule automatique : **Google Gemini** puis **Groq**.
- **Modération** : sanctions, avertissements, nettoyage, verrouillage, auto-mod, logs, bienvenue.

---

## Conformité & sécurité IA

- Filtrage entrant/sortant des sujets interdits (adulte, mineurs, piratage) avant et après l'appel au modèle.
- Mention « contenu généré par une IA » sur chaque réponse ; refus poli sans appel réseau quand c'est bloqué.
- Audit des blocages dans le salon de logs (commande `/logs`).
- `/donnees` (droit à l'effacement) et `/confidentialite` (transparence) pour les membres.
- Politique complète : [PRIVACY.md](PRIVACY.md).

## 1. Ce dont tu as besoin

| Élément | Où le trouver | Prix |
|---|---|---|
| Token du bot | Discord Developer Portal → Bot → Reset Token | gratuit |
| Application ID | Developer Portal → General Information | gratuit |
| Clé Gemini | <https://aistudio.google.com/apikey> | gratuit |
| Clé Groq | <https://console.groq.com/keys> | gratuit |
| Hébergement | Render (Web Service) | gratuit |

---

## 2. Les commandes

**IA**
- `/ask question:` — pose une question
- *mentionner le bot* — il répond aussi
- `/ia-reset` — efface la mémoire du salon
- `/aide` — liste tout

**Modération**
- `/ban` `/kick` `/mute` — sanctions (l'utilisateur est prévenu en MP)
- `/warn` `/avertissements` `/avertissement-retirer` — suivi des avertissements
- `/clear` `/slowmode` `/lock` `/unlock` `/role` — gestion du salon
- `/automod` — spam, invitations + liens, insultes, majuscules, raid, salon exempté
- `/logs` — salon où sont notées les sanctions
- `/bienvenue` — message d'accueil (`{membre}`, `{serveur}`, `{nombre}`)

---

## 3. Les 3 choses à faire côté Discord (une seule fois)

**a. Activer les deux « intents »** — sans ça le bot se connecte mais ne lit aucun message
(surveillance et réponses par mention en pause).
Developer Portal → ton application → **Bot** → tout en bas, cocher :
- ✅ **MESSAGE CONTENT INTENT**
- ✅ **SERVER MEMBERS INTENT**

puis **Save Changes**.

**b. Inviter le bot** avec ce lien (remplace `BOT_ID` par l'Application ID) :
```
https://discord.com/oauth2/authorize?client_id=BOT_ID&permissions=8&scope=bot%20applications.commands
```

**c. Récupérer les clés IA gratuites** :
- Gemini → <https://aistudio.google.com/apikey> → *Create API key*
- Groq → <https://console.groq.com/keys> → *Create API Key*

---

## 4. Installation sur Render (pas à pas)

**Méthode rapide (le fichier `render.yaml` s'occupe de tout)**
1. Render → **New +** → **Blueprint** → choisis ce dépôt → **Apply**.
2. Render demande les 4 valeurs : `DISCORD_TOKEN`, `BOT_ID`, `GEMINI_API_KEY`, `GROQ_API_KEY`.
   Colle-les, valide.
3. Attends le message `✅ Connecté en tant que Otaku#…` dans les logs.

**Méthode manuelle (si tu préfères)**
1. **New +** → **Web Service** → choisis le dépôt.
   - Language **Node** · Build `npm install` · Start `npm start` · Plan **Free**
2. Onglet **Environment** → ajoute les 4 variables ci-dessus.
3. **Deploy**.

> Les commandes `/…` sont **enregistrées automatiquement à chaque démarrage** :
> tu n'as rien à lancer à la main. Elles peuvent mettre 1 à 5 minutes à apparaître.

4. **Empêcher la mise en veille** (Render gratuit s'endort après 15 min) :
   UptimeRobot → **New Monitor → HTTP(s)** → URL `https://TON-SERVICE.onrender.com/health`
   → intervalle **5 minutes**.

---

## 5. Vérifier que tout va bien

- `https://TON-SERVICE.onrender.com/health` → doit renvoyer `"statut":"ok"` et `"connecte":true`.
- `https://TON-SERVICE.onrender.com/diagnostic` → liste des commandes chargées, mémoire, ping.
- En cas de doute : Render → **Logs**. Chaque panne y est expliquée en français.

---

## 6. Réglages fins (facultatifs)

Tout se règle par variables d'environnement, sans toucher au code :

| Variable | Par défaut | Effet |
|---|---|---|
| `GEMINI_MODEL` | `gemini-3.5-flash` | modèle Gemini |
| `GROQ_MODEL` | `qwen/qwen3.8-27b` | modèle Groq |
| `IA_TEMPERATURE` | `0.7` | créativité (0 = sage, 1 = fantaisiste) |
| `IA_MAX_TOKENS` | `900` | longueur max d'une réponse |
| `IA_MEMOIRE` | `12` | messages retenus par salon |
| `IA_PAUSE_MS` | `15000` | délai anti-flood entre deux questions |
| `AUTOMOD_SPAM_MESSAGES` | `6` | messages avant alerte spam |
| `AUTOMOD_SPAM_SECONDES` | `8` | fenêtre du spam |
| `AUTOMOD_RAID_INSCRITS` | `6` | arrivées avant alerte raid |
| `AUTOMOD_RAID_SECONDES` | `20` | fenêtre du raid |

---

## 7. Bon à savoir

- **Les données** (avertissements, réglages) sont dans `data/*.json`. Sur Render gratuit le disque
  est remis à zéro à chaque redéploiement : les réglages tiennent entre deux redémarrages,
  mais pas après une mise en ligne. Suffisant pour un serveur ; on pourra brancher une vraie base plus tard.
- **Un seul bot par token** : ne lance pas deux instances avec le même token.
- **Le token ne doit jamais être publié** : il vit uniquement dans les variables Render.

---

## 8. Tests

```bash
npm test
```

Huit suites vérifient la détection auto-mod, les permissions, les sanctions, l'IA (bascule Gemini → Groq),
les messages, la structure des commandes et la sécurité (aucun secret dans le code).


## Panneau /config — sections (réorganisation)
Tape `/config` : un menu « Que veux-tu configurer ? » avec 5 sections ; chaque section n'affiche que ses sélecteurs.
- **👋 Accueil** : salon de bienvenue (sélecteur), message (formulaire), rôle automatique donné aux nouveaux (sélecteur de rôle).
- **📋 Salons & repères** : logs du staff, salon des règles, salon support/tickets — boutons « retirer » pour annuler.
- **🛡️ Auto-modération** : modules activables/désactivables + salon exempté.
- **⚖️ Sanctions** : punition automatique après X avertissements.
- **🤖 IA** : couper/réactiver par salon, personnalité (formulaire), oublier la mémoire.

## /guide (public)
Carte des repères (règles, support/tickets, accueil). L'IA (`/ask`, mention) reçoit les mêmes liens et répond
« voici le salon » à toute question du type « où ouvrir un ticket ? ». Rien n'est inventé : que les salons réglés dans /config.
