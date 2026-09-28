const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Battle = require('../models/Battle');
const { broadcastOverlayData } = require('../utils/overlayServer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-checkin')
        .setDescription('Lance la phase d\'appel pour le sondage en cours.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        // 1. Recherche du sondage d'inscription en cours
        const battle = await Battle.findOne({ 
            guildId: interaction.guildId, 
            status: 'registration' 
        }).sort({ createdAt: -1 });

        if (!battle || !battle.participants || battle.participants.length < 1) {
            return interaction.reply({ 
                content: "❌ Aucun sondage d'inscription actif ou aucun inscrit trouvé.", 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        // 2. Passage au statut 'calling'
        battle.status = 'calling';

        const embedAppel = new EmbedBuilder()
            .setTitle('📢 L\'Appel d\'Athéna')
            .setDescription('Le temps des préparatifs est révolu. Manifestez votre présence avant que l\'Horloge du Sanctuaire ne s\'embrase !\n\n⚠️ **Seuls les Chevaliers inscrits au préalable peuvent prêter serment.**')
            .setColor('#e74c3c')
            .addFields(
                { 
                    name: 'Guerriers attendus', 
                    value: battle.participants.map(id => `<@${id}>`).join('\n') 
                },
                { 
                    name: `Présents (${battle.presents.length}/${battle.participants.length})`, 
                    value: battle.presents.length > 0 
                        ? battle.presents.map(id => `<@${id}>`).join('\n') 
                        : 'En attente de confirmation...' 
                }
            )
            .setTimestamp();

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

        // 3. Envoi du message d'appel
        const response = await interaction.reply({ 
            embeds: [embedAppel], 
            components: [rowAppel],
            fetchReply: true 
        });

        // 4. Enregistrement de l'ID du message et de l'ID du salon dans la BDD
        battle.channelId = interaction.channelId;
        battle.messageId = response.id;
        await battle.save();
        await broadcastOverlayData();
    },
};