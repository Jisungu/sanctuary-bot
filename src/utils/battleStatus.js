const { EmbedBuilder } = require('discord.js');
const { characters, stages } = require('./data');

function buildBattleStatusEmbed(battle) {
    const embed = new EmbedBuilder()
        .setTitle('⚔️ Chroniques du Sanctuaire')
        .setColor('#E67E22')
        .setTimestamp();

    const lastDuel = battle.history?.[battle.history.length - 1];
    if (lastDuel) {
        const winnerCharacter = characters.find(character => character.value === lastDuel.winnerChar)?.label || lastDuel.winnerChar;
        const loserCharacter = characters.find(character => character.value === lastDuel.loserChar)?.label || lastDuel.loserChar;
        const stage = stages.find(item => item.value === lastDuel.stage)?.label;
        const details = [
            `🏆 **Vainqueur :** <@${lastDuel.winnerId}>${winnerCharacter ? ` (${winnerCharacter})` : ''}`,
            `💀 **Vaincu :** <@${lastDuel.loserId}>${loserCharacter ? ` (${loserCharacter})` : ''}`,
            stage ? `🎮 **Stage :** ${stage}` : null
        ].filter(Boolean).join('\n');

        embed.addFields({ name: 'Dernier duel', value: details, inline: false });
    }

    const formatTeam = players => players.map(id => {
        const lives = Math.max(0, battle.viesActuelles.get(id.toString()) || 0);
        const lostLives = Math.max(0, (battle.viesParJoueur || 0) - lives);
        return `<@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(lostLives)}`;
    }).join('\n') || 'Aucun joueur';

    embed.addFields(
        { name: '\u200B', value: '📜 **État actuel des forces**', inline: false },
        { name: `🔵 ${battle.teams.team1.name}`, value: formatTeam(battle.teams.team1.players), inline: true },
        { name: `🔴 ${battle.teams.team2.name}`, value: formatTeam(battle.teams.team2.players), inline: true }
    );

    return embed;
}

function buildKnockoutEmbed(battle, playerId) {
    const wasPhoenix = battle.history?.some(match =>
        match.winnerId?.toString() === playerId.toString() && match.isPhoenix === true
    );
    const embed = new EmbedBuilder().setTimestamp();

    if (wasPhoenix) {
        return embed
            .setTitle('🌋 EXTINCTION DÉFINITIVE - LE PHOENIX SE CONSUME')
            .setDescription(
                `**Le miracle a pris fin sous les yeux d'Athéna !**\n\n` +
                `Le Chevalier <@${playerId}>, qui s'était pourtant arraché des griffes des Enfers grâce aux ailes du Phoenix, a vu ses dernières forces l'abandonner.\n\n` +
                `Son armure tombe en cendres, et cette fois-ci, aucun Cosmos ne pourra le ramener...`
            )
            .setColor('#7f8c8d')
            .addFields({
                name: '🔮 Verdict du Grand Pope',
                value: `<@${playerId}> a brûlé son ultime étincelle de vie. Il est **définitivement éliminé**.`
            })
            .setFooter({ text: 'Les cendres se dispersent sur le champ de bataille.' });
    }

    return embed
        .setTitle('💀 EXTINCTION DE COSMOS - K.O.')
        .setDescription(`Le Chevalier <@${playerId}> a vu son armure se briser ! Ses **${battle.viesParJoueur}** éclats de Cosmos se sont éteints...`)
        .setColor('#c0392b')
        .addFields({
            name: '🔮 Statut du Guerrier',
            value: `<@${playerId}> est définitivement **ÉLIMINÉ** de cette Guerre Sainte.`
        })
        .setFooter({ text: 'Son sacrifice restera gravé dans les chroniques du Sanctuaire.' });
}

function buildBattleVictoryEmbed(battle) {
    const team1Lives = battle.teams.team1.players.reduce(
        (total, id) => total + (battle.viesActuelles.get(id.toString()) || 0),
        0
    );
    const winningTeam = team1Lives > 0 ? battle.teams.team1 : battle.teams.team2;
    const stats = {};
    battle.history.forEach(match => {
        if (match.winnerId) {
            const id = match.winnerId.toString();
            stats[id] = (stats[id] || 0) + 1;
        }
    });
    const mvpId = Object.keys(stats).reduce(
        (best, id) => stats[best] > stats[id] ? best : id,
        winningTeam.players[0].toString()
    );
    const winnersList = winningTeam.players.map(id => {
        const lives = battle.viesActuelles.get(id.toString()) || 0;
        const totalLives = battle.viesParJoueur;
        return lives > 0
            ? `🛡️ <@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(totalLives - lives)} (**Survivant**)`
            : `💀 <@${id}> :${'🖤'.repeat(totalLives)} (**Éliminé**)`;
    }).join('\n');

    return new EmbedBuilder()
        .setTitle('🏆 LE SANCTUAIRE A SES VAINQUEURS !')
        .setDescription(`🔥 **L'armée ${winningTeam.name} a triomphé de la Guerre Sainte !** 🔥\n\nAprès d'âpres duels et des éclats de Cosmos mémorables, le destin s'est enfin scellé. L'arène s'apaise et les vainqueurs s'élèvent sous les acclamations du Sanctuaire !`)
        .setColor('#f1c40f')
        .addFields(
            {
                name: `👥 Chroniques de l'Armée ${winningTeam.name}`,
                value: winnersList,
                inline: false
            },
            {
                name: '🎖️ Étoile Polaire — Le MVP du le guerre Sainte',
                value: `⭐ <@${mvpId}> avec un total dévastateur de **${stats[mvpId] || 0}** victoires ! Son Cosmos a guidé son équipe vers les sommets.`,
                inline: false
            }
        )
        .setFooter({ text: 'La Guerre Sainte est terminée. Que la paix règne sur le Sanctuaire jusqu\'au prochain appel.' })
        .setTimestamp();
}

function buildPhoenixAvailabilityEmbed(battle, eligibleTeams) {
    const teamNames = eligibleTeams.map(teamKey => `**${battle.teams[teamKey].name}**`);
    const teamSubject = eligibleTeams.length === 1
        ? `L’équipe ${teamNames[0]} peut`
        : `Les équipes ${teamNames.slice(0, -1).join(', ')} et ${teamNames[teamNames.length - 1]} peuvent`;
    return new EmbedBuilder()
        .setTitle('🔥 L\'ALERTE DU PHOENIX S\'ÉVEILLE !')
        .setDescription(
            `⚡ **Le Cosmos d'Ikki embrase l'arène du Sanctuaire !** ⚡\n\n` +
            `${teamSubject} déclencher un duel du Phénix : l’équipe doit avoir au moins un membre éliminé et moins de vies que son adversaire.\n\n` +
            `Le duel peut être lancé à tout moment tant que ces conditions sont réunies.`
        )
        .setColor('#e67e22')
        .addFields({
            name: '📜 Procédure pour le TO',
            value: `Choisissez un joueur éliminé de l’équipe concernée, puis son adversaire dans l’autre équipe.\n\n` +
                `➡️ **Lancez le duel avec :**\n\`/battle-phoenix\``
        })
        .setTimestamp();
}

module.exports = {
    buildBattleStatusEmbed,
    buildKnockoutEmbed,
    buildBattleVictoryEmbed,
    buildPhoenixAvailabilityEmbed
};
