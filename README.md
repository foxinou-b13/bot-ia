# 🤖 Otaku — bot Discord IA + modération

Bot Discord en français, fait pour tourner **gratuitement** sur Render.
Deux métiers :

- **IA** : `/ask` ou une simple mention du bot → réponse **dans la langue de la question**, avec mémoire de la conversation et qui sait qui a dit quoi.
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
- `/ask question:` — pose une question, l’IA répond dans la langue de la question
- *mentionner le bot* — il répond aussi
- `/ia-reset` — efface la mémoire du salon
- `/aide` — liste tout

**Modération**
- `/ban` `/kick` `/mute` — sanctions (l'utilisateur est prévenu en MP)
- `/warn` `/avertissements` `/avertissement-retirer` — suivi des avertissements
- `/clear` `/slowmode` `/lock` `/unlock` `/role` — gestion du salon
- `/automod` — tape-la seul pour voir l'état complet ; active ou coupe chaque module (spam, liens, insultes, majuscules, raid), gère le salon exempté
- `Journal du staff` (réglé dans `/config` → « Salons & repères », contenu au choix) — note les sanctions, les alertes d'auto-modération, les messages supprimés, les messages modifiés (avant/après) et les départs de membres, avec alerte sur les comptes de moins de 7 jours
- `/logs` — le salon du journal du staff (sanctions, auto-mod, suppressions, modifications, départs)
- `/bienvenue` — message d'accueil (`{membre}`, `{serveur}`)

---

## 3. Les 3 choses à faire côté Discord (une seule fois)

**a. Activer les deux « intents »** — sans ça le bot se connecte mais ne lit aucun message
(surveillance et réponses par mention en pause).
Developer Portal → ton application → **Bot** → tout en bas, cocher :
- ✅ **MESSAGE CONTENT INTENT**
- ✅ **SERVER MEMBERS INTENT**

puis **Save Changes**.

**b. Inviter le bot** avec ce lien (remplace `BOT_ID` par l'Application ID).
Deux choix — **le premier est recommandé** (le bot n'exige que ce dont il sert, pas les clés du royaume) :
```
# Recommandé : modération + bienvenue + panneau, rien de plus
https://discord.com/oauth2/authorize?client_id=BOT_ID&permissions=1099914407126&scope=bot%20applications.commands

# Ou l'ancienne variante « tout pouvoir » (Administrateur) — plus simple, moins prudente :
https://discord.com/oauth2/authorize?client_id=BOT_ID&permissions=8&scope=bot%20applications.commands
```
> Mets les **mêmes permissions** dans le Developer Discord → *OAuth2 → URL Generator* / *Guild Install* : un bot volé avec « Administrateur » peut tout casser ; avec la liste courte, il ne peut « « que » modérer. »

**c. Récupérer les clés IA gratuites** :
- Gemini → <https://aistudio.google.com/apikey> → *Create API key*
- Groq → <https://console.groq.com/keys> → *Create API Key*

**d. Verrouiller le diagnostic (recommandé)** : dans Render → *Environment*, ajoute
`JETON_SANTE` avec une phrase secrète inventée (ex. `chat-bleu-42-render`).
Sans elle, `/test-ia` et `/diagnostic` restent actifs mais limités à 3 tests/heure
par visiteur — tes clés IA coûtent de l'argent, on ne les laisse pas à l'encan.

---

## 🔒 Sécurité — ce qui est protégé, et ce qui dépend de toi

Côté bot (déjà en place) :
- **Aucun secret dans le code** : token, clés IA et base de données vivent uniquement dans les variables Render.
- **Panneau /config et sanctions réservés au staff** (`Gérer le serveur`), vérifié deux fois (par Discord ET par le bot).
- **Les MP ne sont jamais lus** : le bot les ignore complètement ; rien à cacher côté messages privés.
- **Limites anti-inondation** : 6 questions IA/minute par membre, texte entré coupé à 1 500 caractères, formulaires à 500, images de fond ≤ 8 Mo vérifiées byte à byte.
- **Endpoints de diagnostic verrouillables** (`JETON_SANTE`) et `/test-ia` limité à 3 appels/heure/IP par défaut ; le tag du bot n'est plus exposé sur `/health`.
- **Fichiers supprimés automatiquement** : l'image de fond envoyée dans le salon est effacée juste après enregistrement (le CDN Discord purge de lui-même les pièces jointes des messages supprimés).

Côté TOI (aucun code à toucher) :
1. **Double authentification (2FA)** activée sur Discord, GitHub et Render. Un bot public se fait souvent copier ; tes comptes sont le vrai coffre.
2. **Ne jamais coller le token du bot** dans un chat, un issue GitHub ou une capture. S'il fuit : Developer Portal → *Reset Token*, puis la nouvelle valeur dans Render.
3. **Clé GitHub Personal Access Token** : si tu en as déjà partagé une quelque part (chat, capture…), régénère-la (Settings → Developer settings → *Tokens* → delete + create) et donne-moi seulement la nouvelle quand il faut pousser.
4. **Clés IA** : Gemini et Groq ont des plafonds gratuits ; ajoute une alerte de dépassement dans leurs consoles si tu peux.
5. Sur le serveur : garde **`@everyone` sans « Administrateur »**, et le **niveau de vérification** du serveur à *Moyen* minimum — ça coupe l'herbe sous le pied des raids de comptes neufs avant même que le bot ait à agir.
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
- **📋 Salons & repères** : logs du staff, salon des règles, salon pour contacter le staff — boutons « retirer » pour annuler.
- **🛡️ Auto-modération** : modules activables/désactivables + salon exempté.
- **⚖️ Sanctions** : punition automatique après X avertissements.
- **🤖 IA** : couper/réactiver par salon, personnalité (formulaire), oublier la mémoire.

## /guide (public)
Carte des repères (règles, contact du staff, accueil). L'IA (`/ask`, mention) reçoit les mêmes liens et répond
« voici le salon » à toute question du type « qui contacter ? ». Rien n'est inventé : que les salons réglés dans /config.


## 💾 Persistance (recommandé pour un bot public)
Render gratuit efface le disque à chaque redéploiement. Pour que chaque serveur
garde ses réglages et avertissements, ajoute une base **gratuite** MongoDB Atlas :
1. [cloud.mongodb.com](https://cloud.mongodb.com) → créer un compte gratuit → cluster **M0** (pas de carte).
2. Security → Database Access → ajouter user (readWrite) → mot de passe.
3. Security → Network Access → `Allow Access from Anywhere` (0.0.0.0/0).
4. Connect → Drivers → copier la chaîne, remplacer `<password>` → la coller dans Render : variable `MONGODB_URI`.
Le bot : `💾 Base de données reliée` dans les logs, restaurés au démarrage, miroir écrit en arrière-plan
(fichiers `config` et `warns` dans la base `otaku`, collection `fichiers`). Sans la variable, tout marche
aussi, mais les réglages repartent à zéro à chaque redéploiement.
