let currentParticipants = null;
let lastBattleInteraction = null;
let presents = null;

module.exports = {
    getParticipants: () => currentParticipants,
    setParticipants: (set) => { currentParticipants = set; },
    
    getInteraction: () => lastBattleInteraction,
    setInteraction: (inter) => { lastBattleInteraction = inter; },

    getDate: () => currentDate,
    setDate: (date) => { currentDate = date; },

    getHour: () => currentHeure,
    setHour: (heure) => { currentHeure = heure; },

    getPresents: () => presents,
    setPresents: (p) => { presents = p; },
    
    clearAll: () => {
        currentParticipants = null;
        lastBattleInteraction = null;
        currentDate = null;
        currentHeure = null;
    }
};