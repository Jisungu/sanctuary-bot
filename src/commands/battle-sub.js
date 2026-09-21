const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-sub')
        .setDescription('Remplace un joueur par un remplaçant au cours d\'une bataille active.')
        .addUserOption(option => 
            option.setName('ancien')
                .setDescription('Le joueur sortant à remplacer')
                .setRequired(true))
        .addUserOption(option => 
            option.setName('nouveau')
                .setDescription('Le joueur entrant (remplaçant)')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const oldPlayer = interaction.options.getUser('ancien');
        const newPlayer = interaction.options.getUser('nouveau');

        try {
            const battle = await Battle.findOne({ 
                guildId: interaction.guildId, 
                status: 'started' 
            }).sort({ createdAt: -1 });

            if (!battle) {
                return interaction.editReply("⚠️ Aucune bataille active à modifier.");
            }

            const oldId = oldPlayer.id;
            const newId = newPlayer.id;

            // Vérifier si l'ancien joueur est dans une équipe
            const isT1 = battle.teams.team1.players.includes(oldId);
            const isT2 = battle.teams.team2.players.includes(oldId);

            if (!isT1 && !isT2) {
                return interaction.editReply(`⚠️ <@${oldId}> ne fait pas partie des équipes actives de cette bataille.`);
            }

            // Récupérer les vies actuelles
            const currentLives = battle.viesActuelles.get(oldId) ?? battle.viesParJoueur;

            // Mettre à jour l'équipe concernée
            if (isT1) {
                battle.teams.team1.players = battle.teams.team1.players.map(id => id === oldId ? newId : id);
            } else {
                battle.teams.team2.players = battle.teams.team2.players.map(id => id === oldId ? newId : id);
            }

            // Mettre à jour la liste globale des présents et transférer les vies
            battle.presents = battle.presents.map(id => id === oldId ? newId : id);
            battle.viesActuelles.delete(oldId);
            battle.viesActuelles.set(newId, currentLives);

            // Si un match est en cours avec l'ancien joueur, on met à jour
            if (battle.currentMatch) {
                if (battle.currentMatch.p1 === oldId) battle.currentMatch.p1 = newId;
                if (battle.currentMatch.p2 === oldId) battle.currentMatch.p2 = newId;
            }

            battle.markModified('teams');
            battle.markModified('viesActuelles');
            await battle.save();

            const subEmbed = new EmbedBuilder()
                .setTitle('🔄 Remplacement de Chevalier')
                .setColor('#2ecc71')
                .setDescription(
                    `**Le Grand Pope a autorisé une substitution au sein des rangs !**\n\n` +
                    `🚪 **Joueur sortant :** <@${oldId}>\n` +
                    `⚔️ **Joueur entrant :** <@${newId}>\n\n` +
                    `❤️ **Cosmos hérité :** Le remplaçant reprend le combat avec **${currentLives}/${battle.viesParJoueur}** éclat(s) de Cosmos.`
                )
                .setTimestamp();

            return interaction.editReply({ embeds: [subEmbed] });

        } catch (error) {
            console.error("Erreur lors de la substitution :", error);
            return interaction.editReply("❌ Une erreur cosmique s'est produite lors du remplacement.");
        }
    }
};