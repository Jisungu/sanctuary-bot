require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const http = require('http');
const mongoose = require('mongoose');

const connectDB = require('./utils/db');
const Battle = require('./models/Battle');
const Player = require('./models/Player');
const { characters, stages } = require('./utils/data'); 
const { initWebSocket, broadcastOverlayData } = require('./utils/overlayServer');

// 1. CONNEXION MONGODB
mongoose.connect(process.env.MONGODB_URI);

// 2. CONFIGURATION DU SERVEUR EXPRESS & WEBSOCKET UNIFIÉ
const app = express();
app.disable('x-powered-by');

// Déclare le dossier 'public' pour rendre score.html accessible
app.use(express.static(path.join(__dirname, '..', 'public')));

// Route racine : renvoie directement le fichier d'overlay
app.get('/score.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'score.html'));
});

app.get('/recap.html', (req, res) => {
    res.sendFile(path.join(__dirname, '..', 'public', 'recap.html'));
});

// Route de check de santé pour Render
app.get('/health', (req, res) => {
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
        GatewayIntentBits.MessageContent
    ]
});

client.commands = new Collection();
const commandFiles = fs.readdirSync(path.join(__dirname, 'commands')).filter(file => file.endsWith('.js'));
for (const file of commandFiles) {
    const command = require(`./commands/${file}`);
    if ('data' in command && 'execute' in command) client.commands.set(command.data.name, command);
}

connectDB();

async function sendBattleStatus(interaction) {
    const battle = await Battle.findOne({ guildId: interaction.guildId, status: 'started' }).sort({ createdAt: -1 });
    if (!battle) return;

    const embed = new EmbedBuilder()
        .setTitle('⚔️ Chroniques du Sanctuaire')
        .setColor('#E67E22')
        .setTimestamp();

    const lastDuel = battle.history[battle.history.length - 1];
    if (lastDuel) {
        const charWinLabel = characters.find(c => c.value === lastDuel.winnerChar)?.label || lastDuel.winnerChar;
        const charLosLabel = characters.find(c => c.value === lastDuel.loserChar)?.label || lastDuel.loserChar;
        const stageLabel = stages.find(s => s.value === lastDuel.stage)?.label || lastDuel.stage;

        embed.addFields({
            name: `Stage : ${stageLabel}`,
            value: `🏆 **Vainqueur :** <@${lastDuel.winnerId}> (${charWinLabel})\n💀 **Vaincu :** <@${lastDuel.loserId}> (${charLosLabel})`,
            inline: false
        });
    }

    const formatTeam = (players) => players.map(id => {
        const lives = battle.viesActuelles.get(id.toString()) || 0;
        return `<@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(battle.viesParJoueur - lives)}`;
    }).join('\n');

    embed.addFields(
        { name: '\u200B', value: '📜 **État actuel des forces**', inline: false },
        { name: `🔵 ${battle.teams.team1.name}`, value: formatTeam(battle.teams.team1.players), inline: true },
        { name: `🔴 ${battle.teams.team2.name}`, value: formatTeam(battle.teams.team2.players), inline: true }
    );

    await interaction.channel.send({ embeds: [embed] });
}

