const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { toggleSwapSides } = require('../utils/overlayServer');
module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-swap')
        .setDescription('Inverse l\'affichage visuel de l\'overlay')
        .setDefaultMemberPermissions(PermissionFlagsBits.ManageEvents),

    async execute(interaction) {
        // Appelle le toggle dans le serveur WebSocket
        const currentState = toggleSwapSides();

        const stateMessage = currentState 
            ? 'Inversé (Équipe 2 à gauche)' 
            : 'Normal (Équipe 1 à gauche)';

        return interaction.reply({ 
            content: `🔄 L'affichage HUD a été mis à jour : **${stateMessage}**.`,
            ephemeral: true 
        });
    }
};