const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Player = require('../models/Player');
const { characters } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player-profile')
        .setDescription('Affiche la carte de visite et les statistiques détaillées d\'un Chevalier.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur dont vous voulez voir le profil (par défaut vous-même)')
                .setRequired(false)),

    async execute(interaction) {
        await interaction.deferReply();

        const targetUser = interaction.options.getUser('joueur') || interaction.user;
        const player = await Player.findById(targetUser.id);

        if (!player) {
            return interaction.editReply({ 
                content: `⚠️ Le Chevalier <@${targetUser.id}> n'a pas encore de profil enregistré au Sanctuaire.`
            });
        }

        const stats = player.stats || {};
        const wins = stats.wins || 0;
        const losses = stats.losses || 0;
        const totalMatches = wins + losses;
        const winrate = totalMatches > 0 ? ((wins / totalMatches) * 100).toFixed(1) : '0.0';

        const getCharLabel = (key) => characters.find(c => c.value === key)?.label || key;

        // Top 3 des personnages
        let top3CharsText = '_Aucun combat enregistré_';
        if (stats.charactersPlayed) {
            const charEntries = stats.charactersPlayed instanceof Map 
                ? Array.from(stats.charactersPlayed.entries())
                : Object.entries(stats.charactersPlayed);

            if (charEntries.length > 0) {
                top3CharsText = charEntries
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 3)
                    .map(([charKey, count], index) => {
                        const medal = ['🥇', '🥈', '🥉'][index] || '•';
                        return `${medal} **${getCharLabel(charKey)}** (${count} match${count > 1 ? 's' : ''})`;
                    })
                    .join('\n');
            }
        }

        // Matchups
        let favMatchupText = 'Données insuffisantes';
        let worstMatchupText = 'Données insuffisantes';

        if (stats.characterMatchups) {
            const matchupEntries = stats.characterMatchups instanceof Map 
                ? Array.from(stats.characterMatchups.entries())
                : Object.entries(stats.characterMatchups);

            const oppWins = {};
            const oppLosses = {};

            matchupEntries.forEach(([key, data]) => {
                const parts = key.split('_vs_');
                if (parts.length === 2) {
                    const oppChar = parts[1];
                    oppWins[oppChar] = (oppWins[oppChar] || 0) + (data.wins || 0);
                    oppLosses[oppChar] = (oppLosses[oppChar] || 0) + (data.losses || 0);
                }
            });

            const bestOppChar = Object.entries(oppWins).sort((a, b) => b[1] - a[1])[0];
            if (bestOppChar && bestOppChar[1] > 0) {
                favMatchupText = `**${getCharLabel(bestOppChar[0])}** (${bestOppChar[1]} victoire${bestOppChar[1] > 1 ? 's' : ''})`;
            }

            const worstOppChar = Object.entries(oppLosses).sort((a, b) => b[1] - a[1])[0];
            if (worstOppChar && worstOppChar[1] > 0) {
                worstMatchupText = `**${getCharLabel(worstOppChar[0])}** (${worstOppChar[1]} défaite${worstOppChar[1] > 1 ? 's' : ''})`;
            }
        }

        // Adversaires
        let punchingBagText = 'Aucun pour le moment';
        let biggestWallText = 'Aucun pour le moment';

        if (stats.opponentsCount) {
            const oppEntries = stats.opponentsCount instanceof Map 
                ? Array.from(stats.opponentsCount.entries())
                : Object.entries(stats.opponentsCount);

            if (oppEntries.length > 0) {
                const bestOpponent = [...oppEntries].sort((a, b) => b[1].wins - a[1].wins)[0];
                if (bestOpponent && bestOpponent[1].wins > 0) {
                    punchingBagText = `<@${bestOpponent[0]}> (${bestOpponent[1].wins} victoire${bestOpponent[1].wins > 1 ? 's' : ''})`;
                }

                const worstOpponent = [...oppEntries].sort((a, b) => b[1].losses - a[1].losses)[0];
                if (worstOpponent && worstOpponent[1].losses > 0) {
                    biggestWallText = `<@${worstOpponent[0]}> (${worstOpponent[1].losses} défaite${worstOpponent[1].losses > 1 ? 's' : ''})`;
                }
            }
        }

        const tournamentsPlayed = stats.tournamentsPlayed || 0;
        const tournamentsWon = stats.tournamentsWon || 0;
        const tournamentWinrate = tournamentsPlayed > 0 ? ((tournamentsWon / tournamentsPlayed) * 100).toFixed(0) : '0';

        const profileEmbed = new EmbedBuilder()
            .setTitle(`🏛️ Carte de Visite du Chevalier — ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setColor('#f1c40f')
            .addFields(
                { 
                    name: '⭐ Carrière au Sanctuaire', 
                    value: `🏰 **Guerres Saintes :** ${tournamentsPlayed} (${tournamentsWon} 🏆 | **${tournamentWinrate}%** victoires)\n` +
                        `🎖️ **Titres de MVP :** ${stats.mvpCount || 0}`, 
                    inline: true 
                },
                { 
                    name: '⚔️ Bilan des Duels', 
                    value: `⚔️ **Combats totaux :** ${totalMatches}\n` +
                           `✅ **Victoires :** ${wins} | ❌ **Défaites :** ${losses}\n` +
                           `🔥 **Winrate :** ${winrate}%`, 
                    inline: true 
                },
                { name: '\u200B', value: '\u200B', inline: false },
                { 
                    name: '🥋 Top 3 Persos Utilisés', 
                    value: top3CharsText, 
                    inline: false 
                },
                { 
                    name: '🎯 Matchup Favori', 
                    value: favMatchupText, 
                    inline: true 
                },
                { 
                    name: '⚠️ Pire Matchup', 
                    value: worstMatchupText, 
                    inline: true 
                },
                { name: '\u200B', value: '\u200B', inline: false },
                { 
                    name: '🥊 Sac de Frappe Favori', 
                    value: punchingBagText, 
                    inline: true 
                },
                { 
                    name: '🧱 Plus Grand Mur', 
                    value: biggestWallText, 
                    inline: true 
                }
            )
            .setFooter({ text: 'Chroniques du Sanctuaire' })
            .setTimestamp();

        return interaction.editReply({ embeds: [profileEmbed] });
    }
};