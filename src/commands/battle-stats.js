const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Battle = require('../models/Battle');
const { characters, stages } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-stats')
        .setDescription('Affiche les statistiques mondiales ou celles d\'un Chevalier.')
        .addUserOption(option => 
            option.setName('chevalier')
                .setDescription('Le joueur dont vous voulez voir les exploits.')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();
        const target = interaction.options.getUser('chevalier');
        const allBattles = await Battle.find({ status: 'finished' });

        if (!allBattles || allBattles.length === 0) {
            return interaction.editReply("📜 Les archives sont vides. Terminez au moins une Guerre Sainte pour voir les stats.");
        }

        const embed = new EmbedBuilder().setTimestamp();

        const getLabel = (value, list) => list.find(item => item.value === value)?.label || value;

        if (!target) {
            let totalDuels = 0;
            const charCounts = {};
            const stageCounts = {};
            const playerPresence = {};

            allBattles.forEach(battle => {
                totalDuels += battle.history.length;

                battle.presents.forEach(id => {
                    playerPresence[id] = (playerPresence[id] || 0) + 1;
                });

                battle.history.forEach(duel => {
                    if (duel.winnerChar) charCounts[duel.winnerChar] = (charCounts[duel.winnerChar] || 0) + 1;
                    if (duel.loserChar) charCounts[duel.loserChar] = (charCounts[duel.loserChar] || 0) + 1;
                    if (duel.stage) stageCounts[duel.stage] = (stageCounts[duel.stage] || 0) + 1;
                });
            });

            const topCharVal = Object.entries(charCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
            const topStageVal = Object.entries(stageCounts).sort((a, b) => b[1] - a[1])[0]?.[0];
            
            const topPlayers = Object.entries(playerPresence)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 3)
                .map(([id, count], i) => `${i + 1}. <@${id}> (${count} tournois)`)
                .join('\n');

            embed.setTitle('🌍 Archives Globales du Sanctuaire')
                .setColor('#f1c40f')
                .addFields(
                    { name: '📊 Activité', value: `🏰 **${allBattles.length}** Guerres Saintes\n⚔️ **${totalDuels}** Duels livrés`, inline: true },
                    { name: '🔥 Tendances', value: `👤 Perso le plus joué : **${getLabel(topCharVal, characters)}**\n🏟️ Stage le plus joué : **${getLabel(topStageVal, stages)}**`, inline: true },
                    { name: '🥇 Top 3 Fidélité', value: topPlayers || "Données insuffisantes", inline: false }
                );

        } else {
            const userId = target.id;
            let battlesPlayed = 0;
            let battlesWon = 0;
            let duelsWon = 0;
            let duelsLost = 0;
            const myChars = {};
            const myStages = {};

            allBattles.forEach(battle => {
                const inT1 = battle.teams.team1.players.includes(userId);
                const inT2 = battle.teams.team2.players.includes(userId);
                
                if (inT1 || inT2) {
                    battlesPlayed++;
                    
                    const t1Lives = battle.teams.team1.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                    const t2Lives = battle.teams.team2.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                    
                    if ((inT1 && t1Lives > 0) || (inT2 && t2Lives > 0)) battlesWon++;

                    battle.history.forEach(duel => {
                        if (duel.winnerId === userId) {
                            duelsWon++;
                            myChars[duel.winnerChar] = (myChars[duel.winnerChar] || 0) + 1;
                            myStages[duel.stage] = (myStages[duel.stage] || 0) + 1;
                        } else if (duel.loserId === userId) {
                            duelsLost++;
                            myChars[duel.loserChar] = (myChars[duel.loserChar] || 0) + 1;
                            myStages[duel.stage] = (myStages[duel.stage] || 0) + 1;
                        }
                    });
                }
            });

            const favCharVal = Object.entries(myChars).sort((a, b) => b[1] - a[1])[0]?.[0];
            const favStageVal = Object.entries(myStages).sort((a, b) => b[1] - a[1])[0]?.[0];

            if (battlesPlayed === 0) {
                embed.setTitle(`👤 Profil : ${target.username}`)
                    .setColor('#95a5a6')
                    .setThumbnail(target.displayAvatarURL())
                    .setDescription(`📜 **Ce Chevalier n'a pas encore mené d'assaut dans l'arène.**\nSes statistiques s'éveilleront dès sa première participation à une Guerre Sainte.`);
                
                return interaction.editReply({ embeds: [embed] });
            }

            embed.setTitle(`👤 Profil : ${target.username}`)
                .setColor('#3498db')
                .setThumbnail(target.displayAvatarURL())
                .addFields(
                    { name: '🏆 Carrière', value: `🏰 **${battlesPlayed}** Guerres Saintes (**${battlesWon}** victoires)\n⚔️ Winrate : **${Math.round((duelsWon/(duelsWon+duelsLost || 1))*100)}%**`, inline: false },
                    { name: '⚔️ Bilan Duels', value: `✅ Gagnés : **${duelsWon}**\n❌ Perdus : **${duelsLost}**`, inline: true },
                    { name: '🎭 Habitudes', value: `🥋 Perso : **${getLabel(favCharVal, characters)}**\n🏟️ Stage : **${getLabel(favStageVal, stages)}**`, inline: true }
                );
        }

        return interaction.editReply({ embeds: [embed] });
    }
};