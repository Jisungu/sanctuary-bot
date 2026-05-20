const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const { characters, stages } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-match')
        .setDescription('Annonce le prochain duel de la Guerre Sainte.')
        .addUserOption(option => option.setName('p1').setDescription('Chevalier de la Team 1').setRequired(true))
        .addStringOption(option => option.setName('char1').setDescription('Personnage du P1').setRequired(true).setAutocomplete(true))
        .addUserOption(option => option.setName('p2').setDescription('Chevalier de la Team 2').setRequired(true))
        .addStringOption(option => option.setName('char2').setDescription('Personnage du P2').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('stage').setDescription('Stage du combat').setRequired(true).setAutocomplete(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        try {
            const focusedOption = interaction.options.getFocused(true);
            let choices = (focusedOption.name === 'stage') ? stages : characters;

            const filtered = choices.filter(choice => 
                choice.label.toLowerCase().includes(focusedOption.value.toLowerCase())
            ).slice(0, 25);

            await interaction.respond(filtered.map(c => ({ name: c.label, value: c.value })));
        } catch (err) { console.error("Erreur Autocomplete:", err); }
    },

    async execute(interaction) {
        await interaction.deferReply();

        const p1 = interaction.options.getUser('p1');
        const p2 = interaction.options.getUser('p2');
        
        const getTechValue = (input, list) => {
            const found = list.find(item => item.value === input || item.label === input);
            return found ? found.value : input.toLowerCase().replace(/\s+/g, '_');
        };

        const char1Value = getTechValue(interaction.options.getString('char1'), characters);
        const char2Value = getTechValue(interaction.options.getString('char2'), characters);
        const stageValue = getTechValue(interaction.options.getString('stage'), stages);

        try {
            const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
            if (!battle) return interaction.editReply("⚠️ Aucune Guerre Sainte en cours.");

            battle.currentMatch = {
                p1: p1.id,
                p2: p2.id,
                char1: char1Value,
                char2: char2Value,
                stage: stageValue
            };
            await battle.save();
            
            const char1Label = characters.find(c => c.value === char1Value)?.label || char1Value;
            const char2Label = characters.find(c => c.value === char2Value)?.label || char2Value;
            const stageLabel = stages.find(s => s.value === stageValue)?.label || stageValue;

            const matchEmbed = new EmbedBuilder()
                .setTitle('⚔️ Choc de Cosmos dans l\'Arène')
                .setDescription(`Le duel se déroulera sur : **${stageLabel}**`)
                .setColor('#e67e22')
                .addFields(
                    { name: `🔵 ${battle.teams.team1.name}`, value: `<@${p1.id}>\n**${char1Label}**`, inline: true },
                    { name: `VS`, value: `🔱`, inline: true },
                    { name: `🔴 ${battle.teams.team2.name}`, value: `<@${p2.id}>\n**${char2Label}**`, inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('win_p1').setLabel(`Triomphe de ${p1.username}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('win_p2').setLabel(`Triomphe de ${p2.username}`).setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [matchEmbed], components: [row] });
        } catch (error) {
            console.error(error);
            return interaction.editReply("❌ Erreur lors du lancement du match.");
        }
    },
};