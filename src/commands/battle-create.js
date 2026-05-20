const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-create')
        .setDescription('Planifie la Guerre Sainte et ouvre les inscriptions publiques.')
        .addStringOption(option => 
            option.setName('date')
                .setDescription('Format: JJ/MM/AAAA (ex: 15/05/2026)')
                .setRequired(true))
        .addStringOption(option => 
            option.setName('heure')
                .setDescription('Format: HH:mm (ex: 21:00)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const dateStr = interaction.options.getString('date');
        const heureTournoi = interaction.options.getString('heure');

        const lastBattle = await Battle.findOne({ 
            guildId: interaction.guildId 
        }).sort({ createdAt: -1 });

        if (lastBattle && (lastBattle.status === 'registration' || lastBattle.status === 'calling' || lastBattle.status === 'started')) {
            return interaction.reply({ 
                content: "⚠️ **Par le Bouclier d'Athéna !** Une Guerre Sainte est déjà en préparation ou en cours. Terminez-la avant d'en invoquer une nouvelle.", 
                ephemeral: true 
            });
        }

        const embed = new EmbedBuilder()
            .setTitle('🌌 Prophétie de Guerre Sainte')
            .setDescription(`Les astres annoncent un conflit imminent au pied des Douze Maisons !\n\n📅 **Date :** ${dateStr}\n⏳ **Heure :** ${heureTournoi}\n\nChevaliers, manifestez votre Cosmos pour protéger votre Sanctuaire !`)
            .setColor('#f1c40f')
            .setThumbnail('https://smallthings.fr/wp-content/uploads/2019/09/cdz_saint_seiya_horloge.jpg')
            .addFields({
                name: `📜 Chevaliers Inscrits (0)`,
                value: '_Aucun guerrier n\'a encore répondu à l\'appel d\'Athéna._'
            })
            .setFooter({ text: 'Seuls ceux qui prêteront serment pourront revêtir leur armure.' })
            .setTimestamp();

        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('join_battle')
                .setLabel('Répondre à l\'appel')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('leave_battle')
                .setLabel('Déposer les armes')
                .setStyle(ButtonStyle.Danger)
        );

        const response = await interaction.reply({ 
            embeds: [embed], 
            components: [row], 
            fetchReply: true 
        });

        try {
            await Battle.create({
                guildId: interaction.guildId,
                channelId: interaction.channelId,
                messageId: response.id,
                dateTournoi: dateStr,
                heureTournoi: heureTournoi,
                status: 'registration',
                participants: [],
                presents: [],
                history: []
            });
        } catch (error) {
            console.error("Erreur création Battle DB:", error);
            await interaction.followUp({ 
                content: "❌ Une erreur dimensionnelle a empêché l'enregistrement du tournoi.", 
                ephemeral: true 
            });
        }
    },
};