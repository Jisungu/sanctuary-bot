const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-clean')
        .setDescription('Supprime les salons et rôles des Team Battles terminées.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: true });

        try {
            const activeBattle = await Battle.exists({
                guildId: interaction.guildId,
                status: { $in: ['registration', 'calling', 'started'] }
            });
            if (activeBattle) {
                return interaction.editReply('⚠️ Terminez ou annulez la Team Battle en cours avant de lancer le nettoyage.');
            }

            const previousBattles = await Battle.find({
                guildId: interaction.guildId,
                status: 'finished'
            }).select('teams').lean();
            const roles = await interaction.guild.roles.fetch();
            const teamBattleRole = roles.find(role => role.name === 'TeamBattle');
            const failedActions = [];
            let removedTeamBattleAssignments = 0;

            if (teamBattleRole) {
                const members = await interaction.guild.members.fetch();
                const holders = members.filter(member =>
                    !member.user.bot && member.roles.cache.has(teamBattleRole.id)
                );

                for (const member of holders.values()) {
                    try {
                        await member.roles.remove(teamBattleRole, 'Nettoyage des rôles Team Battle terminées');
                        removedTeamBattleAssignments++;
                    } catch (error) {
                        console.error(`Impossible de retirer TeamBattle à ${member.id} :`, error);
                        failedActions.push(`Retrait de TeamBattle à ${member.user.tag || member.id}`);
                    }
                }
            }

            const teamRoleIds = new Set();
            const legacyTeamRoleNames = new Set();
            const voiceChannelIds = new Set();
            for (const battle of previousBattles) {
                for (const teamKey of ['team1', 'team2']) {
                    const team = battle.teams?.[teamKey];
                    if (!team) continue;

                    if (team.roleId) {
                        if (team.roleId !== teamBattleRole?.id) teamRoleIds.add(team.roleId);
                    } else if (team.name && team.name.toLowerCase() !== 'teambattle') {
                        legacyTeamRoleNames.add(team.name.toLowerCase());
                    }
                    if (team.voiceChannelId) voiceChannelIds.add(team.voiceChannelId);
                }
            }

            const teamRoles = new Map();
            for (const roleId of teamRoleIds) {
                const role = roles.get(roleId);
                if (role && role.id !== interaction.guild.id && !role.managed) teamRoles.set(role.id, role);
            }
            for (const roleName of legacyTeamRoleNames) {
                const role = roles.find(candidate =>
                    candidate.name.toLowerCase() === roleName
                    && candidate.id !== interaction.guild.id
                    && candidate.id !== teamBattleRole?.id
                    && !candidate.managed
                );
                if (role) teamRoles.set(role.id, role);
            }

            let deletedRoles = 0;
            for (const role of teamRoles.values()) {
                try {
                    await role.delete('Nettoyage des rôles de Team Battles terminées');
                    deletedRoles++;
                } catch (error) {
                    console.error(`Impossible de supprimer le rôle Team Battle ${role.id} :`, error);
                    failedActions.push(`Suppression du rôle ${role.name}`);
                }
            }

            let deletedChannels = 0;
            for (const channelId of voiceChannelIds) {
                try {
                    const channel = await interaction.guild.channels.fetch(channelId);
                    if (!channel) continue;
                    if (channel.type !== ChannelType.GuildVoice) {
                        failedActions.push(`Salon ${channelId} ignoré (ce n’est pas un salon vocal)`);
                        continue;
                    }
                    await channel.delete('Nettoyage des salons de Team Battles terminées');
                    deletedChannels++;
                } catch (error) {
                    if (error.code === 10003) continue;
                    console.error(`Impossible de supprimer le salon Team Battle ${channelId} :`, error);
                    failedActions.push(`Suppression du salon ${channelId}`);
                }
            }

            const teamBattleRoleSummary = teamBattleRole
                ? `Rôle **TeamBattle** retiré à **${removedTeamBattleAssignments}** joueur(s).`
                : 'Le rôle **TeamBattle** est introuvable.';
            const failureSummary = failedActions.length
                ? `\n\n⚠️ **${failedActions.length}** opération(s) ont échoué ou ont été ignorées :\n${failedActions.slice(0, 8).map(action => `• ${action}`).join('\n')}`
                : '';

            return interaction.editReply(
                `🧹 Nettoyage terminé pour **${previousBattles.length}** Team Battle(s) terminée(s).\n` +
                `• Salons vocaux supprimés : **${deletedChannels}**\n` +
                `• Rôles d’équipe supprimés : **${deletedRoles}**\n` +
                `• ${teamBattleRoleSummary}${failureSummary}`
            );
        } catch (error) {
            console.error('Erreur lors du nettoyage des Team Battles :', error);
            return interaction.editReply('❌ Le nettoyage n’a pas pu être terminé. Vérifiez les permissions du bot, l’intent Server Members et les journaux.');
        }
    }
};