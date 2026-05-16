const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-check')
        .setDescription('Lance la phase d\'appel pour le sondage en cours.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
       const battle = await Battle.findOne({ 
            guildId: interaction.guildId, 
            status: 'registration' 
        }).sort({ createdAt: -1 });

        if (!battle || battle.participants.length < 1) {
            return interaction.reply({ 
                content: "❌ Aucun sondage d'inscription actif ou aucun inscrit trouvé.", 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        battle.status = 'calling';
        await battle.save();

        const embedAppel = new EmbedBuilder()
            .setTitle('📢 L\'Appel d\'Athéna')
            .setDescription('Le temps des préparatifs est révolu. Manifestez votre présence avant que l\'Horloge du Sanctuaire ne s\'embrase !')
            .setColor('#e74c3c')
            .addFields(
                { name: 'Guerriers attendus', value: battle.participants.map(id => `<@${id}>`).join('\n') },
                { name: `Présents (${battle.presents.length}/${battle.participants.length})`, value: 'En attente de confirmation...' }
            );

        const rowAppel = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('confirm_presence')
                .setLabel('Prêter Serment')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('force_presence')
                .setLabel('Décret du Grand Pope (Admin)')
                .setStyle(ButtonStyle.Danger)
        );

        const response = await interaction.reply({ 
            embeds: [embedAppel], 
            components: [rowAppel],
            fetchReply: true 
        });

        battle.messageId = response.id;
        await battle.save();
    },
};