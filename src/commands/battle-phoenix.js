const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const { characters, stages } = require('../utils/data'); 
const { broadcastOverlayData } = require('../utils/overlayServer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-phoenix')
        .setDescription('Déclare le duel de résurrection du Phoenix entre deux Chevaliers éliminés.')
        .addUserOption(option => option.setName('p1').setDescription('Chevalier Éliminé de l’Équipe 1').setRequired(true))
        .addStringOption(option => option.setName('char1').setDescription('Personnage de P1').setRequired(true).setAutocomplete(true))
        .addUserOption(option => option.setName('p2').setDescription('Chevalier Éliminé de l’Équipe 2').setRequired(true))
        .addStringOption(option => option.setName('char2').setDescription('Personnage de P2').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('stage').setDescription('L’arène du combat').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const p1 = interaction.options.getUser('p1');
        const char1 = interaction.options.getString('char1');
        const p2 = interaction.options.getUser('p2');
        const char2 = interaction.options.getString('char2');
        const stage = interaction.options.getString('stage');

        if (p1.id === p2.id) {
            return interaction.reply({ content: "❌ Un Chevalier ne peut pas s'affronter lui-même !", ephemeral: true });
        }

        try {
            const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
            if (!battle) {
                return interaction.reply({ content: "⚠️ Aucune Guerre Sainte n'est active.", ephemeral: true });
            }

            const p1Lives = battle.viesActuelles.get(p1.id.toString()) ?? 0;
            const p2Lives = battle.viesActuelles.get(p2.id.toString()) ?? 0;

            if (p1Lives > 0 || p2Lives > 0) {
                return interaction.reply({ content: "❌ Le duel du Phoenix ne peut opposer que des Chevaliers éliminés (0 vie).", ephemeral: true });
            }

            // --- MISE À JOUR DU CURRENTMATCH ET ENREGISTREMENT ---
            battle.currentMatch = {
                p1: p1.id,
                char1: char1,
                p2: p2.id,
                char2: char2,
                stage: stage,
                isPhoenix: true
            };

            await battle.save();
            await broadcastOverlayData();

            const char1Label = characters.find(c => c.value === char1)?.label || char1;
            const char2Label = characters.find(c => c.value === char2)?.label || char2;
            const stageLabel = stages.find(s => s.value === stage)?.label || stage;

            const matchEmbed = new EmbedBuilder()
                .setTitle('🔥 DUEL DE LA RÉSURRECTION DU PHOENIX 🔥')
                .setDescription(`**Stage :** ${stageLabel}\n\nLes Enfers s'ouvrent. Le gagnant de ce combat brisera ses chaînes et reviendra à la vie avec **1 vie** !`)
                .setColor('#e67e22')
                .addFields(
                    { name: `🔵 ${battle.teams.team1.name}`, value: `<@${p1.id}>\n*${char1Label}*`, inline: true },
                    { name: '⚡ VS ⚡', value: '\u200B', inline: true },
                    { name: `🔴 ${battle.teams.team2.name}`, value: `<@${p2.id}>\n*${char2Label}*`, inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(`phoenix_win_p1_${p1.id}_vs_${p2.id}`)
                    .setLabel(`Triomphe de ${p1.username}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(`phoenix_win_p2_${p2.id}_vs_${p1.id}`)
                    .setLabel(`Triomphe de ${p2.username}`)
                    .setStyle(ButtonStyle.Danger)
            );

            return interaction.reply({ embeds: [matchEmbed], components: [row] });

        } catch (error) {
            console.error(error);
            return interaction.reply({ content: "❌ Erreur lors du lancement du duel de résurrection.", ephemeral: true });
        }
    },
    async autocomplete(interaction) {
        const focusedOption = interaction.options.getFocused(true);
        let choices = [];

        if (focusedOption.name === 'char1' || focusedOption.name === 'char2') {
            choices = characters;
        } else if (focusedOption.name === 'stage') {
            choices = stages;
        }

        const filtered = choices.filter(choice => 
            choice.label.toLowerCase().includes(focusedOption.value.toLowerCase())
        );

        await interaction.respond(
            filtered.slice(0, 25).map(choice => ({ name: choice.label, value: choice.value }))
        );
    }
};