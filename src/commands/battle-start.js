const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Player = require('../models/Player');
const Battle = require('../models/Battle');
const { broadcastOverlayData } = require('../utils/overlayServer');

require('dotenv').config();

const startingGuilds = new Set();

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
            const battle = await Battle.findOne({
                guildId: interaction.guildId,
                status: 'calling',
                isDirect: { $ne: true }
            }).sort({ createdAt: -1 });

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

            if (registeredPlayers.length < 2) {
                return interaction.reply({
                    content: '❌ Il faut au moins deux chevaliers présents pour former deux équipes.',
                    ephemeral: true
                });
            }

            if (!isManual) {
                await interaction.deferReply({ ephemeral: false });
                return await finalizeAndStartBattle(interaction, battle, team1Name, team2Name, viesInitiales, null);
            }

            const options = [];
            for (const p of registeredPlayers) {
                let displayName = p._id;
                try {
                    const member = await interaction.guild.members.fetch(p._id);
                    displayName = member.displayName || member.user.username;
                } catch (e) {}

                options.push({
                    label: displayName.substring(0, 100),
                    value: p._id
                });
            }

            if (options.length === 0) {
                return interaction.reply({ content: "❌ Aucun joueur n'est inscrit dans la phase d'appel.", ephemeral: true });
            }

            const selectMenu = new StringSelectMenuBuilder()
                .setCustomId('select_team1_members')
                .setPlaceholder('Sélectionnez les membres de la Team 1')
                .setMinValues(1)
                .setMaxValues(Math.min(options.length - 1, 25))
                .addOptions(options.slice(0, 25));

            const row = new ActionRowBuilder().addComponents(selectMenu);

            const response = await interaction.reply({
                content: `🛡️ **Composition manuelle de la Team 1 (${team1Name})**\nVeuillez sélectionner les joueurs ci-dessous parmi les inscrits :`,
                components: [row],
                ephemeral: true
            });

            const collectorFilter = i => i.user.id === interaction.user.id && i.customId === 'select_team1_members';
            
            try {
                const confirmation = await response.awaitMessageComponent({ filter: collectorFilter, time: 120000 });
                const selectedUserIds = confirmation.values;
                await confirmation.deferUpdate();

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
    const guildId = interaction.guildId;
    if (startingGuilds.has(guildId)) {
        return interaction.editReply("⚠️ Une autre Team Battle est déjà en cours de lancement.");
    }

    startingGuilds.add(guildId);
    try {
        const startedBattle = await Battle.findOne({
            guildId,
            status: 'started',
            _id: { $ne: battle._id }
        });
        if (startedBattle) {
            return interaction.editReply("⚠️ Une Team Battle est déjà lancée. Termine-la avant d'en démarrer une autre.");
        }

        return await finalizeBattle(interaction, battle, team1Name, team2Name, viesInitiales, manualTeam1Ids);
    } finally {
        startingGuilds.delete(guildId);
    }
}

