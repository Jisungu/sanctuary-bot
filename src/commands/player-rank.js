const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Player = require('../models/Player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player-rank')
        .setDescription('Définit le niveau d\'un joueur pour l\'équilibrage.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur à évaluer')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('niveau')
                .setDescription('Choisir le niveau du joueur')
                .setRequired(true)
                .addChoices(
                    { name: '1 - Débutant', value: 1 },
                    { name: '2 - Intermédiaire', value: 2 },
                    { name: '3 - Confirmé', value: 3 },
                    { name: '4 - Expert', value: 4 },
                    { name: '5 - Maître', value: 5 },
                ))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur');
        const levelValue = interaction.options.getInteger('niveau');

        const levelNames = {
            1: "Débutant",
            2: "Intermédiaire",
            3: "Confirmé",
            4: "Expert",
            5: "Maître"
        };

        try {
            await Player.findOneAndUpdate(
                { _id: targetUser.id },
                { 
                    username: targetUser.username, 
                    level: levelValue 
                }, 
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            return interaction.reply({
                content: `✅ **${targetUser.username}** est maintenant classé **${levelNames[levelValue]}** (Niveau ${levelValue}).`,
                ephemeral: true
            });

        } catch (error) {
            console.error(error);
            return interaction.reply({
                content: "⚠️ Impossible de mettre à jour le niveau dans la base de données.",
                ephemeral: true
            });
        }
    },
};