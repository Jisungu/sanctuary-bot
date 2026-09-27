// models/Player.js
const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    _id: String, // Discord User ID
    username: String,
    level: { type: Number, required: true },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        tournamentsPlayed: { type: Number, default: 0 },
        mvpCount: { type: Number, default: 0 },
        mostPlayedStage: { type: String, default: null },
        charactersPlayed: {
            type: Map,
            of: Number,
            default: {}
        },
        opponentsCount: { // Pour le sac de frappe et le plus grand mur
            type: Map,
            of: {
                wins: { type: Number, default: 0 },
                losses: { type: Number, default: 0 }
            },
            default: {}
        },
        characterMatchups: { // Pour le meilleur / pire matchup
            type: Map,
            of: {
                wins: { type: Number, default: 0 },
                losses: { type: Number, default: 0 }
            },
            default: {}
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);