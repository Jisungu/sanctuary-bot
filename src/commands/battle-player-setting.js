const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Player = require('../models/Player');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-player-setting')
        .setDescription('Définit le niveau et/ou le nom personnalisé d\'un joueur.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur à éditer')
                .setRequired(true))
        .addIntegerOption(option => 
            option.setName('niveau')
                .setDescription('Choisir le niveau du joueur (optionnel)')
                .setRequired(false)
                .addChoices(
                    { name: '1 - Débutant', value: 1 },
                    { name: '2 - Intermédiaire', value: 2 },
                    { name: '3 - Confirmé', value: 3 },
                    { name: '4 - Expert', value: 4 },
                    { name: '5 - Maître', value: 5 },
                ))
        .addStringOption(option =>
            option.setName('pseudo')
                .setDescription('Pseudo du joueur (optionnel)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const targetUser = interaction.options.getUser('joueur');
        const levelValue = interaction.options.getInteger('niveau');
        const customName = interaction.options.getString('pseudo');

        // Vérification qu'au moins une option de modification est renseignée
        if (levelValue === null && !customName) {
            return interaction.reply({
                content: "⚠️ Tu dois spécifier au moins un **niveau** ou un **pseudo** à modifier.",
                flags: [MessageFlags.Ephemeral]
            });
        }

        const levelNames = {
            1: "Débutant",
            2: "Intermédiaire",
            3: "Confirmé",
            4: "Expert",
            5: "Maître"
        };

        // Préparation de l'objet de mise à jour
        const updateFields = {};
        const changes = [];

        if (levelValue !== null) {
            updateFields.level = levelValue;
            changes.push(`Niveau : **${levelNames[levelValue]}** (Niveau ${levelValue})`);
        }

        if (customName) {
            updateFields.username = customName;
            changes.push(`Pseudo : **${customName}**`);
        }

        try {
            await Player.findOneAndUpdate(
                { _id: targetUser.id },
                { $set: updateFields }, 
                { upsert: true, new: true, setDefaultsOnInsert: true }
            );

            return interaction.reply({
                content: `✅ Profil de **${targetUser.username}** mis à jour :\n- ${changes.join('\n- ')}`,
                flags: [MessageFlags.Ephemeral]
            });

        } catch (error) {
            console.error(error);
            return interaction.reply({
                content: "⚠️ Impossible de mettre à jour le profil dans la base de données.",
                flags: [MessageFlags.Ephemeral]
            });
        }
    },
};