async function finalizeBattle(interaction, battle, team1Name, team2Name, viesInitiales, manualTeam1Ids) {
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
        const sortedPlayers = registeredPlayers.sort((a, b) => b.level - a.level);
        let p1Lvl = 0; let p2Lvl = 0;

        for (const p of sortedPlayers) {
            if (p1Lvl <= p2Lvl) { team1.push(p); p1Lvl += p.level; } 
            else { team2.push(p); p2Lvl += p.level; }
        }
    }

    if (!team1.length || !team2.length) {
        return interaction.editReply({
            content: "❌ Chaque équipe doit contenir au moins un joueur pour démarrer la bataille.",
            components: manualTeam1Ids ? [] : undefined
        });
    }

    // --- DICTIONNAIRE / AJUSTEMENT DES VIES SI NOMBRE INÉGAL (LE JUGEMENT DE LA BALANCE) ---
    let modificationsVies = {};
    let balanceTargets = [];

    if (team1.length !== team2.length) {
        const teamEnSousNombre = team1.length < team2.length ? team1 : team2;
        const teamEnSurnombre = team1.length > team2.length ? team1 : team2;
        const nomTeamSousNombre = team1.length < team2.length ? team1Name : team2Name;
        const nomTeamSurnombre = team1.length > team2.length ? team1Name : team2Name;

        const balanceEmbed = new EmbedBuilder()
            .setTitle('⚖️ Le Jugement de la Balance - Déséquilibre Détecté')
            .setDescription(
                `Les effectifs sont inégaux (**${team1.length} vs ${team2.length}**).\n` +
                `Le protocole du **Jugement de la Balance** est activé.`
            )
            .setColor('#ffd700')
            .addFields(
                { name: `⚖️ Sous-nombre (${nomTeamSousNombre})`, value: `Le joueur désigné recevra le complément de vies nécessaire pour s'égaliser avec l'adversaire.` },
                { name: `⚖️ Surnombre (${nomTeamSurnombre})`, value: `Le joueur désigné perd **1 vie** (sanction).` }
            );

        async function getPlayerDisplayName(userId) {
            try {
                const member = await interaction.guild.members.fetch(userId);
                return member.displayName || member.user.username;
            } catch (e) {
                return `Utilisateur (${userId})`;
            }
        }

        const sanctionOptions = [];
        for (const p of teamEnSurnombre) {
            const name = await getPlayerDisplayName(p._id);
            sanctionOptions.push({
                label: `Retirer 1 vie à ${name}`.substring(0, 100),
                value: p._id
            });
        }

        const renfortOptions = [];
        for (const p of teamEnSousNombre) {
            const name = await getPlayerDisplayName(p._id);
            renfortOptions.push({
                label: `Donner le complément de vies à ${name}`.substring(0, 100),
                value: p._id
            });
        }

        const selectSanction = new StringSelectMenuBuilder()
            .setCustomId('balance_sanction')
            .setPlaceholder(`[${nomTeamSurnombre}] Choisir la cible -1 vie`)
            .addOptions(sanctionOptions.slice(0, 25));

        const selectRenfort = new StringSelectMenuBuilder()
            .setCustomId('balance_renfort')
            .setPlaceholder(`[${nomTeamSousNombre}] Choisir le bénéficiaire du complément`)
            .addOptions(renfortOptions.slice(0, 25));

        const btnValidate = new ButtonBuilder()
            .setCustomId('validate_balance')
            .setLabel('Valider Le Jugement')
            .setStyle(ButtonStyle.Success);

        const row1 = new ActionRowBuilder().addComponents(selectSanction);
        const row2 = new ActionRowBuilder().addComponents(selectRenfort);
        const row3 = new ActionRowBuilder().addComponents(btnValidate);

        const balanceMsg = await interaction.followUp({
            content: "⚠️ **Action requise :** Veuillez renseigner le Jugement de la Balance ci-dessous.",
            embeds: [balanceEmbed],
            components: [row1, row2, row3],
            ephemeral: true,
            fetchReply: true
        });

        try {
            let selectedVictim = null;
            let selectedBeneficiary = null;

            const collector = balanceMsg.createMessageComponentCollector({ time: 300000 });

            await new Promise((resolve, reject) => {
                collector.on('collect', async i => {
                    if (!i.member.permissions.has(PermissionFlagsBits.Administrator)) {
                        return i.reply({ content: "❌ Seul un Administrateur/TO peut valider ce jugement.", ephemeral: true });
                    }

                    if (i.isStringSelectMenu()) {
                        if (i.customId === 'balance_sanction') selectedVictim = i.values[0];
                        if (i.customId === 'balance_renfort') selectedBeneficiary = i.values[0];
                        await i.deferUpdate();
                    } else if (i.customId === 'validate_balance') {
                        if (!selectedVictim || !selectedBeneficiary) {
                            return i.reply({ content: "⚠️ Veuillez sélectionner à la fois la cible de la sanction et le bénéficiaire du renfort.", ephemeral: true });
                        }
                        collector.stop('validated');
                        await i.deferUpdate();
                        resolve();
                    }
                });

                collector.on('end', (collected, reason) => {
                    if (reason !== 'validated') reject(new Error('Temps de vote de la balance expiré.'));
                });
            });

            await balanceMsg.edit({ components: [] });

            // 1. La victime perd 1 vie
            if (selectedVictim) modificationsVies[selectedVictim] = -1;

            // 2. Calcul dynamique du total de vies de l'équipe en surnombre après la sanction
            let totalViesSurnombre = 0;
            teamEnSurnombre.forEach(p => {
                let v = viesInitiales;
                if (p._id.toString() === selectedVictim) v -= 1;
                totalViesSurnombre += v;
            });

            // 3. Calcul du total de vies actuel de l'équipe en sous-nombre (sans le bénéficiaire)
            let totalViesSousNombreActuelles = 0;
            teamEnSousNombre.forEach(p => {
                if (p._id.toString() !== selectedBeneficiary) {
                    totalViesSousNombreActuelles += viesInitiales;
                }
            });

            // Le bénéficiaire doit combler l'écart pour que les deux équipes aient le même pool global
            const viesNecessaires = totalViesSurnombre - totalViesSousNombreActuelles;
            const bonusVies = viesNecessaires - viesInitiales; // Ce qu'on ajoute en plus de ses vies de base

            if (selectedBeneficiary) {
                modificationsVies[selectedBeneficiary] = bonusVies;
            }
            balanceTargets = [selectedVictim];
            if (bonusVies > 0) balanceTargets.push(selectedBeneficiary);

        } catch (err) {
            console.error(err);
            await balanceMsg.edit({ components: [] });
            return interaction.editReply({ content: "⏰ Temps écoulé ou erreur lors du Jugement de la Balance.", components: [] });
        }
    }
    // --------------------------------------------------------------------------

    const p1Lvl = team1.reduce((acc, p) => acc + p.level, 0);
    const p2Lvl = team2.reduce((acc, p) => acc + p.level, 0);

    // 1. CRÉATION DES RÔLES D'ÉQUIPE
    const roleTeam1 = await getOrCreateTeamRole(interaction.guild, team1Name, '#3498db');
    const roleTeam2 = await getOrCreateTeamRole(interaction.guild, team2Name, '#e74c3c');

    // 2. ASSIGNATION DES RÔLES
    for (const p of team1) {
        const member = await interaction.guild.members.fetch(p._id).catch(() => null);
        if (member && roleTeam1) await member.roles.add(roleTeam1.id).catch(err => console.error(`Erreur rôle T1 (${p._id}):`, err));
    }
    for (const p of team2) {
        const member = await interaction.guild.members.fetch(p._id).catch(() => null);
        if (member && roleTeam2) await member.roles.add(roleTeam2.id).catch(err => console.error(`Erreur rôle T2 (${p._id}):`, err));
    }

    // 3. PERMISSIONS DE BASE
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

    // 4. PERMISSIONS VOCALES ET TEXTUELLES
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

    // 5. CRÉATION DES SALONS VOCAUX
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

    // --- SAUVEGARDE AVEC PRISE EN COMPTE DU JUGEMENT DE LA BALANCE ---
    battle.status = 'started';
    battle.viesParJoueur = viesInitiales;
    battle.balanceAdjustments.clear();
    Object.entries(modificationsVies).forEach(([playerId, adjustment]) => {
        battle.balanceAdjustments.set(playerId, adjustment);
    });
    battle.balanceTargets = balanceTargets;

    battle.presents.forEach(id => {
        const strId = id.toString();
        let viesFinalesDuJoueur = viesInitiales;
        if (modificationsVies[strId]) {
            viesFinalesDuJoueur += modificationsVies[strId]; // Applique +bonus ou -1
        }
        battle.viesActuelles.set(strId, viesFinalesDuJoueur);
    });

    battle.teams = {
        team1: { name: team1Name, players: team1.map(p => p._id), totalLevel: p1Lvl, voiceChannelId: voice1Id },
        team2: { name: team2Name, players: team2.map(p => p._id), totalLevel: p2Lvl, voiceChannelId: voice2Id }
    };
    battle.markModified('viesActuelles');
    battle.markModified('balanceAdjustments');
    battle.markModified('balanceTargets');
    await battle.save();
    await broadcastOverlayData();

    // Affichage formaté des joueurs avec le symbole de la Balance si désigné
    const formatTeamPlayersWithVies = (teamArray) => {
        return teamArray.map(p => {
            const strId = p._id.toString();
            const v = battle.viesActuelles.get(strId);
            const aSubitJugement = modificationsVies[strId] !== undefined;
            const symboleJugement = aSubitJugement ? ' ⚖️' : '';

            return `<@${p._id}> — **${v}** vies${symboleJugement}`;
        }).join('\n');
    };

    const runEmbed = new EmbedBuilder()
        .setTitle('🏛️ Les Camps de la Guerre Sainte sont scellés')
        .setDescription(
            `Répartition effectuée (${manualTeam1Ids ? 'Mode Manuel (Menu)' : 'Mode Automatique'}).\n\n` +
            `📜 **Chroniques du Sanctuaire**\n` +
            `Base de départ : **${viesInitiales}** éclats de Cosmos par défaut.\n` +
            (Object.keys(modificationsVies).length > 0 ? `⚖️ *Le Jugement de la Balance a été appliqué.*` : '')
        )
        .setColor('#3498db')
        .addFields(
            { name: `🔵 Armée de ${team1Name}`, value: team1.length ? formatTeamPlayersWithVies(team1) : 'Aucun', inline: true },
            { name: `🔴 Légion de ${team2Name}`, value: team2.length ? formatTeamPlayersWithVies(team2) : 'Aucun', inline: true }
        )
        .setFooter({ text: 'Rejoignez vos quartiers ! Utilisez /battle-toss pour le premier assaut.' })
        .setTimestamp();

    return interaction.editReply({ content: null, embeds: [runEmbed], components: [] });
}

module.exports.finalizeAndStartBattle = finalizeAndStartBattle;