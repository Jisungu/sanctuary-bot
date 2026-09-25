const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const Player = require('../models/Player');
const Battle = require('../models/Battle');
const { broadcastOverlayData } = require('../utils/overlayServer');

require('dotenv').config();

// Utilitaire sécurisé pour récupérer ou créer un rôle
async function getOrCreateTeamRole(guild, teamName, color) {
    const roles = await guild.roles.fetch();
    let role = roles.find(r => r.name.toLowerCase() === teamName.toLowerCase());
    
    if (!role) {
        role = await guild.roles.create({
            name: teamName,
            color: color,
            reason: 'Rôle d\'équipe automatique pour la Team Battle'
        });
    }
    return role;
}

module.exports = {
    data: new SlashCommandBuilder()
        .setName('battle-run')
        .setDescription('Répartit les Chevaliers et initialise leurs armures.')
        .addStringOption(option => option.setName('equipe1').setDescription('Nom de la Team 1').setRequired(true))
        .addStringOption(option => option.setName('equipe2').setDescription('Nom de la Team 2').setRequired(true))
        .addIntegerOption(option => 
            option.setName('vies')
                .setDescription('Nombre de vies (éclats de Cosmos)')
                .setMinValue(1)
                .setRequired(true))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        await interaction.deferReply({ ephemeral: false });

        const team1Name = interaction.options.getString('equipe1');
        const team2Name = interaction.options.getString('equipe2');
        const viesInitiales = interaction.options.getInteger('vies');
        const categoryId = process.env.CATEGORY_VOCAL_ID; 

        try {
            const battle = await Battle.findOne({ guildId: interaction.guildId, status: 'calling' }).sort({ createdAt: -1 });

            if (!battle) return interaction.editReply("⚠️ Aucune phase d'appel n'est active.");

            const registeredPlayers = await Player.find({ _id: { $in: battle.presents } });
            
            if (registeredPlayers.length !== battle.presents.length) {
                const registeredIds = registeredPlayers.map(p => p._id);
                const missingPlayers = battle.presents.filter(id => !registeredIds.includes(id)).map(id => `<@${id}>`);
                
                await interaction.deleteReply();
                return interaction.followUp({ 
                    content: `❌ **Interruption !** Les chevaliers suivants n'ont pas de rang défini :\n${missingPlayers.join(', ')}`, 
                    ephemeral: true 
                });
            }

            // Répartition des équipes
            const sortedPlayers = registeredPlayers.sort((a, b) => b.level - a.level);
            const team1 = []; const team2 = [];
            let p1Lvl = 0; let p2Lvl = 0;

            for (const p of sortedPlayers) {
                if (p1Lvl <= p2Lvl) { team1.push(p); p1Lvl += p.level; } 
                else { team2.push(p); p2Lvl += p.level; }
            }

            // 1. CRÉATION DES RÔLES D'ÉQUIPE
            const roleTeam1 = await getOrCreateTeamRole(interaction.guild, team1Name, '#3498db');
            const roleTeam2 = await getOrCreateTeamRole(interaction.guild, team2Name, '#e74c3c');

            // 2. ASSIGNATION DES RÔLES AUX JOUEURS
            for (const p of team1) {
                const member = await interaction.guild.members.fetch(p._id).catch(() => null);
                if (member && roleTeam1) await member.roles.add(roleTeam1.id).catch(err => console.error(`Erreur rôle T1 (${p._id}):`, err));
            }
            for (const p of team2) {
                const member = await interaction.guild.members.fetch(p._id).catch(() => null);
                if (member && roleTeam2) await member.roles.add(roleTeam2.id).catch(err => console.error(`Erreur rôle T2 (${p._id}):`, err));
            }

            // 3. CONSTRUCTION DYNAMIQUE DES PERMISSIONS
            const basePermissionOverwrites = [
                {
                    id: interaction.guild.roles.everyone,
                    allow: [PermissionFlagsBits.ViewChannel],
                    deny: [PermissionFlagsBits.Connect]
                }
            ];

            // Owner du serveur
            const ownerMember = await interaction.guild.members.fetch(interaction.guild.ownerId).catch(() => null);
            if (ownerMember) {
                basePermissionOverwrites.push({
                    id: ownerMember.user,
                    allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                });
            }

            // Rôles Staff
            const staffRoleNames = ['Admin', 'TO', 'Sanctuaire'];
            const allRoles = await interaction.guild.roles.fetch();

            staffRoleNames.forEach(roleName => {
                const foundRole = allRoles.find(r => r.name.toLowerCase() === roleName.toLowerCase());
                if (foundRole) {
                    basePermissionOverwrites.push({
                        id: foundRole,
                        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak, PermissionFlagsBits.MuteMembers]
                    });
                }
            });

            // 4. CRÉATION DES SALONS VOCAUX PRIVÉS
            let voice1Id = null;
            let voice2Id = null;

            const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);

            if (category && roleTeam1 && roleTeam2) {
                try {
                    // Salon Vocal Équipe 1
                    const chan1 = await interaction.guild.channels.create({
                        name: `🛡️ ${team1Name.toUpperCase()}`,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: [
                            ...basePermissionOverwrites,
                            {
                                id: roleTeam1, // Passe directement l'objet Role complet
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                            }
                        ]
                    });

                    // Salon Vocal Équipe 2
                    const chan2 = await interaction.guild.channels.create({
                        name: `🔱 ${team2Name.toUpperCase()}`,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                        permissionOverwrites: [
                            ...basePermissionOverwrites,
                            {
                                id: roleTeam2, // Passe directement l'objet Role complet
                                allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
                            }
                        ]
                    });

                    voice1Id = chan1.id;
                    voice2Id = chan2.id;
                } catch (e) { 
                    console.error("Erreur création salons vocaux :", e); 
                }
            }

            // 5. SAUVEGARDE DE LA BATTLE & OVERLAY
            battle.status = 'started';
            battle.viesParJoueur = viesInitiales;
            battle.presents.forEach(id => battle.viesActuelles.set(id.toString(), viesInitiales));
            battle.teams = {
                team1: { name: team1Name, players: team1.map(p => p._id), totalLevel: p1Lvl, voiceChannelId: voice1Id },
                team2: { name: team2Name, players: team2.map(p => p._id), totalLevel: p2Lvl, voiceChannelId: voice2Id }
            };
            battle.markModified('viesActuelles');
            await battle.save();
            await broadcastOverlayData();

            const runEmbed = new EmbedBuilder()
                .setTitle('🏛️ Les Camps de la Guerre Sainte sont scellés')
                .setDescription(
                    `Le destin a parlé. Les rôles et salons vocaux sécurisés ont été érigés dans le Sanctuaire.\n\n` +
                    `📜 **Chroniques du Sanctuaire**\n` +
                    `Chaque guerrier dispose de **${viesInitiales} éclats de Cosmos** (vies).`
                )
                .setColor('#3498db')
                .addFields(
                    { name: `🔵 Armée de ${team1Name}`, value: team1.map(p => `<@${p._id}>`).join('\n'), inline: true },
                    { name: `🔴 Légion de ${team2Name}`, value: team2.map(p => `<@${p._id}>`).join('\n'), inline: true }
                )
                .setFooter({ text: 'Rejoignez vos quartiers ! Utilisez /battle-toss pour le premier assaut.' })
                .setTimestamp();

            return interaction.editReply({ embeds: [runEmbed] });

        } catch (error) {
            console.error(error);
            return interaction.editReply("❌ Une erreur cosmique a empêché le lancement.");
        }
    }
};