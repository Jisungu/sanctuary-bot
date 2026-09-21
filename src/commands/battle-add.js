const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-add')
        .setDescription('Ajoute manuellement un joueur au sondage ou à l\'appel en cours.')
        .addUserOption(option => 
            option.setName('joueur')
                .setDescription('Le joueur à ajouter')
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const battle = await Battle.findOne({ 
            guildId: interaction.guildId, 
            status: { $in: ['registration', 'calling'] } 
        }).sort({ createdAt: -1 });

        if (!battle) {
            return interaction.reply({ 
                content: "⚠️ Aucune bataille active trouvée (sondage ou appel).", 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        const targetUser = interaction.options.getUser('joueur');
        let updateData = { $addToSet: { participants: targetUser.id } };

        if (battle.status === 'calling') {
            updateData.$addToSet.presents = targetUser.id;
        }

        const updatedBattle = await Battle.findOneAndUpdate(
            { _id: battle._id },
            updateData,
            { returnDocument: 'after' }
        );

        if (!updatedBattle.channelId || !updatedBattle.messageId) {
            return interaction.reply({ 
                content: `✅ **${targetUser.username}** ajouté en BDD (aucun message d'annonce associé).`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }

        try {
            const channel = await interaction.client.channels.fetch(updatedBattle.channelId);
            const message = await channel.messages.fetch(updatedBattle.messageId);
            const originalEmbed = message.embeds[0];

            let newEmbed;

            if (updatedBattle.status === 'registration') {
                newEmbed = EmbedBuilder.from(originalEmbed).setFields({
                    name: `Chevaliers inscrits (${updatedBattle.participants.length})`,
                    value: updatedBattle.participants.map(id => `<@${id}>`).join('\n') || 'Aucun chevalier déclaré'
                });
            } else {
                newEmbed = EmbedBuilder.from(originalEmbed).setFields(
                    { 
                        name: 'Chevaliers attendus', 
                        value: updatedBattle.participants.map(id => `<@${id}>`).join('\n') 
                    },
                    { 
                        name: `Présents (${updatedBattle.presents.length}/${updatedBattle.participants.length}) ✅`, 
                        value: updatedBattle.presents.map(id => `<@${id}>`).join('\n') || 'En attente...' 
                    }
                );
            }

            await message.edit({ embeds: [newEmbed] });

            return interaction.reply({ 
                content: `✅ **${targetUser.username}** a été ajouté avec succès (${updatedBattle.status === 'calling' ? 'inscrit + présent' : 'inscrit'}).`, 
                flags: [MessageFlags.Ephemeral] 
            });

        } catch (error) {
            console.error("Erreur lors de la mise à jour visuelle :", error);
            return interaction.reply({ 
                content: `✅ **${targetUser.username}** ajouté en base de données, mais impossible de mettre à jour le message visuel.`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    },
};