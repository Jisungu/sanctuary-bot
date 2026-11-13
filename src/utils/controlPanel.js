const crypto = require('node:crypto');
const path = require('node:path');
const {
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    EmbedBuilder
} = require('discord.js');
const Battle = require('../models/Battle');
const Player = require('../models/Player');
const { characters } = require('./data');
const { broadcastOverlayData, broadcastTossResult, toggleSwapSides } = require('./overlayServer');
const { getBattleFields } = require('./battleRegistration');
const registerControlPanelCommands = require('./controlPanelCommands');
const {
    buildBattleStatusEmbed,
    buildBattleVictoryEmbed,
    buildKnockoutEmbed,
    buildPhoenixAvailabilityEmbed
} = require('./battleStatus');
const {
    getEligiblePhoenixTeams,
    getPhoenixLaunchError,
    getPhoenixUsedTeams,
    resolvePhoenixMatch,
    undoPhoenixMatch
} = require('./phoenix');

function registerControlPanelRoutes(app, client) {
    const panelPath = path.join(__dirname, '..', '..', 'public', 'control-panel.html');

    app.get('/control-panel', (req, res) => res.sendFile(panelPath));

    app.use('/api/control-panel', (req, res, next) => {
        const configuredToken = process.env.CONTROL_PANEL_TOKEN;
        const suppliedToken = req.get('x-control-panel-token') || '';

        if (!configuredToken) {
            return res.status(503).json({ error: 'Le panneau est désactivé : configurez CONTROL_PANEL_TOKEN.' });
        }

        const supplied = Buffer.from(suppliedToken);
        const configured = Buffer.from(configuredToken);
        if (supplied.length !== configured.length || !crypto.timingSafeEqual(supplied, configured)) {
            return res.status(401).json({ error: 'Jeton du panneau invalide.' });
        }

        next();
    });

    registerControlPanelCommands(app, client, getConfiguredChannelId);

    app.get('/api/control-panel/state', async (req, res) => {
        try {
            const activeBattles = await Battle.find({ status: 'started' }).sort({ createdAt: -1 });
            const activeGuildIds = new Set(activeBattles.map(battle => battle.guildId));
            const preparationBattles = await Battle.find({
                status: { $in: ['registration', 'calling'] }
            }).sort({ updatedAt: -1 });
            const preparationByGuild = new Map();
            for (const battle of preparationBattles) {
                if (!activeGuildIds.has(battle.guildId) && !preparationByGuild.has(battle.guildId)) {
                    preparationByGuild.set(battle.guildId, battle);
                }
            }
            const currentBattles = [...activeBattles, ...preparationByGuild.values()];
            const currentGuildIds = new Set(currentBattles.map(battle => battle.guildId));
            const finishedDocs = await Battle.aggregate([
                { $match: { status: 'finished' } },
                { $sort: { updatedAt: -1 } },
                { $group: { _id: '$guildId', battle: { $first: '$$ROOT' } } },
                { $replaceRoot: { newRoot: '$battle' } }
            ]);
            const latestFinished = finishedDocs
                .filter(battle => !currentGuildIds.has(battle.guildId))
                .map(battle => Battle.hydrate(battle));
            const battles = [...currentBattles, ...latestFinished]
                .sort((a, b) => b.updatedAt - a.updatedAt);
            const state = await Promise.all(battles.map(async battle => {
                const playerIds = [
                    ...(battle.teams?.team1?.players || []),
                    ...(battle.teams?.team2?.players || []),
                    ...(battle.participants || []),
                    ...(battle.waitlist || [])
                ].map(id => id.toString());
                const players = await Player.find({ _id: { $in: playerIds } }).select('_id username');
                const names = new Map(players.map(player => [player.id, player.username]));
                const formatTeam = team => ({
                    name: team?.name || 'Équipe',
                    players: (team?.players || []).map(id => ({
                        id: id.toString(),
                        name: names.get(id.toString()) || id.toString(),
                        lives: battle.viesActuelles.get(id.toString()) ?? 0
                    }))
                });
                const match = battle.currentMatch;

                return {
                    guildId: battle.guildId,
                    guildName: client.guilds.cache.get(battle.guildId)?.name || battle.guildId,
                    status: battle.status,
                    dateTournoi: battle.dateTournoi || '',
                    heureTournoi: battle.heureTournoi || '',
                    channelId: battle.channelId,
                    team1: formatTeam(battle.teams?.team1),
                    team2: formatTeam(battle.teams?.team2),
                    participants: (battle.participants || []).map(id => ({
                        id: id.toString(),
                        name: names.get(id.toString()) || id.toString(),
                        present: battle.presents?.includes(id.toString()) || false
                    })),
                    waitlist: (battle.waitlist || []).map(id => ({
                        id: id.toString(),
                        name: names.get(id.toString()) || id.toString()
                    })),
                    presents: (battle.presents || []).map(id => id.toString()),
                    livesPerPlayer: battle.viesParJoueur,
                    phoenixUsedTeams: getPhoenixUsedTeams(battle),
                    phoenixEligibleTeams: getEligiblePhoenixTeams(battle),
                    currentMatch: match?.p1 && match?.p2 && match?.char1 && match?.char2 ? {
                        p1: match.p1,
                        p2: match.p2,
                        char1: match.char1,
                        char2: match.char2,
                        isPhoenix: match.isPhoenix,
                        phoenixTeam: match.phoenixTeam
                    } : null,
                    historyLength: battle.history.length
                };
            }));

            const guilds = Array.from(client.guilds.cache.values(), guild => ({
                id: guild.id,
                name: guild.name
            }));
            res.json({ battles: state, characters, guilds });
        } catch (error) {
            console.error('Erreur de lecture du panneau de contrôle :', error);
            res.status(500).json({ error: 'Impossible de charger les batailles.' });
        }
    });

    app.get('/api/control-panel/players', async (req, res) => {
        try {
            const guildId = req.query.guildId;
            const mode = req.query.mode;
            const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 40) : '';
            if (typeof guildId !== 'string' || !client.guilds.cache.has(guildId)) {
                return res.status(400).json({ error: 'Serveur Discord invalide.' });
            }
            if (!['add', 'remove'].includes(mode)) {
                return res.status(400).json({ error: 'Type de recherche invalide.' });
            }
            if (query.length < 2) return res.json({ players: [] });

            const battle = await Battle.findOne({
                guildId,
                status: { $in: ['registration', 'calling'] },
                isDirect: { $ne: true }
            }).sort({ createdAt: -1 });
            if (!battle) {
                return res.status(409).json({ error: 'Les inscriptions ne sont pas ouvertes pour ce serveur.' });
            }

            const registeredIds = [...new Set([
                ...(battle.participants || []),
                ...(battle.waitlist || [])
            ].map(id => id.toString()))];
            const escapedQuery = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
            const namePattern = new RegExp(`^${escapedQuery}`, 'i');
            const idPattern = new RegExp(`^${escapedQuery}`);
            let players;

            if (mode === 'add') {
                players = await Player.find({
                    _id: { $nin: registeredIds },
                    $or: [{ username: namePattern }, { _id: idPattern }]
                }).select('_id username level').sort({ username: 1 }).limit(30);
            } else {
                const matchingIds = registeredIds.filter(id => id.startsWith(query));
                const databasePlayers = await Player.find({
                    _id: { $in: registeredIds },
                    $or: [{ username: namePattern }, { _id: idPattern }]
                }).select('_id username level').sort({ username: 1 }).limit(30);
                const databaseIds = new Set(databasePlayers.map(player => player.id));
                const exactIdMatches = matchingIds.filter(id => !databaseIds.has(id));
                const fallbackPlayers = exactIdMatches.map(id => ({ id, username: id, level: null }));
                players = [...databasePlayers.map(player => ({
                    id: player.id,
                    username: player.username,
                    level: player.level
                })), ...fallbackPlayers].slice(0, 30);
            }

            res.json({
                players: players.map(player => ({
                    id: player.id || player._id.toString(),
                    name: player.username || player.id || player._id.toString(),
                    level: player.level ?? null
                }))
            });
        } catch (error) {
            console.error('Erreur de recherche de joueurs pour le panneau :', error);
            res.status(500).json({ error: 'Impossible de rechercher les joueurs.' });
        }
    });

    app.post('/api/control-panel/presence', async (req, res) => {
        try {
            const { guildId, playerId, present } = req.body || {};
            if (typeof guildId !== 'string' || typeof playerId !== 'string'
                || !/^\d{15,22}$/.test(playerId) || typeof present !== 'boolean') {
                return res.status(400).json({ error: 'Joueur ou présence invalide.' });
            }

            const battle = await Battle.findOne({
                guildId,
                status: 'calling',
                isDirect: { $ne: true }
            }).sort({ createdAt: -1 });
            if (!battle) return res.status(404).json({ error: 'Aucun appel de joueurs n’est en cours.' });

            const isParticipant = (battle.participants || []).some(id => id.toString() === playerId);
            if (!isParticipant) {
                return res.status(409).json({ error: 'Seuls les joueurs inscrits peuvent être déclarés présents.' });
            }

            const currentPresence = (battle.presents || []).some(id => id.toString() === playerId);
            if (currentPresence === present) {
                return res.json({ message: present ? 'Ce joueur est déjà marqué présent.' : 'Ce joueur est déjà marqué absent.' });
            }

            const player = await Player.findById(playerId).select('username');
            const playerName = player?.username || `<@${playerId}>`;
            battle.presents = present
                ? [...new Set([...(battle.presents || []).map(id => id.toString()), playerId])]
                : (battle.presents || []).map(id => id.toString()).filter(id => id !== playerId);
            await battle.save();

            let warning = null;
            if (!battle.channelId || !battle.messageId) {
                warning = 'Présence enregistrée, mais le message de pointage n’est pas associé à cette bataille.';
            } else {
                try {
                    const channel = await client.channels.fetch(battle.channelId);
                    if (!channel?.isTextBased() || channel.guildId !== guildId) {
                        throw new Error('Salon de pointage invalide.');
                    }
                    const message = await channel.messages.fetch(battle.messageId);
                    if (!message.embeds[0]) throw new Error('Message de pointage sans embed.');
                    const embed = EmbedBuilder.from(message.embeds[0]).setFields(getBattleFields(battle));
                    await message.edit({ embeds: [embed] });
                } catch (error) {
                    console.error('Erreur de mise à jour du pointage après modification manuelle :', error);
                    warning = 'Présence enregistrée, mais le récapitulatif du salon Discord n’a pas pu être actualisé.';
                }
            }

            res.json({
                message: present
                    ? `${playerName} est maintenant compté parmi les présents.`
                    : `${playerName} n’est plus marqué présent.`,
                warning
            });
        } catch (error) {
            console.error('Erreur de modification manuelle d’une présence depuis le panneau :', error);
            res.status(500).json({ error: 'Impossible de modifier la présence du joueur.' });
        }
    });

    app.post('/api/control-panel/match', async (req, res) => {
        try {
            const { guildId, p1, p2, char1, char2, phoenix, phoenixTeam, swap } = req.body || {};
            if ((phoenix !== undefined && typeof phoenix !== 'boolean')
                || (swap !== undefined && typeof swap !== 'boolean')
                || (phoenixTeam !== undefined && typeof phoenixTeam !== 'string')) {
                return res.status(400).json({ error: 'Options de match invalides.' });
            }
            const battle = await getActiveBattle(guildId);
            if (!battle) return res.status(404).json({ error: 'Aucune bataille active sélectionnée.' });
            if (battle.currentMatch?.p1 || battle.currentMatch?.p2) {
                return res.status(409).json({ error: 'Un match est déjà en cours. Terminez-le avant d’en annoncer un autre.' });
            }
            if (!p1 || !p2 || p1 === p2 || !char1 || !char2) {
                return res.status(400).json({ error: 'Choisissez deux joueurs différents et leurs personnages.' });
            }

            if (!characters.some(character => character.value === char1)
                || !characters.some(character => character.value === char2)) {
                return res.status(400).json({ error: 'Personnage invalide.' });
            }

            if (phoenix) {
                const phoenixPlayerId = phoenixTeam === 'team1' ? p1 : p2;
                const opponentId = phoenixTeam === 'team1' ? p2 : p1;
                const launchError = getPhoenixLaunchError(battle, phoenixTeam, phoenixPlayerId, opponentId);
                if (launchError) return res.status(400).json({ error: launchError });
            } else {
                const p1IsInTeam1 = battle.teams.team1.players.some(id => id.toString() === p1);
                const p2IsInTeam2 = battle.teams.team2.players.some(id => id.toString() === p2);
                if (!p1IsInTeam1 || !p2IsInTeam2) {
                    return res.status(400).json({ error: 'Chaque joueur doit appartenir à son équipe.' });
                }
            }

            let swapStatusText = '';
            if (swap) {
                const isSwapped = toggleSwapSides();
                swapStatusText = `${phoenix ? '\n\n' : '\n'}🔄 *Overlay inversé : ${isSwapped ? 'Équipe 2 à gauche' : 'Équipe 1 à gauche'}*`;
            }
            battle.currentMatch = {
                p1,
                p2,
                char1,
                char2,
                isPhoenix: Boolean(phoenix),
                ...(phoenix ? { phoenixTeam } : {})
            };
            await battle.save();
            await broadcastOverlayData();

            const [p1Player, p2Player] = await Promise.all([
                Player.findById(p1).select('username'),
                Player.findById(p2).select('username')
            ]);
            const char1Label = characters.find(character => character.value === char1).label;
            const char2Label = characters.find(character => character.value === char2).label;
            const phoenixDescription = phoenix
                ? `L’équipe **${battle.teams[phoenixTeam].name}** déclenche son duel du Phénix.\n\n` +
                    `Le joueur éliminé choisi doit vaincre son adversaire pour revenir avec **1 vie**.`
                : '';
            const embed = new EmbedBuilder()
                .setTitle(phoenix ? '🔥 DUEL DE LA RÉSURRECTION DU PHOENIX 🔥' : '⚔️ Choc de Cosmos dans l\'Arène')
                .setDescription(phoenix
                    ? `${phoenixDescription}${swapStatusText}`
                    : swapStatusText ? swapStatusText.trim() : null)
                .setColor('#e67e22')
                .addFields(
                    { name: `🔵 ${battle.teams.team1.name}`, value: `<@${p1}>\n${phoenix ? `*${char1Label}*` : `**${char1Label}**`}`, inline: true },
                    { name: phoenix ? '⚡ VS ⚡' : 'VS', value: phoenix ? '\u200B' : '🔱', inline: true },
                    { name: `🔴 ${battle.teams.team2.name}`, value: `<@${p2}>\n${phoenix ? `*${char2Label}*` : `**${char2Label}**`}`, inline: true }
                )
                .setTimestamp();

            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId(phoenix ? `phoenix_win_p1_${p1}_vs_${p2}` : 'win_p1')
                    .setLabel(`Triomphe de ${p1Player?.username || 'l’équipe 1'}`)
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId(phoenix ? `phoenix_win_p2_${p2}_vs_${p1}` : 'win_p2')
                    .setLabel(`Triomphe de ${p2Player?.username || 'l’équipe 2'}`)
                    .setStyle(ButtonStyle.Danger)
            );
            const warning = await postToBattleChannel(client, battle, 'battle', { embeds: [embed], components: [row] });
            res.json({ message: 'Match annoncé.', warning });
        } catch (error) {
            console.error('Erreur lors de l’annonce du match depuis le panneau :', error);
            res.status(500).json({ error: 'Impossible d’annoncer le match.' });
        }
    });

    app.post('/api/control-panel/toss', async (req, res) => {
        try {
            const battle = await getActiveBattle(req.body?.guildId);
            if (!battle) return res.status(404).json({ error: 'Aucune bataille active sélectionnée.' });

            const { team1, team2 } = battle.teams;
            const designatedTeam = Math.random() < 0.5 ? team1.name : team2.name;
            const secondTeam = designatedTeam === team1.name ? team2.name : team1.name;
            broadcastTossResult(team1.name, team2.name, designatedTeam);

            const embed = new EmbedBuilder()
                .setTitle('🔥 L’Horloge du Sanctuaire s’éveille !')
                .setDescription('Les flammes s\'éteignent une à une... Le destin a tranché !')
                .setColor('#f1c40f')
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
            const warning = await postToBattleChannel(client, battle, 'battle', { embeds: [embed] });
            res.json({ message: `${designatedTeam} commence.`, warning, designatedTeam });
        } catch (error) {
            console.error('Erreur lors du toss depuis le panneau :', error);
            res.status(500).json({ error: 'Impossible de lancer le tirage au sort.' });
        }
    });

    app.post('/api/control-panel/result', async (req, res) => {
        try {
            const { guildId, winner } = req.body || {};
            const battle = await getActiveBattle(guildId);
            if (!battle) return res.status(404).json({ error: 'Aucune bataille active sélectionnée.' });
            const match = battle.currentMatch;
            if (!match?.p1 || !match?.p2) return res.status(409).json({ error: 'Aucun match à clôturer.' });
            if (!['p1', 'p2'].includes(winner)) return res.status(400).json({ error: 'Vainqueur invalide.' });

            const winnerId = match[winner];
            const loserId = match[winner === 'p1' ? 'p2' : 'p1'];
            const winnerChar = match[winner === 'p1' ? 'char1' : 'char2'];
            const loserChar = match[winner === 'p1' ? 'char2' : 'char1'];
            let loserLives;
            let phoenixResolution;
            if (match.isPhoenix) {
                phoenixResolution = resolvePhoenixMatch(battle, winnerId);
                if (phoenixResolution.initiatorWon) {
                    loserLives = phoenixResolution.opponentLivesAfter;
                }
            } else {
                battle.history.push({
                    p1_id: match.p1,
                    p2_id: match.p2,
                    winnerId,
                    loserId,
                    winnerChar,
                    loserChar,
                    stage: match.stage,
                    isPhoenix: false,
                    timestamp: new Date()
                });
                const remainingLives = Math.max(0, (battle.viesActuelles.get(loserId.toString()) ?? 0) - 1);
                loserLives = remainingLives;
                battle.viesActuelles.set(loserId.toString(), remainingLives);
                const [team1Lives, team2Lives] = [battle.teams.team1, battle.teams.team2].map(team =>
                    team.players.reduce((sum, id) => sum + (battle.viesActuelles.get(id.toString()) || 0), 0)
                );
                if (team1Lives === 0 || team2Lives === 0) battle.status = 'finished';

                await Promise.all([
                    Player.findByIdAndUpdate(winnerId, {
                        $inc: { 'stats.wins': 1, [`stats.charactersPlayed.${winnerChar}`]: 1 }
                    }, { upsert: true }),
                    Player.findByIdAndUpdate(loserId, {
                        $inc: { 'stats.losses': 1, [`stats.charactersPlayed.${loserChar}`]: 1 }
                    }, { upsert: true })
                ]);
            }

            battle.currentMatch = undefined;
            battle.markModified('viesActuelles');
            await battle.save();
            await broadcastOverlayData();

            const winnerPlayer = await Player.findById(winnerId).select('username');
            const warnings = [];

            if (match.isPhoenix) {
                const phoenixWinnerIsInitiator = phoenixResolution.initiatorWon;
                const phoenixDescription = phoenixWinnerIsInitiator
                    ? `<@${phoenixResolution.initiatorId}> revient dans la bataille avec **1 vie**.\n\n` +
                        (phoenixResolution.opponentLivesBefore > 0
                            ? `<@${phoenixResolution.opponentId}> perd une vie et en conserve **${phoenixResolution.opponentLivesAfter}**.`
                            : `<@${phoenixResolution.opponentId}> était déjà éliminé et le reste.`) +
                        `\n\nLe droit au Phénix de l’équipe initiatrice est consommé.`
                    : `Le joueur choisi par l’équipe initiatrice ne revient pas dans la bataille.\n\n` +
                        (phoenixResolution.opponentLivesBefore === 0
                            ? `<@${phoenixResolution.opponentId}> renaît avec **1 vie**. Cette résurrection ne consomme pas le droit au duel du Phénix de son équipe.`
                            : `<@${phoenixResolution.opponentId}> conserve ses **${phoenixResolution.opponentLivesAfter}** vie(s).`) +
                        `\n\nLe droit au Phénix de l’équipe initiatrice est consommé.`;
                const phoenixEmbed = new EmbedBuilder()
                    .setTitle(phoenixWinnerIsInitiator
                        ? '🔥 LE PHOENIX RENAÎT DE SES CENDRES ! 🔥'
                        : '⚔️ LE DUEL DU PHÉNIX EST SCELLÉ')
                    .setDescription(phoenixDescription)
                    .setColor('#e67e22')
                    .setTimestamp()
                    .setFooter({ text: 'Le Grand Pope scelle le destin !' });
                warnings.push(await postToBattleChannel(client, battle, 'battle', { embeds: [phoenixEmbed] }));
            } else if ((!match.isPhoenix && loserLives === 0)
                || (match.isPhoenix
                    && phoenixResolution.initiatorWon
                    && phoenixResolution.opponentLivesBefore > 0
                    && phoenixResolution.opponentLivesAfter === 0)) {
                warnings.push(await postToBattleChannel(client, battle, 'battle', {
                    embeds: [buildKnockoutEmbed(battle, loserId)]
                }));
            }

            warnings.push(await postToBattleChannel(client, battle, 'battle', {
                embeds: [buildBattleStatusEmbed(battle)]
            }));

            if (battle.status === 'finished') {
                warnings.push(await postToBattleChannel(client, battle, 'battle', {
                    embeds: [buildBattleVictoryEmbed(battle)]
                }));
            } else {
                const eligiblePhoenixTeams = getEligiblePhoenixTeams(battle);
                if (eligiblePhoenixTeams.length) {
                    warnings.push(await postToBattleChannel(client, battle, 'battle', {
                        embeds: [buildPhoenixAvailabilityEmbed(battle, eligiblePhoenixTeams)]
                    }));
                }
            }

            res.json({
                message: `${winnerPlayer?.username || 'Le joueur'} remporte le duel.`,
                warning: warnings.filter(Boolean).join(' ') || null,
                finished: battle.status === 'finished'
            });
        } catch (error) {
            console.error('Erreur lors de l’enregistrement du résultat depuis le panneau :', error);
            res.status(500).json({ error: 'Impossible d’enregistrer le résultat.' });
        }
    });

    app.post('/api/control-panel/undo', async (req, res) => {
        try {
            const guildId = req.body?.guildId;
            if (typeof guildId !== 'string') {
                return res.status(400).json({ error: 'Bataille invalide.' });
            }
            const battle = await Battle.findOne({
                guildId,
                status: { $in: ['started', 'finished'] }
            }).sort({ createdAt: -1 });
            if (!battle) return res.status(404).json({ error: 'Aucune bataille active sélectionnée.' });
            if (!battle.history.length) return res.status(409).json({ error: 'Aucun résultat à annuler.' });

            const lastMatch = battle.history.pop();
            const winnerId = lastMatch.winnerId.toString();
            const loserId = lastMatch.loserId.toString();
            if (lastMatch.isPhoenix) {
                undoPhoenixMatch(battle, lastMatch);
            } else {
                battle.viesActuelles.set(
                    loserId,
                    Math.min(battle.viesParJoueur, (battle.viesActuelles.get(loserId) ?? 0) + 1)
                );
                const winnerUpdates = { 'stats.wins': -1 };
                const loserUpdates = { 'stats.losses': -1 };
                if (lastMatch.winnerChar) winnerUpdates[`stats.charactersPlayed.${lastMatch.winnerChar}`] = -1;
                if (lastMatch.loserChar) loserUpdates[`stats.charactersPlayed.${lastMatch.loserChar}`] = -1;
                await Promise.all([
                    Player.findByIdAndUpdate(winnerId, { $inc: winnerUpdates }),
                    Player.findByIdAndUpdate(loserId, { $inc: loserUpdates })
                ]);
            }

            battle.status = 'started';
            battle.currentMatch = undefined;
            battle.markModified('viesActuelles');
            battle.markModified('history');
            await battle.save();
            await broadcastOverlayData();

            const warning = await postToBattleChannel(client, battle, 'battle', {
                embeds: [buildUndoEmbed(battle, lastMatch, winnerId, loserId)]
            });
            const recapWarning = await postToBattleChannel(client, battle, 'battle', {
                embeds: [buildBattleStatusEmbed(battle)]
            });
            res.json({
                message: 'Le dernier résultat a été annulé.',
                warning: [warning, recapWarning].filter(Boolean).join(' ') || null
            });
        } catch (error) {
            console.error('Erreur lors de l’annulation depuis le panneau :', error);
            res.status(500).json({ error: 'Impossible d’annuler le dernier résultat.' });
        }
    });
}

