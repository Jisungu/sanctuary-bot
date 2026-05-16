const mongoose = require('mongoose');

const playerSchema = new mongoose.Schema({
    _id: { type: String, required: true }, 
    username: String,
    level: { 
        type: Number, 
        default: null,
        min: 1,
        max: 5
    }
}, { _id: false });

module.exports = mongoose.model('Player', playerSchema);