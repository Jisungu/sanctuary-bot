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

        // Application de l'inversion à l'envoi uniquement (BDD intacte)
        const overlayData = JSON.stringify({
            active: true,
            maxLives: battle.viesParJoueur,
            team1: isSwapped ? rawTeam2 : rawTeam1,
            team2: isSwapped ? rawTeam1 : rawTeam2,
            p1: isSwapped ? rawP2Data : rawP1Data,
            p2: isSwapped ? rawP1Data : rawP2Data,
            stage: battle.currentMatch?.stage || null,
            isPhoenix: isPhoenixMatch
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