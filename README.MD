# 🏛️ Sanctuary Bot - KTB Team Battle System

[![Node.js](https://img.shields.io/badge/Node.js-LTS-green.svg)](https://nodejs.org/)
[![Discord.js](https://img.shields.io/badge/Discord.js-v14-blue.svg)](https://discord.js.org/)
[![MongoDB](https://img.shields.io/badge/MongoDB-Database-brightgreen.svg)](https://www.mongodb.com/)

**Sanctuary Bot** est un système d'automatisation de **Team Battles** développé pour la structure **KTB**. Initialement conçu pour la scène compétitive de **Tekken 8**, cet outil digitalise l'intégralité du workflow des rencontres en équipe, garantissant une gestion impartiale et fluide du Sanctuaire.

## ⚔️ Le Concept "Team Battle" par KTB

Le bot agit comme l'arbitre central des rencontres compétitives :
* **Immersion Thématique** : Habillage complet inspiré de l'univers de *Saint Seiya* (Le Sanctuaire, l'Appel d'Athéna, l'Horloge du Destin).
* **Matchmaking Équilibré** : Un algorithme propriétaire répartit les joueurs en deux armées en équilibrant la somme totale des niveaux (ranks 1 à 5) pour assurer une compétition loyale.
* **Gestion du "Cosmos" (Vies)** : Suivi dynamique des points de vie par joueur avec mise à jour visuelle en temps réel via des composants Discord interactifs.
* **Suivi de la Meta** : Enregistrement automatique des personnages joués et des stages choisis pour une analyse post-match.

## 🚀 Fonctionnalités Techniques

* **Cycle de Vie Automatisé** : Gestion des états de la bataille via une machine à états (Inscription ➡️ Appel ➡️ Combat ➡️ Fin).
* **Dashboard Interactif** : Interface de match avec boutons de victoire, gestion du "toss" (tirage au sort) et annonce des duels.
* **Analytique de Performance** : Commande `/battle-stats` permettant d'extraire le winrate global, les personnages les plus performants et l'historique des membres de la KTB.
* **Persistance Robuste** : Intégration MongoDB pour sauvegarder chaque interaction et garantir la reprise des données en cas de redémarrage.

## 🛠️ Stack Technique

* **Backend** : Node.js (Architecture asynchrone).
* **Interface** : Discord.js v14 (Utilisation des Modals, Buttons, et Autocomplete).
* **Base de données** : MongoDB via Mongoose.
* **Logique Métier** : Algorithme d'équilibrage de poids (Greedy Algorithm) pour la formation des équipes.

## 📦 Installation

1. **Cloner le projet** : `git clone https://github.com/Jisungu/sanctuary-bot.git`
2. **Installation** : `npm install`
3. **Variables d'environnement** : Configurer un fichier `.env` avec `TOKEN`, `CLIENT_ID`, `MONGODB_URI`, `CONTROL_PANEL_TOKEN` (un jeton secret long et aléatoire), `CONTROL_PANEL_CHANNELS` et `PHOENIX_NOTIFY_USER_ID` (l'ID Discord de l'organisateur).
4. **Lancement** : `node index.js`

Dans le portail Discord Developer, activez aussi **Server Members Intent** (Bot → Privileged Gateway Intents). Le bot en a besoin pour retirer le rôle `TeamBattle` à tous ses membres.

## 🎛️ Panneau de contrôle

Le panneau de pilotage est disponible à l'adresse `/control-panel` du serveur. Son parcours principal suit les étapes de la Team Battle : inscriptions, appel, matchs et fin. Pendant les inscriptions, les joueurs peuvent être recherchés dans la base du bot puis ajoutés ou retirés directement. Pendant l’appel, un administrateur peut aussi marquer individuellement un inscrit présent ou absent depuis le panneau. Les commandes ponctuelles restent accessibles dans la section « Autres commandes du bot » ; les menus et boutons interactifs doivent ensuite être terminés dans Discord. Après chaque résultat de match, le bot publie aussi l'embed récapitulatif des vies.

Chaque équipe dispose d’un duel du Phénix. L’équipe qui a moins de vies que l’adversaire et au moins un joueur éliminé peut le lancer : elle choisit d’abord son joueur éliminé, puis n’importe quel adversaire de l’autre équipe. Seule l’équipe initiatrice consomme son droit. Si son joueur gagne, il revient avec une vie; un adversaire vivant perd une vie, tandis qu’un adversaire éliminé le reste. Si le joueur initiateur perd, il ne revient pas; un adversaire vivant conserve ses vies, tandis qu’un adversaire éliminé revient avec une vie sans consommer le droit de son équipe.

Les actions sont protégées par `CONTROL_PANEL_TOKEN`. Configurez cette variable dans l'environnement du serveur (par exemple dans les variables d'environnement Render), gardez-la secrète et saisissez sa valeur à l'ouverture du panneau. Sans cette variable, l'API du panneau reste désactivée.

`CONTROL_PANEL_CHANNELS` associe chaque serveur Discord aux salons utilisés pour les messages du panneau. Ajoutez les IDs réels dans `.env` :

```env
CONTROL_PANEL_CHANNELS='{"ID_SERVEUR":{"registration":"ID_SALON_INSCRIPTIONS","checkin":"ID_SALON_CHECKIN","battle":"ID_SALON_DEROULEMENT"}}'
```

Le panneau utilise le salon `registration` pour créer les inscriptions, `checkin` pour le pointage et `battle` pour les autres commandes et annonces. Les messages existants sont édités dans leur salon d'origine. Le bot doit avoir accès à ces salons ainsi que les permissions requises par chaque commande.

Au lancement d'une Team Battle, le bot publie `public/img/rules.png` et un bouton de demande du Phénix dans la discussion de chaque salon vocal. Le joueur choisit d'abord un membre éliminé de son équipe, puis un adversaire. La demande est transmise dans un fil privé du salon `battle`; le duel doit ensuite être validé et lancé par un administrateur avec `/battle-phoenix`.

Configurez l'organisateur à notifier :

```env
PHOENIX_NOTIFY_USER_ID=ID_DISCORD_DE_L_ORGANISATEUR
```

Le bot doit disposer des permissions `CreatePrivateThreads`, `SendMessagesInThreads` et `ManageThreads` dans le salon `battle`. L'organisateur doit avoir accès à ce salon. Les administrateurs disposant de la permission de gérer les fils peuvent également voir les fils privés.

La commande administrateur `/battle-clean` supprime les salons vocaux et les rôles d'équipe des Team Battles terminées, puis retire le rôle `TeamBattle` à ses membres. Elle refuse de s'exécuter tant qu'une bataille est en cours. Le bot doit avoir `ManageChannels` et `ManageRoles`, et son rôle le plus élevé doit être placé au-dessus des rôles à supprimer ou retirer.

---
*Projet développé pour optimiser les performances et l'organisation des Team Battles de la structure **KTB**.*