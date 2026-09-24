const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    _id: String, // Discord User ID
    username: String,
    level: { type: Number, required: true },
    stats: {
        wins: { type: Number, default: 0 },
        losses: { type: Number, default: 0 },
        phoenixCount: { type: Number, default: 0 },
        charactersPlayed: {
            type: Map,
            of: Number,
            default: {}
        }
    }
}, { timestamps: true });

module.exports = mongoose.model('Player', playerSchema);