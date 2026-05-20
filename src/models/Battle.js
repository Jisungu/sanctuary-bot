const mongoose = require('mongoose');

const battleSchema = new mongoose.Schema({
    guildId: String,
    channelId: String,
    messageId: String,
    status: { 
        type: String, 
        enum: ['registration', 'calling', 'started', 'finished'], 
        default: 'registration' 
    },
    dateTournoi: String,
    heureTournoi: String,
    
    participants: [String], 
    presents: [String],

    teams: {
        team1: {
            name: String,
            players: [String],
            totalLevel: Number
        },
        team2: {
            name: String,
            players: [String],
            totalLevel: Number
        }
    },

    currentMatch: {
        p1: String,
        p2: String,
        char1: String, 
        char2: String, 
        stage: String 
    },

    viesParJoueur: Number,
    viesActuelles: {
        type: Map,
        of: Number,
        default: {}
    },

    history: [{
        winnerId: String,
        loserId: String,
        winnerChar: String,
        loserChar: String,
        stage: String,
        isPhoenix: { type: Boolean, default: false },
        timestamp: { type: Date, default: Date.now }
    }],
    phoenixUsed: { type: Boolean, default: false }
}, { timestamps: true });

module.exports = mongoose.model('Battle', battleSchema);