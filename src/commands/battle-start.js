const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const Player = require('../models/Player');
const Battle = require('../models/Battle');
const { broadcastOverlayData } = require('../utils/overlayServer');

require('dotenv').config();

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
        .setName('battle-start')
        .setDescription('Répartit les Chevaliers et initialise leurs armures.')
        .addStringOption(option => option.setName('equipe1').setDescription('Nom de la Team 1').setRequired(true))
        .addStringOption(option => option.setName('equipe2').setDescription('Nom de la Team 2').setRequired(true))
        .addIntegerOption(option => 
            option.setName('vies')
                .setDescription('Nombre de vies (éclats de Cosmos)')
                .setMinValue(1)
                .setRequired(true))
        .addBooleanOption(option =>
            option.setName('manuel')
                .setDescription('Voulez-vous composer l\'équipe 1 manuellement via un menu ? (Sinon : automatique)')
                .setRequired(false))
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const team1Name = interaction.options.getString('equipe1');
        const team2Name = interaction.options.getString('equipe2');
        const viesInitiales = interaction.options.getInteger('vies');
        const isManual = interaction.options.getBoolean('manuel') || false;

        try {
            const battle = await Battle.findOne({ guildId: interaction.guildId, status: 'calling' }).sort({ createdAt: -1 });

            if (!battle) return interaction.reply({ content: "⚠️ Aucune phase d'appel n'est active.", ephemeral: true });

            const registeredPlayers = await Player.find({ _id: { $in: battle.presents } });
            
            if (registeredPlayers.length !== battle.presents.length) {
                const registeredIds = registeredPlayers.map(p => p._id);
                const missingPlayers = battle.presents.filter(id => !registeredIds.includes(id)).map(id => `<@${id}>`);
                
                return interaction.reply({ 
                    content: `❌ **Interruption !** Les chevaliers suivants n'ont pas de rang défini :\n${missingPlayers.join(', ')}`, 
                    ephemeral: true 
                });
            }

            // SI MODE AUTOMATIQUE : On applique directement l'algorithme d'origine[cite: 6]
            if (!isManual) {
                await interaction.deferReply({ ephemeral: false });
                return await finalizeAndStartBattle(interaction, battle, team1Name, team2Name, viesInitiales, null);
            }

            // SI MODE MANUEL : Construction des options uniquement avec les joueurs inscrits
            const options = [];
            for (const p of registeredPlayers) {
                let displayName = p._id;
                try {
                    const member = await interaction.guild.members.fetch(p._id);
                    displayName = member.displayName || member.user.username;
                } catch (e) {
                    // Fallback si le membre ne peut pas être fetch
                }

                options.push({
                    label: displayName.substring(0, 100), // Limite Discord à 100 caractères
                    value: p._id
                });
            }

            // Discord limite le nombre de choix d'un menu déroulant à 25 maximum
            if (options.length === 0) {
                return interaction.reply({ content: "❌ Aucun joueur n'est inscrit dans la phase d'appel.", ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_team1_members')
                .setPlaceholder('Sélectionnez les membres de la Team 1')
                .setMinValues(1)
                .setMaxValues(Math.min(options.length, 25))
                .addOptions(options.slice(0, 25));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.reply({
                content: `🛡️ **Composition manuelle de la Team 1 (${team1Name})**\nVeuillez sélectionner les joueurs ci-dessous parmi les inscrits :`,
                components: [row],
                ephemeral: true
            });

            // Attente de la sélection du menu (limite de 2 minutes)
            const collectorFilter = i => i.user.id === interaction.user.id && i.customId === 'select_team1_members';
            
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 120000 });
                
                const selectedUserIds = confirmation.values;
                await confirmation.deferUpdate();

                // Lance la suite avec les IDs choisis manuellement pour la Team 1
                return await finalizeAndStartBattle(interaction, battle, team1Name, team2Name, viesInitiales, selectedUserIds);

            } catch (err) {
                return interaction.editReply({ content: "⏰ Temps écoulé pour la sélection manuelle des équipes.", components: [] });
            }

        } catch (error) {
            console.error(error);
            if (interaction.deferred || interaction.replied) {
                return interaction.editReply("❌ Une erreur cosmique a empêché le lancement.");
            } else {
                return interaction.reply({ content: "❌ Une erreur cosmique a empêché le lancement.", ephemeral: true });
            }
        }
    }
};

