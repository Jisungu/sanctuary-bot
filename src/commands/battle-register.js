const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const Battle = require('../models/Battle');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-register')
        .setDescription('Ajoute manuellement un ou plusieurs joueurs au sondage ou à l\'appel en cours.')
        .addUserOption(option => 
            option.setName('joueur1')
                .setDescription('Premier joueur à ajouter')
                .setRequired(true))
        .addUserOption(option => 
            option.setName('joueur2')
                .setDescription('Deuxième joueur (optionnel)')
                .setRequired(false))
        .addUserOption(option => 
            option.setName('joueur3')
                .setDescription('Troisième joueur (optionnel)')
                .setRequired(false))
        .addUserOption(option => 
            option.setName('joueur4')
                .setDescription('Quatrième joueur (optionnel)')
                .setRequired(false))
        .addUserOption(option => 
            option.setName('joueur5')
                .setDescription('Cinquième joueur (optionnel)')
                .setRequired(false))
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

        // Récupération de tous les joueurs renseignés (en éliminant les doublons)
        const targets = [];
        for (let i = 1; i <= 5; i++) {
            const user = interaction.options.getUser(`joueur${i}`);
            if (user && !targets.some(u => u.id === user.id)) {
                targets.push(user);
            }
        }

        const targetIds = targets.map(u => u.id);
        const targetNames = targets.map(u => `**${u.username}**`).join(', ');

        // Attribution du rôle "TeamBattle"
        const role = interaction.guild.roles.cache.find(r => r.name === 'TeamBattle');
        if (role) {
            for (const user of targets) {
                const member = await interaction.guild.members.fetch(user.id).catch(() => null);
                if (member) {
                    await member.roles.add(role).catch(err => console.error(`Impossible d'ajouter le rôle à ${user.username}:`, err));
                }
            }
        }

        let updateData = { $addToSet: { participants: {$each: targetIds } } };

        if (battle.status === 'calling') {
            updateData.$addToSet.presents = {$each: targetIds };
        }

        const updatedBattle = await Battle.findOneAndUpdate(
            { _id: battle._id },
            updateData,
            { returnDocument: 'after' }
        );

        if (!updatedBattle.channelId || !updatedBattle.messageId) {
            return interaction.reply({ 
                content: `✅ ${targetNames} ajouté(s) en BDD (aucun message d'annonce associé).`, 
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
                content: `✅ ${targetNames} a/ont été ajouté(s) avec succès (${updatedBattle.status === 'calling' ? 'inscrit(s) + présent(s)' : 'inscrit(s)'})${!role ? '\n⚠️ Rôle **TeamBattle** introuvable sur ce serveur.' : ''}`, 
                flags: [MessageFlags.Ephemeral] 
            });

        } catch (error) {
            console.error("Erreur lors de la mise à jour visuelle :", error);
            return interaction.reply({ 
                content: `✅ ${targetNames} ajouté(s) en base de données, mais impossible de mettre à jour le message visuel.`, 
                flags: [MessageFlags.Ephemeral] 
            });
        }
    },
};