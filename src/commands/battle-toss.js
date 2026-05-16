const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-toss')
        .setDescription('L\'Horloge du Sanctuaire désigne quelle équipe envoie son chevalier en premier.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const battle = await Battle.findOne({ 
            guildId: interaction.guildId, 
            status: 'started' 
        }).sort({ createdAt: -1 });

        if (!battle) {
            return interaction.reply({ 
                content: "⚠️ **Par Athéna !** Aucune bataille n'est actuellement en cours. Utilise `/battle-run` pour embraser ton Cosmos.", 
                ephemeral: true 
            });
        }

        const team1 = battle.teams.team1.name;
        const team2 = battle.teams.team2.name;

        const isTeam1 = Math.random() < 0.5;
        const designatedTeam = isTeam1 ? team1 : team2;
        const secondTeam = isTeam1 ? team2 : team1;

        const tossEmbed = new EmbedBuilder()
            .setTitle('🔥 L\'Horloge du Sanctuaire s\'éveille !')
            .setDescription('Les flammes s\'éteignent une à une... Le destin a tranché !')
            .setColor('#f1c40f') // Or
            .setThumbnail('https://smallthings.fr/wp-content/uploads/2019/09/cdz_saint_seiya_horloge.jpg')
            .addFields(
                { 
                    name: '📜 Décret du Grand Pope', 
                    value: `C'est l'équipe **${designatedTeam}** qui doit envoyer son premier Chevalier dans l'arène !` 
                },
                { 
                    name: '⚖️ Avantage Stratégique', 
                    value: `L'équipe **${secondTeam}** bénéficie du contre-choix pour ce premier duel.` 
                }
            )
            .setFooter({ text: 'Que le Cosmos vous guide vers la victoire.' })
            .setTimestamp();

        return interaction.reply({ embeds: [tossEmbed] });
    },
};