// Fonction mutualisée pour créer les rôles, les salons et lancer la bataille
async function finalizeAndStartBattle(interaction, battle, team1Name, team2Name, viesInitiales, manualTeam1Ids) {
    const registeredPlayers = await Player.find({ _id: { $in: battle.presents } });
    const categoryId = process.env.CATEGORY_VOCAL_ID;

    let team1 = [];
    let team2 = [];

    if (manualTeam1Ids && manualTeam1Ids.length > 0) {
        registeredPlayers.forEach(p => {
            if (manualTeam1Ids.includes(p._id)) {
                team1.push(p);
            } else {
                team2.push(p);
            }
        });
    } else {
        // Algorithme automatique basé sur le niveau[cite: 6]
        const sortedPlayers = registeredPlayers.sort((a, b) => b.level - a.level);
        let p1Lvl = 0; let p2Lvl = 0;

        for (const p of sortedPlayers) {
            if (p1Lvl <= p2Lvl) { team1.push(p); p1Lvl += p.level; } 
            else { team2.push(p); p2Lvl += p.level; }
        }
    }

    const p1Lvl = team1.reduce((acc, p) => acc + p.level, 0);
    const p2Lvl = team2.reduce((acc, p) => acc + p.level, 0);

    // 1. CRÉATION DES RÔLES D'ÉQUIPE[cite: 6]
    const roleTeam1 = await getOrCreateTeamRole(interaction.guild, team1Name, '#3498db');
    const roleTeam2 = await getOrCreateTeamRole(interaction.guild, team2Name, '#e74c3c');

    // 2. ASSIGNATION DES RÔLES[cite: 6]
    for (const p of team1) {
        const member = await interaction.guild.members.fetch(p._id).catch(() => null);
        if (member && roleTeam1) await member.roles.add(roleTeam1.id).catch(err => console.error(`Erreur rôle T1 (${p._id}):`, err));
    }
    for (const p of team2) {
        const member = await interaction.guild.members.fetch(p._id).catch(() => null);
        if (member && roleTeam2) await member.roles.add(roleTeam2.id).catch(err => console.error(`Erreur rôle T2 (${p._id}):`, err));
    }

    // 3. PERMISSIONS DE BASE[cite: 6]
    const basePermissionOverwrites = [
        {
            id: interaction.guild.roles.everyone,
            allow: [PermissionFlagsBits.ViewChannel],
            deny: [PermissionFlagsBits.Connect]
        }
    ];

    const ownerMember = await interaction.guild.members.fetch(interaction.guild.ownerId).catch(() => null);
    if (ownerMember) {
        basePermissionOverwrites.push({
            id: ownerMember.user,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.Connect, PermissionFlagsBits.Speak]
        });
    }

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

    // 4. PERMISSIONS VOCALES ET TEXTUELLES[cite: 6]
    const teamPermissions = [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.Connect,
        PermissionFlagsBits.Speak,
        PermissionFlagsBits.Stream,                 
        PermissionFlagsBits.UseVAD,                 
        PermissionFlagsBits.UseEmbeddedActivities,  
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.UseExternalEmojis,
        PermissionFlagsBits.AddReactions
    ];

    // 5. CRÉATION DES SALONS VOCAUX[cite: 6]
    let voice1Id = null;
    let voice2Id = null;
    const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);

    if (category && roleTeam1 && roleTeam2) {
        try {
            const chan1 = await interaction.guild.channels.create({
                name: `🛡️ ${team1Name.toUpperCase()}`,
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: [
                    ...basePermissionOverwrites,
                    { id: roleTeam1.id, allow: teamPermissions }
                ]
            });

            const chan2 = await interaction.guild.channels.create({
                name: `🔱 ${team2Name.toUpperCase()}`,
                type: ChannelType.GuildVoice,
                parent: category.id,
                permissionOverwrites: [
                    ...basePermissionOverwrites,
                    { id: roleTeam2.id, allow: teamPermissions }
                ]
            });

            voice1Id = chan1.id;
            voice2Id = chan2.id;
        } catch (e) { 
            console.error("Erreur création salons vocaux :", e); 
        }
    }

    // 6. SAUVEGARDE[cite: 6]
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
            `Répartition effectuée (${manualTeam1Ids ? 'Mode Manuel (Menu)' : 'Mode Automatique'}).\n\n` +
            `📜 **Chroniques du Sanctuaire**\n` +
            `Chaque guerrier dispose de **${viesInitiales} éclats de Cosmos** (vies).`
        )
        .setColor('#3498db')
        .addFields(
            { name: `🔵 Armée de ${team1Name}`, value: team1.length ? team1.map(p => `<@${p._id}>`).join('\n') : 'Aucun', inline: true },
            { name: `🔴 Légion de ${team2Name}`, value: team2.length ? team2.map(p => `<@${p._id}>`).join('\n') : 'Aucun', inline: true }
        )
        .setFooter({ text: 'Rejoignez vos quartiers ! Utilisez /battle-toss pour le premier assaut.' })
        .setTimestamp();

    if (manualTeam1Ids) {
        return interaction.editReply({ content: null, embeds: [runEmbed], components: [] });
    } else {
        return interaction.editReply({ embeds: [runEmbed] });
    }
}