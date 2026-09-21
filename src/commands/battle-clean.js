const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-clean')
        .setDescription('Supprime manuellement les salons vocaux de la dernière bataille terminée.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const battle = await Battle.findOne({ 
            guildId: interaction.guildId, 
            status: 'finished' 
        }).sort({ createdAt: -1 });

        if (!battle) {
            return interaction.reply({ content: "⚠️ Aucune bataille terminée récente trouvée.", ephemeral: true });
        }

        const v1Id = battle.teams?.team1?.voiceChannelId;
        const v2Id = battle.teams?.team2?.voiceChannelId;

        let deletedCount = 0;
        if (v1Id) {
            await interaction.guild.channels.delete(v1Id).catch(() => null);
            deletedCount++;
        }
        if (v2Id) {
            await interaction.guild.channels.delete(v2Id).catch(() => null);
            deletedCount++;
        }

        if (deletedCount === 0) {
            return interaction.reply({ content: "⚠️ Aucun salon vocal associé n'a été trouvé.", ephemeral: true });
        }

        return interaction.reply({ content: `🧹 **${deletedCount}** salon(s) vocal(ux) supprimé(s) avec succès.`, ephemeral: false });
    }
};