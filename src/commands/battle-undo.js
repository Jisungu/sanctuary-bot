const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const Battle = require('../models/Battle');
const { characters, stages } = require('../utils/data');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-undo')
        .setDescription('Annule le résultat du dernier duel et rend la vie au vaincu.')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        try {
            // On cherche la battle en cours
            const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });

            if (!battle) {
                return interaction.editReply("⚠️ Aucune Guerre Sainte n'est active en ce moment.");
            }

            if (!battle.history || battle.history.length === 0) {
                return interaction.editReply("📜 L'historique de cette Guerre Sainte est vide. Impossible de revenir en arrière.");
            }

            // 1. Récupérer et retirer le dernier duel de l'historique
            const lastMatch = battle.history.pop();
            const loserId = lastMatch.loserId.toString();

            // 2. Redonner une vie au perdant (sans dépasser la limite initiale)
            const currentLives = battle.viesActuelles.get(loserId) ?? 0;
            const restoredLives = Math.min(battle.viesParJoueur, currentLives + 1);
            battle.viesActuelles.set(loserId, restoredLives);

            // 3. Reset le match actuel pour éviter les conflits
            battle.currentMatch = undefined;

            // On notifie Mongoose des changements sur le Map
            battle.markModified('viesActuelles');
            battle.markModified('history');
            await battle.save();

            // 4. Traduction des labels pour l'embed
            const charWinLabel = characters.find(c => c.value === lastMatch.winnerChar)?.label || lastMatch.winnerChar;
            const charLosLabel = characters.find(c => c.value === lastMatch.loserChar)?.label || lastMatch.loserChar;

            const undoEmbed = new EmbedBuilder()
                .setTitle('⏳ Distorsion Temporelle - Annulation')
                .setDescription(`Le dernier affrontement a été effacé des chroniques par décret divin !`)
                .setColor('#9b59b6') // Violet pour l'effet temporel / magique
                .addFields(
                    { 
                        name: '❌ Duel annulé', 
                        value: `🏆 **Vainqueur déchu :** <@${lastMatch.winnerId}> (${charWinLabel})\n💀 **Vaincu restauré :** <@${lastMatch.loserId}> (${charLosLabel})` 
                    },
                    {
                        name: '❤️ Restauration',
                        value: `<@${lastMatch.loserId}> récupère un éclat de Cosmos (Vies actuelles : **${restoredLives}/${battle.viesParJoueur}**)`
                    }
                )
                .setFooter({ text: 'Le cours du temps a repris. Utilisez /battle-toss pour relancer un assaut.' })
                .setTimestamp();

            await interaction.editReply({ embeds: [undoEmbed] });

            // 5. On affiche le statut global mis à jour dans le salon (comme après une victoire)
            // On importe la fonction ou on reproduit l'affichage
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