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
3. **Variables d'environnement** : Configurer un fichier `.env` avec `TOKEN`, `CLIENT_ID`, et `MONGODB_URI`.
4. **Lancement** : `node index.js`

---
*Projet développé pour optimiser les performances et l'organisation des Team Battles de la structure **KTB**.*