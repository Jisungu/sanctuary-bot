require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const registerControlPanelRoutes = require('./utils/controlPanel');

const connectDB = require('./utils/db');
const Battle = require('./models/Battle');
const Player = require('./models/Player');
const { initWebSocket, broadcastOverlayData } = require('./utils/overlayServer');
const { addPlayers, removePlayers, getBattleFields } = require('./utils/battleRegistration');
const { handlePhoenixRequestInteraction } = require('./utils/phoenixRequests');
const {
    buildBattleStatusEmbed,
    buildKnockoutEmbed,
    buildBattleVictoryEmbed,
    buildPhoenixAvailabilityEmbed
} = require('./utils/battleStatus');
const { getEligiblePhoenixTeams, resolvePhoenixMatch } = require('./utils/phoenix');

// 1. CONNEXION MONGODB
mongoose.connect(process.env.MONGODB_URI);

// 2. CONFIGURATION DU SERVEUR EXPRESS & WEBSOCKET UNIFIÉ
const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '16kb' }));

// Déclare le dossier 'public' pour rendre les overlays accessibles
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/', (req, res) => {
    res.send('🤖 Bot launched & Overlay running!');
});

app.get('/score.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'score.html'));
});

app.get('/recap.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'recap.html'));
});

app.get('/rules.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'rules.html'));
});

app.get('/coin.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'coin.html'));
});

// Route de check de santé pour Render
app.get('/', (req, res) => {
    res.status(200).send('🤖 Bot & Overlay unifiés en ligne !');
});

const server = http.createServer(app);

// Initialisation du serveur WebSocket attaché au même serveur HTTP
initWebSocket(server);

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
    console.log(`🚀 Serveur HTTP & WebSocket démarré sur le port ${PORT}`);
});

// 3. INITIALISATION DU BOT DISCORD
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.MessageContent
    ]
});

registerControlPanelRoutes(app, client);

client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if ('data' in command && 'execute' in command) client.commands.set(command.data.name, command);
}

connectDB();

// --- FONCTIONS UTILITAIRES ---

async function sendBattleStatus(interaction) {
    const battle = await Battle.findOne({
        guildId: interaction.guildId,
        status: { $in: ['started', 'finished'] }
    }).sort({ createdAt: -1 });
    if (!battle) return;

    await interaction.channel.send({ embeds: [buildBattleStatusEmbed(battle)] });
}

async function getOrCreateTBRole(guild) {
    let role = guild.roles.cache.find(r => r.name === 'TeamBattle');
    if (!role) {
        role = await guild.roles.create({
            name: 'TeamBattle',
            colors: { primaryColor: '#e67e22' },
            reason: 'Rôle automatique pour les participants de la Team Battle'
        });
    }
    return role;
}

