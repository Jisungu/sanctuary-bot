const { WebSocketServer } = require('ws');
const Battle = require('../models/Battle');
const Player = require('../models/Player');

let wss = null;
let isSwapped = false; // Variable globale pour garder l'état du swap en mémoire

function initWebSocket(server) {
    wss = new WebSocketServer({ server });
    console.log("📺 WebSocket attaché au serveur HTTP");

    wss.on('connection', () => {
        broadcastOverlayData();
    });
}

// Fonction pour inverser le côté de l'overlay sans toucher à la BDD
function toggleSwapSides() {
    isSwapped = !isSwapped;
    broadcastOverlayData();
    return isSwapped;
}

async function broadcastOverlayData() {
    if (!wss) return;

    try {
        const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 }) 
                   || await Battle.findOne({ status: 'finished' }).sort({ createdAt: -1 });

        if (!battle) {
            const emptyData = JSON.stringify({ active: false });
            wss.clients.forEach(client => client.send(emptyData));
            return;
        }

        async function formatTeam(team) {
            if (!team) return { name: "ÉQUIPE", score: 0, players: [] };
            let totalScore = 0;
            const playersList = [];

            for (const pId of team.players) {
                const idStr = pId.toString();
                const lives = battle.viesActuelles.get(idStr) ?? 0;
                totalScore += lives;

                const playerDoc = await Player.findById(pId);
                playersList.push({
                    id: idStr,
                    name: playerDoc ? playerDoc.username : "Joueur",
                    lives: lives
                });
            }

            return {
                name: team.name,
                score: totalScore,
                players: playersList
            };
        }

        const rawTeam1 = await formatTeam(battle.teams?.team1);
        const rawTeam2 = await formatTeam(battle.teams?.team2);

        let rawP1Data = null;
        let rawP2Data = null;

        const hasMatch = battle.currentMatch && (battle.currentMatch.p1 || battle.currentMatch.p2);
        const lastHistory = battle.history?.length > 0 ? battle.history[battle.history.length - 1] : null;

        const p1Id = hasMatch ? battle.currentMatch.p1 : lastHistory?.p1_id;
        const p2Id = hasMatch ? battle.currentMatch.p2 : lastHistory?.p2_id;

        if (p1Id && p2Id) {
            const p1Player = await Player.findById(p1Id);
            const p2Player = await Player.findById(p2Id);

            if (p1Player && p2Player) {
                rawP1Data = {
                    id: p1Player.id,
                    name: p1Player.username,
                    lives: battle.viesActuelles.get(p1Player.id.toString()) ?? 0,
                    char: battle.currentMatch?.char1 || null
                };

                rawP2Data = {
                    id: p2Player.id,
                    name: p2Player.username,
                    lives: battle.viesActuelles.get(p2Player.id.toString()) ?? 0,
                    char: battle.currentMatch?.char2 || null
                };
            }
        }
        
        let isPhoenixMatch = hasMatch ? battle.currentMatch?.isPhoenix : (lastHistory?.isPhoenix || false);

        // --- CALCULS DE FIN DE BATAILLE (VICTOIRE & MVP) ---
        let winningTeamData = null;
        let mvpData = null;

        // Dans src/utils/overlayServer.js, lors du calcul de fin de bataille :
        if (battle.status === 'finished' && battle.teams?.team1 && battle.teams?.team2) {
            const t1Lives = rawTeam1.score;
            const isT1Winner = t1Lives > 0;
            const winTeam = isT1Winner ? battle.teams.team1 : battle.teams.team2;

            winningTeamData = { 
                name: winTeam.name,
                teamIndex: isT1Winner ? 1 : 2
             };

            const stats = {};
            const playerLastChar = {};

            battle.history.forEach(d => {
                if (d.winnerId) {
                    const wId = d.winnerId.toString();
                    stats[wId] = (stats[wId] || 0) + 1;
                    if (d.winnerChar) playerLastChar[wId] = d.winnerChar;
                }
                if (d.loserId && d.loserChar) {
                    playerLastChar[d.loserId.toString()] = d.loserChar;
                }
            });

            if (winTeam.players.length > 0) {
                const mvpId = winTeam.players.reduce((a, b) => (stats[a] || 0) > (stats[b] || 0) ? a : b, winTeam.players[0]);
                const mvpPlayer = await Player.findById(mvpId);

                mvpData = {
                    id: mvpId,
                    name: mvpPlayer ? mvpPlayer.username : "Guerrier",
                    kos: stats[mvpId] || 0,
                    char: playerLastChar[mvpId] || "lars"
                };

                // Liste des coéquipiers (hors MVP)
                const teammates = [];
                for (const pId of winTeam.players) {
                    if (pId.toString() !== mvpId.toString()) {
                        const pDoc = await Player.findById(pId);
                        teammates.push({
                            name: pDoc ? pDoc.username : "Joueur",
                            char: playerLastChar[pId.toString()] || "jin"
                        });
                    }
                }
                winningTeamData.teammates = teammates;
            }
        }

        const overlayData = JSON.stringify({
            active: true,
            status: battle.status,
            maxLives: battle.viesParJoueur,
            team1: isSwapped ? rawTeam2 : rawTeam1,
            team2: isSwapped ? rawTeam1 : rawTeam2,
            p1: isSwapped ? rawP2Data : rawP1Data,
            p2: isSwapped ? rawP1Data : rawP2Data,
            stage: battle.currentMatch?.stage || null,
            isPhoenix: isPhoenixMatch,
            winningTeam: winningTeamData,
            mvp: mvpData
        });

        wss.clients.forEach(client => {
            if (client.readyState === 1) { // WebSocket.OPEN
                client.send(overlayData);
            }
        });
    } catch (error) {
        console.error("Erreur lors de la diffusion WebSocket :", error);
    }
}

module.exports = { initWebSocket, broadcastOverlayData, toggleSwapSides };