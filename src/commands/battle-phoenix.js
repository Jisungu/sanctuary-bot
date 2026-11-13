const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const { characters } = require('../utils/data');
const { broadcastOverlayData, toggleSwapSides } = require('../utils/overlayServer');
const { getPhoenixLaunchError } = require('../utils/phoenix');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-phoenix')
        .setDescription('Déclare le duel du Phénix d’une équipe en retard contre un adversaire.')
        .addStringOption(option => option.setName('equipe')
            .setDescription('Équipe qui déclenche le duel')
            .setRequired(true)
            .addChoices(
                { name: 'Équipe 1', value: 'team1' },
                { name: 'Équipe 2', value: 'team2' }
            ))
        .addUserOption(option => option.setName('joueur').setDescription('Joueur éliminé à ressusciter dans l’équipe choisie').setRequired(true))
        .addUserOption(option => option.setName('adversaire').setDescription('Adversaire de l’équipe opposée (éliminé ou en lice)').setRequired(true))
        .addStringOption(option => option.setName('personnage_joueur').setDescription('Personnage du joueur à ressusciter').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('personnage_adversaire').setDescription('Personnage de l’adversaire').setRequired(true).setAutocomplete(true))
        .addBooleanOption(option => option.setName('swap').setDescription('Inverser l\'affichage de l\'overlay ?').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const shouldSwap = interaction.options.getBoolean('swap');
        const phoenixTeam = interaction.options.getString('equipe');
        const phoenixPlayer = interaction.options.getUser('joueur');
        const opponent = interaction.options.getUser('adversaire');
        const phoenixChar = interaction.options.getString('personnage_joueur');
        const opponentChar = interaction.options.getString('personnage_adversaire');

        try {
            const battle = await Battle.findOne({ guildId: interaction.guildId, status: 'started' }).sort({ createdAt: -1 });
            if (!battle) {
                return interaction.reply({ content: "⚠️ Aucune Guerre Sainte n'est active.", ephemeral: true });
            }

            const launchError = getPhoenixLaunchError(battle, phoenixTeam, phoenixPlayer.id, opponent.id);
            if (launchError) {
                return interaction.reply({ content: `❌ ${launchError}`, ephemeral: true });
            }

            const isTeam1Initiator = phoenixTeam === 'team1';
            const p1 = isTeam1Initiator ? phoenixPlayer : opponent;
            const char1 = isTeam1Initiator ? phoenixChar : opponentChar;
            const p2 = isTeam1Initiator ? opponent : phoenixPlayer;
            const char2 = isTeam1Initiator ? opponentChar : phoenixChar;
            const phoenixTeamName = battle.teams[phoenixTeam].name;
            let swapStatusText = '';
            if (shouldSwap) {
                const isSwapped = toggleSwapSides();
                swapStatusText = `\n\n🔄 *Overlay inversé : ${isSwapped ? 'Équipe 2 à gauche' : 'Équipe 1 à gauche'}*`;
            }

            battle.currentMatch = {
                p1: p1.id,
                p2: p2.id,
                char1,
                char2: char2,
                isPhoenix: true,
                phoenixTeam
            };

            await battle.save();
            await broadcastOverlayData();

            const char1Label = characters.find(c => c.value === char1)?.label || char1;
            const char2Label = characters.find(c => c.value === char2)?.label || char2;

            const matchEmbed = new EmbedBuilder()
                .setTitle('🔥 DUEL DE LA RÉSURRECTION DU PHOENIX 🔥')
                .setDescription(
                    `L’équipe **${phoenixTeamName}** déclenche son duel du Phénix.\n\n` +
                    `Les Enfers s'ouvrent. Le joueur éliminé choisi devra vaincre son adversaire pour revenir dans la bataille avec **1 vie**.${swapStatusText}`
                )
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
        const query = (focusedOption.value || '').toLowerCase();

        const filtered = characters.filter(choice => 
            choice.label.toLowerCase().includes(query) || 
            choice.value.toLowerCase().includes(query)
        );

        await interaction.respond(
            filtered.slice(0, 25).map(choice => ({ name: choice.label, value: choice.value }))
        );
    }
};