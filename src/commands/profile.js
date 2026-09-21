const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const Player = require('../models/Player');
const { characters } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('profile')
        .setDescription('Affiche la carte de visite et les statistiques d\'un Chevalier.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur dont vous voulez voir le profil (par défaut vous-même)')
                .setRequired(false)),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur') || interaction.user;
        const player = await Player.findById(targetUser.id);

        if (!player) {
            return interaction.reply({ 
                content: `⚠️ Le Chevalier <@${targetUser.id}> n'a pas encore de rang ou de profil enregistré au Sanctuaire.`, 
                ephemeral: true 
            });
        }

        const stats = player.stats || { wins: 0, losses: 0, phoenixCount: 0, charactersPlayed: new Map() };
        const totalMatches = stats.wins + stats.losses;
        const winrate = totalMatches > 0 ? ((stats.wins / totalMatches) * 100).toFixed(1) : '0.0';

        // Trouver le personnage le plus joué
        let mainCharLabel = 'Aucun combat enregistré';
        if (stats.charactersPlayed && stats.charactersPlayed.size > 0) {
            let maxPlayed = 0;
            let mainCharKey = '';
            
            stats.charactersPlayed.forEach((count, charKey) => {
                if (count > maxPlayed) {
                    maxPlayed = count;
                    mainCharKey = charKey;
                }
            });

            const charObj = characters.find(c => c.value === mainCharKey);
            mainCharLabel = charObj ? `${charObj.label} (${maxPlayed} matchs)` : `${mainCharKey} (${maxPlayed} matchs)`;
        }

        const profileEmbed = new EmbedBuilder()
            .setTitle(`🏛️ Profil du Chevalier — ${targetUser.username}`)
            .setThumbnail(targetUser.displayAvatarURL({ dynamic: true }))
            .setColor('#f1c40f')
            .addFields(
                { name: '⭐ Rang / Niveau', value: `Niveau **${player.level}**`, inline: true },
                { name: '📊 Ratio de Victoire', value: `**${winrate}%** (${stats.wins}V / ${stats.losses}D)`, inline: true },
                { name: '🔥 Miracles du Phoenix', value: `**${stats.phoenixCount}** résurrections`, inline: true },
                { name: '🥊 Guerrier Favori', value: mainCharLabel, inline: false },
                { name: '⚔️ Combats Totaux', value: `**${totalMatches}** affrontements au Sanctuaire`, inline: false }
            )
            .setFooter({ text: 'Chroniques du Sanctuaire' })
            .setTimestamp();

        return interaction.reply({ embeds: [profileEmbed] });
    }
};