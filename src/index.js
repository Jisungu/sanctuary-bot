require('dotenv').config();
const { Client, GatewayIntentBits, Collection, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const mongoose = require('mongoose');
const fs = require('node:fs');
const path = require('node:path');
const Battle = require('./models/Battle');
const { characters, stages } = require('./utils/data'); 

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

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('✅ Cosmos connecté au Sanctuaire'))
    .catch(err => console.error('❌ Erreur DB :', err));

async function sendBattleStatus(interaction) {
    const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
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
            name: `🏟️ Lieu du combat : ${stageLabel}`,
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
        const { customId } = interaction;

        if (['join_battle', 'leave_battle', 'confirm_presence', 'force_presence'].includes(customId)) {
            try {
                await interaction.deferUpdate();

                const battle = await Battle.findOne({ 
                    status: { $in: ['registration', 'calling'] } 
                }).sort({ createdAt: -1 });

                if (!battle) return;

                if (customId === 'join_battle') {
                    if (!battle.participants.includes(interaction.user.id)) battle.participants.push(interaction.user.id);
                } else if (customId === 'leave_battle') {
                    battle.participants = battle.participants.filter(id => id !== interaction.user.id);
                } else if (customId === 'confirm_presence') {
                    if (!battle.presents.includes(interaction.user.id)) battle.presents.push(interaction.user.id);
                } else if (customId === 'force_presence') {
                    if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) return;

                    battle.presents = [...battle.participants];
                }

                await battle.save();

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
        
       if (customId.startsWith('win_')) {
            try {
                await interaction.deferUpdate();

                const battle = await Battle.findOne({ status: 'started' }).sort({ createdAt: -1 });
                if (!battle || !battle.currentMatch) return;

                const isP1Winner = customId === 'win_p1';
                const winnerId = isP1Winner ? battle.currentMatch.p1 : battle.currentMatch.p2;
                const loserId = isP1Winner ? battle.currentMatch.p2 : battle.currentMatch.p1;
                
                battle.history.push({ 
                    winnerId, 
                    loserId, 
                    winnerChar: isP1Winner ? battle.currentMatch.char1 : battle.currentMatch.char2, 
                    loserChar: isP1Winner ? battle.currentMatch.char2 : battle.currentMatch.char1, 
                    stage: battle.currentMatch.stage,
                    timestamp: new Date() 
                });

                let currentLives = battle.viesActuelles.get(loserId.toString()) ?? 0;
                battle.viesActuelles.set(loserId.toString(), Math.max(0, currentLives - 1));
                battle.currentMatch = undefined; 
                battle.markModified('viesActuelles');

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
                        return `${lives > 0 ? '🛡️' : '💀'} <@${id}> : ${'❤️'.repeat(lives)}${'🖤'.repeat(battle.viesParJoueur - lives)}`;
                    }).join('\n');

                    await battle.save();
                    await interaction.deleteReply();

                    const victoryEmbed = new EmbedBuilder()
                        .setTitle('🏆 LE SANCTUAIRE A SES VAINQUEURS')
                        .setDescription(`L'armée **${winningTeam.name}** a triomphé !`)
                        .setColor('#f1c40f')
                        .addFields(
                            { name: `👥 Membres de l'armée ${winningTeam.name}`, value: winnersList, inline: false },
                            { name: '🎖️ Étoile Polaire (MVP)', value: `<@${mvpId}> avec **${stats[mvpId] || 0}** victoires`, inline: false }
                        );
                    return await interaction.channel.send({ embeds: [victoryEmbed] });
                }

                await battle.save();
                await interaction.deleteReply();
                await sendBattleStatus(interaction);
            } catch (err) { console.error("Erreur victoire:", err); }
        }
    }
});

client.login(process.env.TOKEN);