// 4. GESTION DES INTERACTIONS (Slash Commands, Autocomplete, Boutons)
client.on('interactionCreate', async interaction => {
    try {
    if (await handlePhoenixRequestInteraction(interaction)) return;

    if (interaction.isAutocomplete()) {
        const command = client.commands.get(interaction.commandName);
        if (command) await command.autocomplete(interaction);
    }
    
    if (interaction.isChatInputCommand()) {
        const command = client.commands.get(interaction.commandName);
        if (command) await command.execute(interaction);
    }

    if (interaction.isButton()) {
        const { customId, guildId, user } = interaction;
        if (['join_battle', 'leave_battle', 'confirm_presence', 'force_presence'].includes(customId)) {
            try {
                const activeBattle = await Battle.findOne({ 
                    guildId,
                    status: { $in: ['registration', 'calling'] },
                    isDirect: { $ne: true }
                }).sort({ createdAt: -1 });

                if (!activeBattle) return interaction.deferUpdate();

                // Bloquer la présence si le joueur n'est pas inscrit
                if (customId === 'confirm_presence' && !activeBattle.participants.includes(user.id)) {
                    return interaction.reply({ 
                        content: "❌ **Accès refusé !** Tu ne peux pas confirmer ta présence car tu ne t'es pas inscrit lors du sondage initial.", 
                        ephemeral: true 
                    });
                }

                await interaction.deferUpdate();

                const tbRole = await getOrCreateTBRole(interaction.guild);
                let battle;

                // --- GESTION DES INSCRIPTIONS ET DU RÔLE ---
                if (customId === 'join_battle') {
                    const { activeIds, waitlistedIds } = addPlayers(activeBattle, [user.id]);
                    await activeBattle.save();
                    battle = activeBattle;

                    if (activeIds.length) {
                        try {
                            if (!interaction.member.roles.cache.has(tbRole.id)) {
                                await interaction.member.roles.add(tbRole);
                            }
                        } catch (roleErr) {
                            console.error("Erreur lors de l'ajout du rôle TeamBattle :", roleErr);
                        }
                    }

                    if (waitlistedIds.length) {
                        await interaction.followUp({
                            content: `⏳ La bataille est complète. Tu as été ajouté(e) en **position ${battle.waitlist.length}** sur la liste d'attente.`,
                            ephemeral: true
                        });
                    } else if (!activeIds.length) {
                        await interaction.followUp({
                            content: battle.participants.includes(user.id)
                                ? "✅ Tu es déjà inscrit(e) à cette bataille."
                                : `⏳ Tu es déjà en liste d'attente (position ${battle.waitlist.indexOf(user.id) + 1}).`,
                            ephemeral: true
                        });
                    }
                } else if (customId === 'leave_battle') {
                    const { promotedIds } = removePlayers(activeBattle, [user.id]);
                    await activeBattle.save();
                    battle = activeBattle;

                    try {
                        if (interaction.member.roles.cache.has(tbRole.id)) {
                            await interaction.member.roles.remove(tbRole);
                        }
                    } catch (roleErr) {
                        console.error("Erreur lors du retrait du rôle TeamBattle :", roleErr);
                    }

                    for (const promotedId of promotedIds) {
                        try {
                            const member = await interaction.guild.members.fetch(promotedId);
                            await member.roles.add(tbRole);
                        } catch (roleErr) {
                            console.error(`Erreur lors de l'ajout du rôle TeamBattle au joueur promu ${promotedId} :`, roleErr);
                        }
                    }

                    if (!activeBattle.participants.includes(user.id) && !activeBattle.waitlist.includes(user.id)) {
                        await interaction.followUp({
                            content: promotedIds.length
                                ? `✅ Tu as quitté la bataille. <@${promotedIds[0]}> rejoint les inscrits depuis la liste d'attente.`
                                : "✅ Tu as quitté la bataille.",
                            ephemeral: true
                        });
                    }
                } else if (customId === 'confirm_presence') {
                    battle = await Battle.findOneAndUpdate(
                        { _id: activeBattle._id },
                        { $addToSet: { presents: user.id } },
                        { new: true }
                    );
                } else if (customId === 'force_presence') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return interaction.followUp({
                            content: "❌ Seuls les administrateurs peuvent confirmer la présence de tous les joueurs.",
                            ephemeral: true
                        });
                    }
                    battle = await Battle.findOneAndUpdate(
                        { _id: activeBattle._id },
                        { $set: { presents: activeBattle.participants } },
                        { new: true }
                    );
                }

                const originalEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(originalEmbed);
                updatedEmbed.setFields(getBattleFields(battle));

                await interaction.editReply({ embeds: [updatedEmbed] });
                
            } catch (err) { console.error("Erreur bouton Sanctuaire:", err); }
        }
                
        // Gestion des victoires
        if (customId.startsWith('win_')) {
            try {
                const battle = await Battle.findOne({ guildId, status: 'started' }).sort({ createdAt: -1 });
                if (!battle?.currentMatch?.p1 || !battle.currentMatch.p2) return;

                const isAdmin = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
                const isPlayer = [battle.currentMatch.p1, battle.currentMatch.p2].includes(user.id);

                if (!isAdmin && !isPlayer) {
                    return interaction.reply({ 
                        content: "❌ Seuls les Chevaliers engagés dans ce duel ou le Grand Pope peuvent sceller l'issue du combat.", 
                        ephemeral: true 
                    });
                }

                await interaction.deferUpdate();

                const isP1Winner = customId === 'win_p1';
                const winnerId = isP1Winner ? battle.currentMatch.p1 : battle.currentMatch.p2;
                const loserId = isP1Winner ? battle.currentMatch.p2 : battle.currentMatch.p1;
                
                battle.history.push({ 
                    p1_id: battle.currentMatch.p1,
                    p2_id: battle.currentMatch.p2,
                    winnerId, 
                    loserId, 
                    winnerChar: isP1Winner ? battle.currentMatch.char1 : battle.currentMatch.char2, 
                    loserChar: isP1Winner ? battle.currentMatch.char2 : battle.currentMatch.char1, 
                    stage: battle.currentMatch.stage,
                    isPhoenix: false,
                    timestamp: new Date() 
                });

                let currentLives = battle.viesActuelles.get(loserId.toString()) ?? 0;
                const winnerChar = isP1Winner ? battle.currentMatch.char1 : battle.currentMatch.char2;
                const loserChar = isP1Winner ? battle.currentMatch.char2 : battle.currentMatch.char1;
                battle.viesActuelles.set(loserId.toString(), Math.max(0, currentLives - 1));
                battle.currentMatch = undefined; 
                battle.markModified('viesActuelles');

                if (Math.max(0, currentLives - 1) === 0) {
                    await interaction.channel.send({
                        embeds: [buildKnockoutEmbed(battle, loserId)]
                    });
                }

                const t1Lives = battle.teams.team1.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                const t2Lives = battle.teams.team2.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);

                const battleFinished = t1Lives === 0 || t2Lives === 0;
                if (battleFinished) {
                    battle.status = 'finished';
                }

                await battle.save();
                await broadcastOverlayData();

                await Promise.all([
                    Player.findByIdAndUpdate(winnerId, {
                        $inc: {
                            'stats.wins': 1,
                            [`stats.charactersPlayed.${winnerChar}`]: 1
                        }
                    }, { upsert: true }),
                    Player.findByIdAndUpdate(loserId, {
                        $inc: {
                            'stats.losses': 1,
                            [`stats.charactersPlayed.${loserChar}`]: 1
                        }
                    }, { upsert: true })
                ]);

                if (battleFinished) {
                    await interaction.deleteReply();
                    await sendBattleStatus(interaction);

                    // --- LES RÔLES ET LES SALONS VOCAUX SONT CONSERVÉS ---

                    return await interaction.channel.send({
                        embeds: [buildBattleVictoryEmbed(battle)]
                    });
                }
                
                await interaction.deleteReply();
                await sendBattleStatus(interaction);

                const eligiblePhoenixTeams = getEligiblePhoenixTeams(battle);
                if (eligiblePhoenixTeams.length) {
                    await interaction.channel.send({
                        embeds: [buildPhoenixAvailabilityEmbed(battle, eligiblePhoenixTeams)]
                    });
                }

            } catch (err) { console.error("Erreur victoire:", err); }
        }

        if (interaction.customId.startsWith('phoenix_win_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: "📜 Seul le Grand Pope (TO/Admin) peut sceller ce destin.", ephemeral: true });
            }

            await interaction.deferUpdate();

            const parts = interaction.customId.split('_');
            const winnerPosition = parts[2];
            const winnerId = parts[3];

            try {
                const battle = await Battle.findOne({ guildId, status: 'started' }).sort({ createdAt: -1 });
                if (!battle?.currentMatch?.isPhoenix) return;
                const match = battle.currentMatch;
                const expectedWinnerId = winnerPosition === 'p1' ? match.p1 : match.p2;
                if (!['p1', 'p2'].includes(winnerPosition) || expectedWinnerId !== winnerId) return;

                const resolution = resolvePhoenixMatch(battle, winnerId);
                const originalEmbed = interaction.message.embeds[0];
                await battle.save();
                await broadcastOverlayData();

                const resultDescription = resolution.initiatorWon
                    ? `**Le miracle du Phénix s'accomplit !**\n\n` +
                        `<@${resolution.initiatorId}> revient dans la bataille avec **1 vie**.\n\n` +
                        (resolution.opponentLivesBefore > 0
                            ? `<@${resolution.opponentId}> perd une vie et en conserve **${resolution.opponentLivesAfter}**.`
                            : `<@${resolution.opponentId}> était déjà éliminé et le reste.`) +
                        `\n\nLe droit au Phénix de l’équipe initiatrice est consommé.`
                    : `**Le joueur choisi par l'équipe initiatrice ne revient pas dans la bataille.**\n\n` +
                        (resolution.opponentLivesBefore === 0
                            ? `<@${resolution.opponentId}> renaît avec **1 vie**. Cette résurrection ne consomme pas le droit au duel du Phénix de son équipe.`
                            : `<@${resolution.opponentId}> conserve ses **${resolution.opponentLivesAfter}** vie(s).`) +
                        `\n\nLe droit au Phénix de l’équipe initiatrice est consommé.`;
                const updatedEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle(resolution.initiatorWon
                        ? '🔥 LE PHOENIX RENAÎT DE SES CENDRES ! 🔥'
                        : '⚔️ LE DUEL DU PHÉNIX EST SCELLÉ')
                    .setDescription(resultDescription)
                    .setFields([])
                    .setColor('#e67e22')
                    .setTimestamp()
                    .setFooter({ text: 'Le Grand Pope scelle le destin !' });

                await interaction.message.edit({ embeds: [updatedEmbed], components: [] });
                if (resolution.initiatorWon
                    && resolution.opponentLivesBefore > 0
                    && resolution.opponentLivesAfter === 0) {
                    await interaction.channel.send({
                        embeds: [buildKnockoutEmbed(battle, resolution.opponentId)]
                    });
                }

                await sendBattleStatus(interaction);
                if (battle.status === 'finished') {
                    await interaction.channel.send({
                        embeds: [buildBattleVictoryEmbed(battle)]
                    });
                } else {
                    const eligiblePhoenixTeams = getEligiblePhoenixTeams(battle);
                    if (eligiblePhoenixTeams.length) {
                        await interaction.channel.send({
                            embeds: [buildPhoenixAvailabilityEmbed(battle, eligiblePhoenixTeams)]
                        });
                    }
                }

            } catch (error) {
                console.error("Erreur lors du phoenix-conversion :", error);
                return;
            }
        }
    }
    } catch (error) {
        console.error("Erreur inattendue lors du traitement d'une interaction :", error);

        if (interaction.isAutocomplete()) {
            try {
                await interaction.respond([]);
            } catch (responseError) {
                console.error("Impossible de répondre à l'autocomplétion après une erreur :", responseError);
            }
            return;
        }

        try {
            const errorResponse = {
                content: "❌ Une erreur inattendue est survenue. Réessaie dans quelques instants.",
                ephemeral: true
            };

            if (interaction.deferred || interaction.replied) {
                await interaction.followUp(errorResponse);
            } else {
                await interaction.reply(errorResponse);
            }
        } catch (responseError) {
            console.error("Impossible d'envoyer le message d'erreur à l'interaction :", responseError);
        }
    }
});

// 5. CONNEXION DU BOT DISCORD
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);