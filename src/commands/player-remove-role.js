const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('player-remove-role')
        .setDescription('Retire le rôle TeamBattle à tous les membres qui le possèdent.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        const guild = interaction.guild;
        const roleName = 'TeamBattle';

        // 1. Recherche du rôle dans la guilde
        const role = guild.roles.cache.find(r => r.name === roleName);

        if (!role) {
            return interaction.editReply({
                content: `❌ Le rôle **${roleName}** n'existe pas sur ce serveur.`
            });
        }

        try {
            // Force la récupération de tous les membres du serveur pour éviter les caches incomplets
            await guild.members.fetch();

            const membersWithRole = role.members;

            if (membersWithRole.size === 0) {
                return interaction.editReply({
                    content: `ℹ️ Aucun membre ne possède actuellement le rôle ${role}.`
                });
            }

            let removedCount = 0;
            let errorCount = 0;

            // 2. Retrait du rôle à chaque membre concerné
            for (const [memberId, member] of membersWithRole) {
                try {
                    await member.roles.remove(role);
                    removedCount++;
                } catch (err) {
                    errorCount++;
                }
            }

            return interaction.editReply({
                content: `✅ **Rôle ${role} retiré avec succès !**\n\n` +
                         `• **Membres libérés :** ${removedCount}` +
                         (errorCount > 0 ? `\n⚠️ *${errorCount} erreur(s) lors du retrait.*` : '')
            });

        } catch (error) {
            console.error('Erreur lors du retrait du rôle TeamBattle :', error);
            return interaction.editReply({
                content: "❌ Une erreur est survenue lors de la suppression des rôles."
            });
        }
    }
};