const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { broadcastOverlayData } = require('../utils/overlayServer');
const Player = require('../models/Player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player-username')
        .setDescription('Définit ou met à jour le pseudo/nom d\'un joueur dans la base de données.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur dont vous voulez modifier le pseudo')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('pseudo')
                .setDescription('Le nouveau pseudo à attribuer au joueur')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur');
        const newUsername = interaction.options.getString('pseudo');

        try {
            // Recherche le joueur pour s'assurer qu'il existe déjà
            const player = await Player.findById(targetUser.id);

            if (!player) {
                return interaction.reply({
                    content: `⚠️ Le Chevalier <@${targetUser.id}> n'a pas encore de profil. Utilisez d'abord \`/player-rank\` pour l'enregistrer.`,
                    ephemeral: true
                });
            }

            // Mise à jour du pseudo
            player.username = newUsername;
            await player.save();
            await broadcastOverlayData();

            return interaction.reply({
                content: `✅ Le pseudo du Chevalier <@${targetUser.id}> a été mis à jour avec succès : **${newUsername}**.`,
                ephemeral: true
            });

        } catch (error) {
            console.error("Erreur lors de la mise à jour du pseudo :", error);
            return interaction.reply({
                content: "⚠️ Une erreur est survenue lors de la mise à jour du pseudo dans la base de données.",
                ephemeral: true
            });
        }
    },
};