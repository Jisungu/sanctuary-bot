const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player-assign-role')
        .setDescription('Crée et assigne le rôle TeamBattle aux participants de la session en cours.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        // 1. Récupération de la battle active (statut différent de 'finished')
        const activeBattle = await Battle.findOne({
            guildId: interaction.guildId,
            status: { $ne: 'finished' }
        }).sort({ createdAt: -1 });

        if (!activeBattle || !activeBattle.participants || activeBattle.participants.length === 0) {
            return interaction.editReply({
                content: "❌ Aucune Team Battle active avec des participants n'a été trouvée."
            });
        }

        const guild = interaction.guild;
        const roleName = 'TeamBattle';

        try {
            // 2. Recherche ou création du rôle
            let role = guild.roles.cache.find(r => r.name === roleName);

            if (!role) {
                role = await guild.roles.create({
                    name: roleName,
                    color: '#e67e22',
                    reason: 'Rôle automatique pour les participants de la Team Battle'
                });
            }

            // 3. Attribution du rôle aux participants
            let addedCount = 0;
            let errorCount = 0;

            for (const memberId of activeBattle.participants) {
                try {
                    const member = await guild.members.fetch(memberId);
                    if (member && !member.roles.cache.has(role.id)) {
                        await member.roles.add(role);
                        addedCount++;
                    }
                } catch (err) {
                    // Membre parti du serveur ou ID introuvable
                    errorCount++;
                }
            }

            return interaction.editReply({
                content: `✅ **Rôle ${role} attribué avec succès !**\n\n` +
                         `• **Nouveaux assignés :** ${addedCount}\n` +
                         `• **Total participants ciblés :** ${activeBattle.participants.length}` +
                         (errorCount > 0 ? `\n⚠️ *${errorCount} membre(s) introuvable(s) sur le serveur.*` : '')
            });

        } catch (error) {
            console.error('Erreur lors de l\'attribution du rôle TeamBattle :', error);
            return interaction.editReply({
                content: "❌ Une erreur est survenue lors de la gestion du rôle. Vérifie que le bot possède la permission **Gérer les rôles** et que son rôle est placé au-dessus de **TeamBattle** dans la hiérarchie."
            });
        }
    }
};