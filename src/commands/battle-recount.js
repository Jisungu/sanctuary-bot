const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const Player = require('../models/Player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-recount')
        .setDescription('Recalcule et rafraîchit l\'intégralité des statistiques des joueurs.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // Définit la réponse différée comme éphémère
        await interaction.deferReply({ ephemeral: true });

        try {
            const finishedBattles = await Battle.find({ status: 'finished' });

            if (!finishedBattles || finishedBattles.length === 0) {
                return interaction.editReply("📜 Aucune Guerre Sainte terminée n'a été trouvée dans les archives.");
            }

            const playersData = {};

            const initPlayer = (id) => {
                if (!playersData[id]) {
                    playersData[id] = {
                        tournamentsPlayed: 0,
                        tournamentsWon: 0,
                        wins: 0,
                        losses: 0,
                        mvpCount: 0,
                        charactersPlayed: {},
                        stageCounts: {},
                        opponents: {},
                        matchups: {}
                    };
                }
            };

            for (const battle of finishedBattles) {
                const t1 = battle.teams?.team1;
                const t2 = battle.teams?.team2;
                if (!t1 || !t2) continue;

                const t1Lives = t1.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                const t2Lives = t2.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                const winningTeam = t1Lives > 0 ? t1 : (t2Lives > 0 ? t2 : null);

                const allParticipants = [...t1.players, ...t2.players];
                allParticipants.forEach(pId => {
                    initPlayer(pId);
                    playersData[pId].tournamentsPlayed += 1;
                });

                if (winningTeam) {
                    winningTeam.players.forEach(pId => {
                        initPlayer(pId);
                        playersData[pId].tournamentsWon += 1;
                    });
                }

                const battleKills = {};
                battle.history.forEach(duel => {
                    if (duel.winnerId) {
                        battleKills[duel.winnerId] = (battleKills[duel.winnerId] || 0) + 1;
                    }
                });

                if (winningTeam) {
                    let mvpId = null;
                    let maxKills = -1;

                    winningTeam.players.forEach(pId => {
                        const kills = battleKills[pId] || 0;
                        if (kills > maxKills) {
                            maxKills = kills;
                            mvpId = pId;
                        }
                    });

                    if (mvpId) {
                        initPlayer(mvpId);
                        playersData[mvpId].mvpCount += 1;
                    }
                }

                for (const duel of battle.history) {
                    const { winnerId, loserId, winnerChar, loserChar, stage } = duel;
                    if (!winnerId || !loserId) continue;

                    initPlayer(winnerId);
                    initPlayer(loserId);

                    playersData[winnerId].wins += 1;
                    playersData[loserId].losses += 1;

                    if (stage) {
                        playersData[winnerId].stageCounts[stage] = (playersData[winnerId].stageCounts[stage] || 0) + 1;
                        playersData[loserId].stageCounts[stage] = (playersData[loserId].stageCounts[stage] || 0) + 1;
                    }

                    if (winnerChar) {
                        playersData[winnerId].charactersPlayed[winnerChar] = (playersData[winnerId].charactersPlayed[winnerChar] || 0) + 1;
                    }
                    if (loserChar) {
                        playersData[loserId].charactersPlayed[loserChar] = (playersData[loserId].charactersPlayed[loserChar] || 0) + 1;
                    }

                    if (!playersData[winnerId].opponents[loserId]) playersData[winnerId].opponents[loserId] = { wins: 0, losses: 0 };
                    if (!playersData[loserId].opponents[winnerId]) playersData[loserId].opponents[winnerId] = { wins: 0, losses: 0 };

                    playersData[winnerId].opponents[loserId].wins += 1;
                    playersData[loserId].opponents[winnerId].losses += 1;

                    if (winnerChar && loserChar) {
                        const winMatchupKey = `${winnerChar}_vs_${loserChar}`;
                        const loseMatchupKey = `${loserChar}_vs_${winnerChar}`;

                        if (!playersData[winnerId].matchups[winMatchupKey]) playersData[winnerId].matchups[winMatchupKey] = { wins: 0, losses: 0 };
                        if (!playersData[loserId].matchups[loseMatchupKey]) playersData[loserId].matchups[loseMatchupKey] = { wins: 0, losses: 0 };

                        playersData[winnerId].matchups[winMatchupKey].wins += 1;
                        playersData[loserId].matchups[loseMatchupKey].losses += 1;
                    }
                }
            }

            let updatedPlayersCount = 0;

            for (const [pId, data] of Object.entries(playersData)) {
                const topStage = Object.entries(data.stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

                await Player.findByIdAndUpdate(pId, {
                    $set: {
                        'stats.wins': data.wins,
                        'stats.losses': data.losses,
                        'stats.tournamentsPlayed': data.tournamentsPlayed,
                        'stats.tournamentsWon': data.tournamentsWon,
                        'stats.mvpCount': data.mvpCount,
                        'stats.mostPlayedStage': topStage,
                        'stats.charactersPlayed': data.charactersPlayed,
                        'stats.opponentsCount': data.opponents,
                        'stats.characterMatchups': data.matchups
                    }
                }, { upsert: true });

                updatedPlayersCount++;
            }

            return interaction.editReply({
                content: `🔄 **Recalcul terminé avec succès !**\n\n` +
                         `• **Guerres Saintes analysées :** ${finishedBattles.length}\n` +
                         `• **Chevaliers mis à jour :** ${updatedPlayersCount}`
            });

        } catch (error) {
            console.error("Erreur lors du calcul des statistiques :", error);
            return interaction.editReply("❌ Une erreur cosmique s'est produite lors du recalcul des statistiques.");
        }
    }
};