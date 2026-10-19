const MAX_PLAYERS = 10;

function formatPlayers(ids, emptyMessage) {
    if (!ids.length) return emptyMessage;

    const lines = [];
    for (let index = 0; index < ids.length; index++) {
        const line = `<@${ids[index]}>`;
        const remaining = ids.length - index - 1;
        const suffix = remaining ? `\n… et ${remaining} autre(s)` : '';
        const candidate = [...lines, line].join('\n') + suffix;

        if (candidate.length > 1024) {
            lines.push(`… et ${ids.length - index} autre(s)`);
            break;
        }

        lines.push(line);
    }

    return lines.join('\n');
}

function addPlayers(battle, userIds) {
    const participants = [...battle.participants];
    const waitlist = [...(battle.waitlist || [])];
    const newIds = [...new Set(userIds)].filter(
        id => !participants.includes(id) && !waitlist.includes(id)
    );
    const availableSlots = Math.max(0, MAX_PLAYERS - participants.length);
    const activeIds = newIds.slice(0, availableSlots);
    const waitlistedIds = newIds.slice(availableSlots);

    battle.participants = [...participants, ...activeIds];
    battle.waitlist = [...waitlist, ...waitlistedIds];

    return { activeIds, waitlistedIds };
}

function removePlayers(battle, userIds) {
    const removedIds = new Set(userIds);
    const participants = battle.participants.filter(id => !removedIds.has(id));
    const waitlist = (battle.waitlist || []).filter(id => !removedIds.has(id));
    const presents = battle.presents.filter(id => !removedIds.has(id));
    const promotedIds = [];

    while (participants.length < MAX_PLAYERS && waitlist.length) {
        promotedIds.push(waitlist.shift());
        participants.push(promotedIds[promotedIds.length - 1]);
    }

    battle.participants = participants;
    battle.waitlist = waitlist;
    battle.presents = presents;

    return { promotedIds };
}

function getBattleFields(battle) {
    const waitlist = battle.waitlist || [];
    const fields = [];

    if (battle.status === 'calling') {
        fields.push(
            {
                name: 'Guerriers attendus',
                value: formatPlayers(battle.participants, '...')
            },
            {
                name: `Présents (${battle.presents.length}/${battle.participants.length})`,
                value: formatPlayers(battle.presents, 'En attente...')
            }
        );
    } else {
        fields.push({
            name: `📜 Chevaliers inscrits (${battle.participants.length}/${MAX_PLAYERS})`,
            value: formatPlayers(
                battle.participants,
                "_Aucun guerrier n'a encore répondu à l'appel d'Athéna._"
            )
        });
    }

    if (battle.participants.length >= MAX_PLAYERS) {
        fields.push({
            name: `⏳ Liste d'attente (${waitlist.length})`,
            value: formatPlayers(waitlist, '_Aucun chevalier en attente._')
        });
    }

    return fields;
}

module.exports = { MAX_PLAYERS, addPlayers, removePlayers, getBattleFields };