// 4. GESTION DES INTERACTIONS (Slash Commands, Autocomplete, Boutons)
client.on('interactionCreate', async interaction => {
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
                    status: { $in: ['registration', 'calling'] } 
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

                let updateQuery = {};

                if (customId === 'join_battle') {
                    updateQuery = { $addToSet: { participants: user.id } };
                } else if (customId === 'leave_battle') {
                    updateQuery = { $pull: { participants: user.id, presents: user.id } };
                } else if (customId === 'confirm_presence') {
                    updateQuery = { $addToSet: { presents: user.id } };
                } else if (customId === 'force_presence') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;
                    updateQuery = { $set: { presents: activeBattle.participants } };
                }

                const battle = await Battle.findOneAndUpdate(
                    { _id: activeBattle._id },
                    updateQuery,
                    { new: true }
                );

                const originalEmbed = interaction.message.embeds[0];
                const updatedEmbed = EmbedBuilder.from(originalEmbed);

                if (battle.status === 'calling') {
                    updatedEmbed.setFields(
                        { name: 'Guerriers attendus', value: battle.participants.map(id => `<@${id}>`).join('\n') || '...' },
                        { name: `Présents (${battle.presents.length}/${battle.participants.length})`, value: battle.presents.map(id => `<@${id}>`).join('\n') || 'En attente...' }
                    );
                } else {
                    updatedEmbed.setFields({
                        name: `📜 Chevaliers Inscrits (${battle.participants.length})`,
                        value: battle.participants.map(id => `<@${id}>`).join('\n') || '_Aucun guerrier n\'a encore répondu à l\'appel d\'Athéna._'
                    });
                }

                await interaction.editReply({ embeds: [updatedEmbed] });
                
            } catch (err) { console.error("Erreur bouton Sanctuaire:", err); }
        }
        
        // Gestion des victoires
        if (customId.startsWith('win_')) {
            try {
                const battle = await Battle.findOne({ guildId, status: 'started' }).sort({ createdAt: -1 });
                if (!battle || !battle.currentMatch) return;

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
                battle.viesActuelles.set(loserId.toString(), Math.max(0, currentLives - 1));
                battle.currentMatch = undefined; 
                battle.markModified('viesActuelles');

                if (Math.max(0, currentLives - 1) === 0) {
                    const warriorPhoenixMatch = battle.history.find(match => match.winnerId === loserId.toString() && match.isPhoenix === true);

                    let koEmbed = new EmbedBuilder().setTimestamp();

                    if (warriorPhoenixMatch) {
                        koEmbed
                            .setTitle('🌋 EXTINCTION DÉFINITIVE - LE PHOENIX SE CONSUME')
                            .setDescription(
                                `**Le miracle a pris fin sous les yeux d'Athéna !**\n\n` +
                                `Le Chevalier <@${loserId}>, qui s'était pourtant arraché des griffes des Enfers grâce aux ailes du Phoenix, a vu ses dernières forces l'abandonner.\n\n` +
                                `Son armure tombe en cendres, et cette fois-ci, aucun Cosmos ne pourra le ramener...`
                            )
                            .setColor('#7f8c8d')
                            .addFields({ 
                                name: '🔮 Verdict du Grand Pope', 
                                value: `<@${loserId}> a brûlé son ultime étincelle de vie. Il est **définitivement éliminé**.` 
                            })
                            .setFooter({ text: 'Les cendres se dispersent sur le champ de bataille.' });
                    } else {
                        koEmbed
                            .setTitle('💀 EXTINCTION DE COSMOS - K.O.')
                            .setDescription(`Le Chevalier <@${loserId}> a vu son armure se briser ! Ses **${battle.viesParJoueur}** éclats de Cosmos se sont éteints...`)
                            .setColor('#c0392b')
                            .addFields({ 
                                name: '🔮 Statut du Guerrier', 
                                value: `<@${loserId}> est définitivement **ÉLIMINÉ** de cette Guerre Sainte.` 
                            })
                            .setFooter({ text: 'Son sacrifice restera gravé dans les chroniques du Sanctuaire.' });
                    }

                    await interaction.channel.send({ embeds: [koEmbed] });
                }

                const t1Lives = battle.teams.team1.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);
                const t2Lives = battle.teams.team2.players.reduce((acc, id) => acc + (battle.viesActuelles.get(id.toString()) || 0), 0);

                if (t1Lives === 0 || t2Lives === 0) {
                    battle.status = 'finished';
                    const winningTeam = t1Lives > 0 ? battle.teams.team1 : battle.teams.team2;
                    const stats = {};
                    battle.history.forEach(d => { stats[d.winnerId] = (stats[d.winnerId] || 0) + 1; });
                    const mvpId = Object.keys(stats).reduce((a, b) => stats[a] > stats[b] ? a : b, winningTeam.players[0]);

                    const winnersList = winningTeam.players.map(id => {
                        const lives = battle.viesActuelles.get(id.toString()) || 0;
                        const totalLives = battle.viesParJoueur;
        
                        if (lives > 0) {
                            return `🛡️ <@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(totalLives - lives)} (**Survivant**)`;
                        } else {
                            return `💀 <@${id}> :${'🖤'.repeat(totalLives)} (**Éliminé**)`;
                        }
                    }).join('\n');

                    await battle.save();
                    await broadcastOverlayData();
                    await interaction.deleteReply();

                    const victoryEmbed = new EmbedBuilder()
                        .setTitle('🏆 LE SANCTUAIRE A SES VAINQUEURS !')
                        .setDescription(`🔥 **L'armée ${winningTeam.name} a triomphé de la Guerre Sainte !** 🔥\n\nAprès d'âpres duels et des éclats de Cosmos mémorables, le destin s'est enfin scellé. L'arène s'apaise et les vainqueurs s'élèvent sous les acclamations du Sanctuaire !`)
                        .setColor('#f1c40f') 
                        .addFields(
                            { 
                                name: `👥 Chroniques de l'Armée ${winningTeam.name}`, 
                                value: winnersList, 
                                inline: false 
                            },
                            { 
                                name: '🎖️ Étoile Polaire — Le MVP du Tournoi', 
                                value: `⭐ <@${mvpId}> avec un total dévastateur de **${stats[mvpId] || 0}** victoires ! Son Cosmos a guidé son équipe vers les sommets.`, 
                                inline: false 
                            }
                        )
                        .setFooter({ text: 'La Guerre Sainte est terminée. Que la paix règne sur le Sanctuaire jusqu\'au prochain appel.' })
                        .setTimestamp();

                    return await interaction.channel.send({ embeds: [victoryEmbed] });
                }
                
                await battle.save();
                await broadcastOverlayData();
                await interaction.deleteReply();
                await sendBattleStatus(interaction);

                if (!battle.phoenixUsed) {
                    const t1Eliminated = battle.teams.team1.players.filter(id => (battle.viesActuelles.get(id.toString()) || 0) === 0).length;
                    const t2Eliminated = battle.teams.team2.players.filter(id => (battle.viesActuelles.get(id.toString()) || 0) === 0).length;

                    let phoenixTriggered = false;
                    let teamInNeed = null;

                    if (t1Eliminated === 2 && t2Eliminated === 1) {
                        phoenixTriggered = true;
                        teamInNeed = battle.teams.team1;
                    } else if (t2Eliminated === 2 && t1Eliminated === 1) {
                        phoenixTriggered = true;
                        teamInNeed = battle.teams.team2;
                    }

                    if (phoenixTriggered) {
                        const autoPhoenixEmbed = new EmbedBuilder()
                            .setTitle('🔥 L\'ALERTE DU PHOENIX S\'ÉVEILLE !')
                            .setDescription(
                                `⚡ **Le Cosmos d'Ikki embrase l'arène du Sanctuaire !** ⚡\n\n` +
                                `La structure des forces vacille. L'armée **${teamInNeed.name}** est en grande difficulté avec 2 Chevaliers tombés contre seulement 1 côté adverse.\n\n` +
                                `Les cieux s'ouvrent : le destin vous accorde un duel de repêchage !`
                            )
                            .setColor('#e67e22')
                            .addFields({ 
                                name: '📜 Procédure pour le TO', 
                                value: `Les équipes doivent choisir leur Chevalier déchu pour disputer le duel de la dernière chance.\n\n` +
                                    `➡️ **Lancez le match avec :**\n\`/battle-phoenix\`` 
                            })
                            .setTimestamp();

                        await interaction.channel.send({ embeds: [autoPhoenixEmbed] });
                    }
                }

                // Statistiques des joueurs
                const winChar = isP1Winner ? battle.currentMatch.char1 : battle.currentMatch.char2;
                const losChar = isP1Winner ? battle.currentMatch.char2 : battle.currentMatch.char1;

                await Player.findByIdAndUpdate(winnerId, {
                    $inc: { 
                        'stats.wins': 1,
                        [`stats.charactersPlayed.${winChar}`]: 1
                    }
                }, { upsert: true });

                await Player.findByIdAndUpdate(loserId, {
                    $inc: { 
                        'stats.losses': 1,
                        [`stats.charactersPlayed.${losChar}`]: 1
                    }
                }, { upsert: true });

            } catch (err) { console.error("Erreur victoire:", err); }
        }

        if (interaction.customId.startsWith('phoenix_win_')) {
            if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
                return interaction.reply({ content: "📜 Seul le Grand Pope (TO/Admin) peut sceller ce destin.", ephemeral: true });
            }

            await interaction.deferUpdate();

            const parts = interaction.customId.split('_');
            const winnerId = parts[3].toString(); 
            const loserId = parts[5].toString();

            try {
                const battle = await Battle.findOne({ guildId, status: 'started' }).sort({ createdAt: -1 });
                if (!battle) return;

                battle.phoenixUsed = true;

                const originalEmbed = interaction.message.embeds[0];
                const description = originalEmbed?.description || '';
                const stageLine = description.split('\n')[0] || '';
                const extractedStageLabel = stageLine.replace('**Stage :**', '').trim();
                
                const stageObj = stages.find(s => s.label.toLowerCase() === extractedStageLabel.toLowerCase());
                const stageValue = stageObj ? stageObj.value : 'enfers';

                const fields = originalEmbed?.fields || [];
                const p1Field = fields[0]?.value || '';
                const p2Field = fields[2]?.value || '';
                
                const extractedChar1Label = p1Field.split('\n')[1]?.replace(/\*/g, '').trim() || 'Chevalier';
                const extractedChar2Label = p2Field.split('\n')[1]?.replace(/\*/g, '').trim() || 'Chevalier';

                const char1Obj = characters.find(c => c.label.toLowerCase() === extractedChar1Label.toLowerCase());
                const char2Obj = characters.find(c => c.label.toLowerCase() === extractedChar2Label.toLowerCase());
                
                const char1Value = char1Obj ? char1Obj.value : extractedChar1Label;
                const char2Value = char2Obj ? char2Obj.value : extractedChar2Label;

                const isWinnerP1 = interaction.customId.includes(`phoenix_win_p1_`);
                const winnerChar = isWinnerP1 ? char1Value : char2Value;
                const loserChar = isWinnerP1 ? char2Value : char1Value;

                const p1_id = isWinnerP1 ? winnerId : loserId;
                const p2_id = isWinnerP1 ? loserId : winnerId;

                battle.history.push({ 
                    p1_id: p1_id,
                    p2_id: p2_id,
                    winnerId, 
                    loserId, 
                    winnerChar: winnerChar,
                    loserChar: loserChar,
                    stage: stageValue,
                    isPhoenix: true,
                    timestamp: new Date()
                });

                battle.viesActuelles.set(winnerId, 1);
                battle.markModified('viesActuelles');
                battle.currentMatch = undefined;
                await battle.save();
                await broadcastOverlayData();

                const updatedEmbed = EmbedBuilder.from(originalEmbed)
                    .setTitle('🔥 LE PHOENIX RENAÎT DE SES CENDRES ! 🔥')
                    .setDescription(
                        `**L'impossible s'est produit au cœur des Enfers !**\n\n` +
                        `Alors que tout espoir semblait perdu, le Cosmos d'Ikki a brisé les chaînes du destin. ` +
                        `Baigné dans les flammes de l'immortalité, **🏆 <@${winnerId}>** se relève, son armure restaurée et son Cosmos ravivé !\n\n` +
                        `⚡ Il réintègre la Guerre Sainte doté d'**1 éclat de Cosmos (❤️)** !\n\n` +
                        `💀 Malgré une lutte héroïque, <@${loserId}> est renvoyé dans les profondeurs du Tartare.`
                    )
                    .setFields([])
                    .setColor('#e67e22')
                    .setTimestamp()
                    .setFooter({ text: 'Le Grand Pope scelle le destin !' });

                await interaction.message.edit({ embeds: [updatedEmbed], components: [] });

                await sendBattleStatus(interaction);

            } catch (error) {
                console.error("Erreur lors du phoenix-conversion :", error);
                return;
            }
        }
    }
});

// 5. CONNEXION DU BOT DISCORD
client.login(process.env.DISCORD_TOKEN || process.env.TOKEN);