const { SlashCommandBuilder, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const Player = require('../models/Player');
const { characters } = require('../utils/data');
const { broadcastOverlayData, toggleSwapSides } = require('../utils/overlayServer');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-match')
        .setDescription('Annonce le prochain duel de la Guerre Sainte.')
        .addStringOption(option => option.setName('p1').setDescription('Chevalier de la Team 1').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('char1').setDescription('Personnage du P1').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('p2').setDescription('Chevalier de la Team 2').setRequired(true).setAutocomplete(true))
        .addStringOption(option => option.setName('char2').setDescription('Personnage du P2').setRequired(true).setAutocomplete(true))
        .addBooleanOption(option => option.setName('swap').setDescription('Inverser l\'affichage de l\'overlay ?').setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async autocomplete(interaction) {
        try {
            const focusedOption = interaction.options.getFocused(true);

            // GESTION DU FILTRAGE DE P1 ET P2 SELON LEUR ÉQUIPE
            if (focusedOption.name === 'p1' || focusedOption.name === 'p2') {
                const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
                if (!battle) return interaction.respond([]);

                const teamPlayerIds = focusedOption.name === 'p1' 
                    ? (battle.teams?.team1?.players || []) 
                    : (battle.teams?.team2?.players || []);

                const choices = [];
                for (const userId of teamPlayerIds) {
                    const member = await interaction.guild.members.fetch(userId).catch(() => null);
                    if (member) {
                        choices.push({
                            label: member.displayName,
                            value: member.id
                        });
                    }
                }

                const filtered = choices.filter(choice => 
                    choice.label.toLowerCase().includes(focusedOption.value.toLowerCase())
                ).slice(0, 25);

                return interaction.respond(filtered.map(c => ({ name: c.label, value: c.value })));
            }

            // GESTION DES PERSONNAGES (char1 / char2) AVEC SUGGESTION DU PLUS JOUÉ
            if (focusedOption.name === 'char1' || focusedOption.name === 'char2') {
                const query = focusedOption.value.toLowerCase();
                const targetPlayerId = focusedOption.name === 'char1' 
                    ? interaction.options.getString('p1') 
                    : interaction.options.getString('p2');

                let topCharValue = null;

                if (targetPlayerId) {
                    const playerData = await Player.findById(targetPlayerId);
                    if (playerData?.stats?.charactersPlayed) {
                        const charEntries = playerData.stats.charactersPlayed instanceof Map 
                            ? Array.from(playerData.stats.charactersPlayed.entries())
                            : Object.entries(playerData.stats.charactersPlayed);

                        if (charEntries.length > 0) {
                            topCharValue = charEntries.sort((a, b) => b[1] - a[1])[0][0];
                        }
                    }
                }

                let filtered = characters.filter(choice => 
                    choice.label.toLowerCase().includes(query) || choice.value.toLowerCase().includes(query)
                );

                // Si le joueur a un perso favori, on le place en tout premier avec une étoile
                if (topCharValue) {
                    const topCharIndex = filtered.findIndex(c => c.value === topCharValue);
                    if (topCharIndex !== -1) {
                        const [topChar] = filtered.splice(topCharIndex, 1);
                        filtered.unshift({
                            label: `⭐ ${topChar.label} (Plus joué)`,
                            value: topChar.value
                        });
                    }
                }

                return interaction.respond(
                    filtered.slice(0, 25).map(c => ({ name: c.label, value: c.value }))
                );
            }

        } catch (err) { 
            console.error("Erreur Autocomplete:", err); 
        }
    },

    async execute(interaction) {
        await interaction.deferReply();

        const shouldSwap = interaction.options.getBoolean('swap');
        let swapStatusText = '';
        if (shouldSwap) {
            const isSwapped = toggleSwapSides();
            swapStatusText = `\n🔄 *Overlay inversé : ${isSwapped ? 'Équipe 2 à gauche' : 'Équipe 1 à gauche'}*`;
        }

        const p1Id = interaction.options.getString('p1');
        const p2Id = interaction.options.getString('p2');

        const p1User = await interaction.client.users.fetch(p1Id).catch(() => null);
        const p2User = await interaction.client.users.fetch(p2Id).catch(() => null);

        if (!p1User || !p2User) {
            return interaction.editReply("❌ L'un des membres choisis n'a pas pu être récupéré.");
        }

        const getTechValue = (input, list) => {
            const found = list.find(item => item.value === input || item.label === input);
            return found ? found.value : input.toLowerCase().replace(/\s+/g, '_');
        };

        const char1Value = getTechValue(interaction.options.getString('char1'), characters);
        const char2Value = getTechValue(interaction.options.getString('char2'), characters);

        try {
            const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
            if (!battle) return interaction.editReply("⚠️ Aucune Guerre Sainte en cours.");

            battle.currentMatch = {
                p1: p1User.id,
                p2: p2User.id,
                char1: char1Value,
                char2: char2Value,
                isPhoenix: false
            };
            await battle.save();
            await broadcastOverlayData();
            
            const char1Label = characters.find(c => c.value === char1Value)?.label || char1Value;
            const char2Label = characters.find(c => c.value === char2Value)?.label || char2Value;

            const matchEmbed = new EmbedBuilder()
                .setTitle('⚔️ Choc de Cosmos dans l\'Arène')
                .setDescription(swapStatusText ? swapStatusText.trim() : null)
                .setColor('#e67e22')
                .addFields(
                    { name: `🔵 ${battle.teams.team1.name}`, value: `<@${p1User.id}>\n**${char1Label}**`, inline: true },
                    { name: `VS`, value: `🔱`, inline: true },
                    { name: `🔴 ${battle.teams.team2.name}`, value: `<@${p2User.id}>\n**${char2Label}**`, inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder().setCustomId('win_p1').setLabel(`Triomphe de ${p1User.username}`).setStyle(ButtonStyle.Primary),
                new ButtonBuilder().setCustomId('win_p2').setLabel(`Triomphe de ${p2User.username}`).setStyle(ButtonStyle.Danger)
            );

            await interaction.editReply({ embeds: [matchEmbed], components: [row] });
        } catch (error) {
            console.error(error);
            return interaction.editReply("❌ Erreur lors du lancement du match.");
        }
    },
};