function buildUndoEmbed(battle, lastMatch, winnerId, loserId) {
    const undoEmbed = new EmbedBuilder()
        .setTitle('⏳ Distorsion Temporelle - Annulation')
        .setColor('#9b59b6')
        .setTimestamp();

    if (lastMatch.isPhoenix === true) {
        const phoenixTeamName = battle.teams[lastMatch.phoenixTeam]?.name || 'l’équipe initiatrice';
        return undoEmbed
            .setDescription('**Le miracle du Phoenix a été révoqué par décret divin !**')
            .addFields(
                {
                    name: '❌ Duel Phoenix Annulé',
                    value: `🏆 **Vainqueur déchu :** <@${winnerId}>\n💀 **Vaincu des Enfers :** <@${loserId}>`
                },
                {
                    name: '🔮 Statut des Vies',
                    value: `<@${winnerId}> retrouve son nombre de vies d’avant le duel. L’équipe **${phoenixTeamName}** récupère son droit au duel du Phénix.`
                }
            )
            .setFooter({ text: 'Les Enfers se referment. Utilisez /battle-phoenix si vous devez relancer ce duel.' });
    }

    const charWinLabel = characters.find(character => character.value === lastMatch.winnerChar)?.label || lastMatch.winnerChar;
    const charLosLabel = characters.find(character => character.value === lastMatch.loserChar)?.label || lastMatch.loserChar;
    const restoredLives = battle.viesActuelles.get(loserId) ?? 0;
    return undoEmbed
        .setDescription('Le dernier affrontement a été effacé des chroniques par décret divin !')
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

async function getActiveBattle(guildId) {
    if (!guildId || typeof guildId !== 'string') return null;
    return Battle.findOne({ guildId, status: 'started' }).sort({ createdAt: -1 });
}

function getConfiguredChannelId(guildId, purpose) {
    const rawConfig = process.env.CONTROL_PANEL_CHANNELS;
    if (!rawConfig) return null;

    let channelsByGuild;
    try {
        channelsByGuild = JSON.parse(rawConfig);
    } catch {
        throw new Error('CONTROL_PANEL_CHANNELS doit contenir un objet JSON valide.');
    }

    if (!channelsByGuild || typeof channelsByGuild !== 'object' || Array.isArray(channelsByGuild)) {
        throw new Error('CONTROL_PANEL_CHANNELS doit associer chaque serveur à ses salons.');
    }

    const channelId = channelsByGuild[guildId]?.[purpose];
    return typeof channelId === 'string' ? channelId : null;
}

async function postToBattleChannel(client, battle, purpose, message) {
    try {
        const channelId = getConfiguredChannelId(battle.guildId, purpose) || battle.channelId;
        const channel = await client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) throw new Error('Salon Discord introuvable ou non textuel.');
        if (channel.guildId !== battle.guildId) throw new Error('Le salon configuré n’appartient pas au serveur de la bataille.');
        await channel.send(message);
        return null;
    } catch (error) {
        console.error('Échec de la publication Discord depuis le panneau :', error);
        return 'Action enregistrée, mais la publication dans le salon Discord a échoué.';
    }
}

module.exports = registerControlPanelRoutes;
module.exports.getConfiguredChannelId = getConfiguredChannelId;
