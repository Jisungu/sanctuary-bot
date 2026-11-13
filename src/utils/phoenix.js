const TEAM_KEYS = ['team1', 'team2'];

function getTeamLives(battle, teamKey) {
    const team = battle.teams?.[teamKey];
    if (!team) return 0;
    return team.players.reduce((total, playerId) => {
        const lives = battle.viesActuelles.get(playerId.toString()) || 0;
        return total + Math.max(0, lives);
    }, 0);
}

function getPhoenixUsedTeams(battle) {
    const recorded = [...new Set((battle.phoenixUsedTeams || [])
        .filter(teamKey => TEAM_KEYS.includes(teamKey)))];
    if (recorded.length) return recorded;
    // Older battles tracked one unassigned Phoenix use, so neither team can safely be credited with it.
    return battle.phoenixUsed ? [...TEAM_KEYS] : [];
}

function getEligiblePhoenixTeams(battle) {
    if (battle.currentMatch?.p1 || battle.currentMatch?.p2) return [];

    const usedTeams = getPhoenixUsedTeams(battle);
    return TEAM_KEYS.filter(teamKey => {
        const opposingTeam = teamKey === 'team1' ? 'team2' : 'team1';
        const team = battle.teams?.[teamKey];
        return team
            && !usedTeams.includes(teamKey)
            && team.players.some(playerId => (battle.viesActuelles.get(playerId.toString()) || 0) <= 0)
            && getTeamLives(battle, teamKey) < getTeamLives(battle, opposingTeam);
    });
}

function getPhoenixLaunchError(battle, teamKey, phoenixPlayerId, opponentId) {
    if (!TEAM_KEYS.includes(teamKey)) return 'Choisissez l’équipe qui déclenche le duel du Phénix.';
    if (battle.currentMatch?.p1 || battle.currentMatch?.p2) return 'Un duel est déjà en cours.';
    if (getPhoenixUsedTeams(battle).includes(teamKey)) return 'Cette équipe a déjà utilisé son duel du Phénix.';
    if (phoenixPlayerId === opponentId) return 'Un joueur ne peut pas s’affronter lui-même.';

    const opposingTeamKey = teamKey === 'team1' ? 'team2' : 'team1';
    const team = battle.teams?.[teamKey];
    const opposingTeam = battle.teams?.[opposingTeamKey];
    if (!team || !opposingTeam) return 'Les équipes de la bataille sont introuvables.';
    if (getTeamLives(battle, teamKey) >= getTeamLives(battle, opposingTeamKey)) {
        return 'L’équipe qui déclenche le duel doit avoir moins de vies que l’équipe adverse.';
    }

    const phoenixPlayer = team.players.find(id => id.toString() === phoenixPlayerId);
    if (!phoenixPlayer) return 'Le joueur à ressusciter doit appartenir à l’équipe qui déclenche le duel.';
    if ((battle.viesActuelles.get(phoenixPlayerId) || 0) > 0) {
        return 'Choisissez un joueur éliminé de l’équipe qui déclenche le duel.';
    }

    if (!opposingTeam.players.some(id => id.toString() === opponentId)) {
        return 'Choisissez un adversaire de l’équipe opposée.';
    }

    return null;
}

function resolvePhoenixMatch(battle, winnerId) {
    const match = battle.currentMatch;
    if (!match?.isPhoenix || !match.p1 || !match.p2 || !['team1', 'team2'].includes(match.phoenixTeam)) {
        throw new Error('Le duel du Phénix est incomplet.');
    }

    const p1Id = match.p1.toString();
    const p2Id = match.p2.toString();
    const winningId = winnerId.toString();
    if (![p1Id, p2Id].includes(winningId)) {
        throw new Error('Le vainqueur ne participe pas au duel du Phénix.');
    }

    const phoenixTeam = match.phoenixTeam;
    const initiatorId = phoenixTeam === 'team1' ? p1Id : p2Id;
    const opponentId = phoenixTeam === 'team1' ? p2Id : p1Id;
    const p1LivesBefore = battle.viesActuelles.get(p1Id) ?? 0;
    const p2LivesBefore = battle.viesActuelles.get(p2Id) ?? 0;
    const opponentLivesBefore = phoenixTeam === 'team1' ? p2LivesBefore : p1LivesBefore;
    const initiatorWon = winningId === initiatorId;
    const loserId = winningId === p1Id ? p2Id : p1Id;

    if (initiatorWon) {
        battle.viesActuelles.set(initiatorId, 1);
        if (opponentLivesBefore > 0) {
            battle.viesActuelles.set(opponentId, opponentLivesBefore - 1);
        }
    } else {
        battle.viesActuelles.set(initiatorId, 0);
        if (opponentLivesBefore === 0) battle.viesActuelles.set(opponentId, 1);
    }

    const usedTeams = getPhoenixUsedTeams(battle);
    battle.phoenixUsedTeams = [...new Set([...usedTeams, phoenixTeam])];
    battle.phoenixUsed = true;
    battle.history.push({
        p1_id: p1Id,
        p2_id: p2Id,
        winnerId: winningId,
        loserId,
        winnerChar: winningId === p1Id ? match.char1 : match.char2,
        loserChar: loserId === p1Id ? match.char1 : match.char2,
        stage: match.stage || 'enfers',
        isPhoenix: true,
        phoenixTeam,
        p1LivesBefore,
        p2LivesBefore,
        timestamp: new Date()
    });

    if (getTeamLives(battle, 'team1') === 0 || getTeamLives(battle, 'team2') === 0) {
        battle.status = 'finished';
    }
    battle.currentMatch = undefined;
    battle.markModified('viesActuelles');
    battle.markModified('history');

    return {
        initiatorId,
        opponentId,
        initiatorWon,
        opponentLivesBefore,
        opponentLivesAfter: battle.viesActuelles.get(opponentId) ?? 0,
        winnerId: winningId,
        loserId,
        phoenixTeam
    };
}

function undoPhoenixMatch(battle, lastMatch) {
    const hasSnapshot = typeof lastMatch.p1LivesBefore === 'number'
        && typeof lastMatch.p2LivesBefore === 'number';
    if (hasSnapshot) {
        battle.viesActuelles.set(lastMatch.p1_id.toString(), lastMatch.p1LivesBefore);
        battle.viesActuelles.set(lastMatch.p2_id.toString(), lastMatch.p2LivesBefore);
        battle.phoenixUsedTeams = (battle.phoenixUsedTeams || [])
            .filter(teamKey => teamKey !== lastMatch.phoenixTeam);
    } else {
        battle.viesActuelles.set(lastMatch.winnerId.toString(), 0);
        battle.phoenixUsedTeams = [];
    }
    battle.phoenixUsed = battle.phoenixUsedTeams.length > 0;
    battle.markModified('viesActuelles');
}

module.exports = {
    TEAM_KEYS,
    getTeamLives,
    getPhoenixUsedTeams,
    getEligiblePhoenixTeams,
    getPhoenixLaunchError,
    resolvePhoenixMatch,
    undoPhoenixMatch
};
