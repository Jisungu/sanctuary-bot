const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const { characters, stages } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-undo')
        .setDescription('Annule le résultat du dernier duel (Match classique ou Phoenix) et restaure le temps.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        try {
            const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });

            if (!battle) {
                return interaction.editReply("⚠️ Aucune Guerre Sainte n'est active en ce moment.");
            }

            if (!battle.history || battle.history.length === 0) {
                return interaction.editReply("📜 L'historique de cette Guerre Sainte est vide. Impossible de revenir en arrière.");
            }

            const lastMatch = battle.history.pop();
            const winnerId = lastMatch.winnerId.toString();
            const loserId = lastMatch.loserId.toString();

            const undoEmbed = new EmbedBuilder()
                .setTitle('⏳ Distorsion Temporelle - Annulation')
                .setColor('#9b59b6')
                .setTimestamp();

            if (lastMatch.isPhoenix === true) {
                battle.viesActuelles.set(winnerId, 0);
                battle.phoenixUsed = false;
                undoEmbed.setDescription(`**Le miracle du Phoenix a été révoqué par décret divin !**`)
                    .addFields(
                        { 
                            name: '❌ Duel Phoenix Annulé', 
                            value: `🏆 **Vainqueur déchu :** <@${winnerId}>\n💀 **Vaincu des Enfers :** <@${loserId}>` 
                        },
                        {
                            name: '🔮 Statut des Vies',
                            value: `<@${winnerId}> perd sa jauge salvatrice et retourne à **0 vie (🖤)**. La règle du Phoenix est de nouveau disponible !`
                        }
                    )
                    .setFooter({ text: 'Les Enfers se referment. Utilisez /battle-phoenix si vous devez relancer ce duel.' });
            } else {
                const currentLives = battle.viesActuelles.get(loserId) ?? 0;
                const restoredLives = Math.min(battle.viesParJoueur, currentLives + 1);
                battle.viesActuelles.set(loserId, restoredLives);

                const charWinLabel = characters.find(c => c.value === lastMatch.winnerChar)?.label || lastMatch.winnerChar;
                const charLosLabel = characters.find(c => c.value === lastMatch.loserChar)?.label || lastMatch.loserChar;

                undoEmbed.setDescription(`Le dernier affrontement a été effacé des chroniques par décret divin !`)
                    .addFields(
                        { 
                            name: '❌ Duel annulé', 
                            value: `🏆 **Vainqueur déchu :** <@${winnerId}> (${charWinLabel})\n💀 **Vaincu restauré :** <@${loserId}> (${charLosLabel})` 
                        },
                        {
                            name: '❤️ Restauration',
                            value: `<@${loserId}> récupère un éclat de Cosmos (Vies actuelles : **${restoredLives}/${battle.viesParJoueur}**)`
                        }
                    )
                    .setFooter({ text: 'Le cours du temps a repris. Utilisez /battle-toss pour relancer un assaut.' });
            }

            battle.currentMatch = undefined;
            battle.markModified('viesActuelles');
            battle.markModified('history');
            await battle.save();

            await interaction.editReply({ embeds: [undoEmbed] });

            const statusEmbed = new EmbedBuilder()
                .setTitle('⚔️ Chroniques du Sanctuaire (Mis à jour)')
                .setColor('#E67E22')
                .setTimestamp();

            const formatTeam = (players) => players.map(id => {
                const lives = battle.viesActuelles.get(id.toString()) || 0;
                return `<@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(battle.viesParJoueur - lives)}`;
            }).join('\n');

            statusEmbed.addFields(
                { name: '\u200B', value: '📜 **État actuel des forces**', inline: false },
                { name: `🔵 ${battle.teams.team1.name}`, value: formatTeam(battle.teams.team1.players), inline: true },
                { name: `🔴 ${battle.teams.team2.name}`, value: formatTeam(battle.teams.team2.players), inline: true }
            );

            return await interaction.channel.send({ embeds: [statusEmbed] });

        } catch (error) {
            console.error("Erreur lors du battle-undo :", error);
            return interaction.editReply("❌ Une erreur cosmique a empêché la restauration du temps.");
        }
    }
};