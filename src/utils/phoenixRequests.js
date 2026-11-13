const {
    ActionRowBuilder,
    ChannelType,
    EmbedBuilder,
    StringSelectMenuBuilder
} = require('discord.js');
const mongoose = require('mongoose');
const Battle = require('../models/Battle');
const Player = require('../models/Player');
const { getEligiblePhoenixTeams, getPhoenixLaunchError } = require('./phoenix');
const { getConfiguredChannelId } = require('./controlPanel');

const TEAM_KEYS = ['team1', 'team2'];
const REQUEST_BUTTON_ID = 'request_phoenix';
const REQUEST_SELECT_PREFIX = 'phoenix_request';

class PhoenixRequestError extends Error {}

async function handlePhoenixRequestInteraction(interaction) {
    const isRequestButton = interaction.isButton() && interaction.customId === REQUEST_BUTTON_ID;
    const isRequestSelect = interaction.isStringSelectMenu()
        && interaction.customId.startsWith(`${REQUEST_SELECT_PREFIX}:`);
    if (!isRequestButton && !isRequestSelect) return false;

    try {
        if (isRequestButton) {
            await showPhoenixPlayerPicker(interaction);
        } else {
            await handlePhoenixSelection(interaction);
        }
    } catch (error) {
        console.error('Erreur lors du traitement d’une demande de duel du Phénix :', error);
        const message = error instanceof PhoenixRequestError
            ? error.message
            : 'La demande n’a pas été transmise. Vérifiez la configuration du salon « battle », l’ID PHOENIX_NOTIFY_USER_ID et les permissions du bot pour créer un fil privé.';
        try {
            if (isRequestSelect) {
                await interaction.update({ content: message, components: [] });
            } else {
                await interaction.reply({ content: message, ephemeral: true });
            }
        } catch (responseError) {
            console.error('Impossible de signaler l’échec de la demande Phénix :', responseError);
        }
    }

    return true;
}

async function showPhoenixPlayerPicker(interaction) {
    const battle = await getActiveBattle(interaction.guildId);
    if (!battle) throw new PhoenixRequestError('Aucune Team Battle n’est en cours.');

    const teamKey = TEAM_KEYS.find(key => battle.teams[key]?.voiceChannelId === interaction.channelId);
    if (!teamKey) {
        throw new PhoenixRequestError('Utilisez le bouton dans le salon vocal de votre équipe.');
    }
    validateTeamRequest(battle, interaction, teamKey);

    const eliminatedPlayers = battle.teams[teamKey].players.filter(playerId =>
        (battle.viesActuelles.get(playerId.toString()) || 0) <= 0
    );
    const options = await buildPlayerOptions(eliminatedPlayers);
    if (!options.length) {
        throw new PhoenixRequestError('Votre équipe n’a aucun joueur éliminé à envoyer.');
    }

    const select = new StringSelectMenuBuilder()
        .setCustomId(`${REQUEST_SELECT_PREFIX}:player:${battle._id}:${teamKey}`)
        .setPlaceholder('Choisissez votre joueur éliminé')
        .addOptions(options);

    await interaction.reply({
        content: `**${battle.teams[teamKey].name}** — choisissez d’abord le joueur qui participera au duel du Phénix.`,
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
    });
}

async function handlePhoenixSelection(interaction) {
    const [prefix, step, battleId, teamKey, phoenixPlayerId] = interaction.customId.split(':');
    if (prefix !== REQUEST_SELECT_PREFIX || !mongoose.isValidObjectId(battleId) || !TEAM_KEYS.includes(teamKey)) {
        throw new PhoenixRequestError('Cette sélection n’est plus valide. Relancez la demande depuis le salon vocal.');
    }

    const battle = await getActiveBattle(interaction.guildId, battleId);
    if (!battle) throw new PhoenixRequestError('Cette Team Battle n’est plus active.');
    validateTeamRequest(battle, interaction, teamKey);

    if (step === 'player') {
        const selectedPlayerId = interaction.values[0];
        const isEliminatedMember = battle.teams[teamKey].players.some(playerId =>
            playerId.toString() === selectedPlayerId
            && (battle.viesActuelles.get(selectedPlayerId) || 0) <= 0
        );
        if (!isEliminatedMember) {
            throw new PhoenixRequestError('Choisissez un joueur éliminé de votre équipe.');
        }

        const opponentTeamKey = teamKey === 'team1' ? 'team2' : 'team1';
        const opponentOptions = await buildPlayerOptions(battle.teams[opponentTeamKey].players);
        if (!opponentOptions.length) {
            throw new PhoenixRequestError('Aucun adversaire disponible dans l’équipe opposée.');
        }

        const select = new StringSelectMenuBuilder()
            .setCustomId(`${REQUEST_SELECT_PREFIX}:opponent:${battle._id}:${teamKey}:${selectedPlayerId}`)
            .setPlaceholder('Choisissez l’adversaire')
            .addOptions(opponentOptions);

        await interaction.update({
            content: `Joueur choisi : <@${selectedPlayerId}>.\nChoisissez maintenant son adversaire (en vie ou éliminé).`,
            components: [new ActionRowBuilder().addComponents(select)]
        });
        return;
    }

    if (step !== 'opponent' || !phoenixPlayerId) {
        throw new PhoenixRequestError('Cette sélection n’est plus valide. Relancez la demande depuis le salon vocal.');
    }

    const opponentId = interaction.values[0];
    const launchError = getPhoenixLaunchError(battle, teamKey, phoenixPlayerId, opponentId);
    if (launchError) throw new PhoenixRequestError(launchError);

    await notifyOrganizer(interaction, battle, teamKey, phoenixPlayerId, opponentId);
    await interaction.update({
        content: 'Votre demande de duel du Phénix a été transmise à l’organisateur pour validation. Le duel n’est pas encore lancé.',
        components: []
    });
}

function validateTeamRequest(battle, interaction, teamKey) {
    const team = battle.teams[teamKey];
    if (!team) throw new PhoenixRequestError('Cette équipe est introuvable dans la bataille.');
    if (team.voiceChannelId !== interaction.channelId) {
        throw new PhoenixRequestError('La demande doit être effectuée dans le salon vocal de l’équipe concernée.');
    }
    if (!team.players.some(playerId => playerId.toString() === interaction.user.id)) {
        throw new PhoenixRequestError('Seuls les joueurs de cette équipe peuvent envoyer une demande.');
    }
    if (!getEligiblePhoenixTeams(battle).includes(teamKey)) {
        throw new PhoenixRequestError('Votre équipe n’est pas éligible au Phénix : elle doit avoir moins de vies au total que l’adversaire, au moins un joueur éliminé et aucun duel en cours.');
    }
}

async function getActiveBattle(guildId, battleId) {
    if (!guildId) throw new PhoenixRequestError('Cette demande doit être faite dans un serveur Discord.');
    const query = { guildId, status: 'started' };
    if (battleId) query._id = battleId;
    return Battle.findOne(query).sort({ createdAt: -1 });
}

async function buildPlayerOptions(playerIds) {
    const profiles = await Player.find({ _id: { $in: playerIds } }).select('username').lean();
    const names = new Map(profiles.map(profile => [profile._id.toString(), profile.username]));
    return playerIds.slice(0, 25).map(playerId => ({
        label: String(names.get(playerId.toString()) || `Joueur ${playerId}`).slice(0, 100),
        value: playerId.toString()
    }));
}

async function notifyOrganizer(interaction, battle, teamKey, phoenixPlayerId, opponentId) {
    const organizerId = (process.env.PHOENIX_NOTIFY_USER_ID || '').trim();
    if (!/^\d{17,20}$/.test(organizerId)) {
        throw new PhoenixRequestError('L’organisateur n’est pas configuré. Ajoutez son ID Discord dans PHOENIX_NOTIFY_USER_ID puis redémarrez le bot.');
    }

    const channelId = getConfiguredChannelId(battle.guildId, 'battle');
    if (!channelId) {
        throw new PhoenixRequestError('Configurez le salon « battle » de ce serveur dans CONTROL_PANEL_CHANNELS.');
    }

    const channel = await interaction.client.channels.fetch(channelId);
    if (!channel
        || channel.guildId !== battle.guildId
        || channel.type !== ChannelType.GuildText
        || !channel.threads) {
        throw new PhoenixRequestError('Le salon « battle » doit être un salon textuel standard accessible au bot pour recevoir un fil privé.');
    }

    await interaction.guild.members.fetch(organizerId);
    const teamName = battle.teams[teamKey].name;
    const thread = await channel.threads.create({
        name: `Demande Phénix - ${teamName}`.slice(0, 100),
        autoArchiveDuration: 1440,
        type: ChannelType.PrivateThread,
        invitable: false
    });
    try {
        await thread.members.add(organizerId);

        const embed = new EmbedBuilder()
            .setTitle('Demande de duel du Phénix')
            .setDescription(`L’équipe **${teamName}** demande à lancer son duel du Phénix.`)
            .addFields(
                { name: 'Joueur envoyé', value: `<@${phoenixPlayerId}>`, inline: true },
                { name: 'Adversaire choisi', value: `<@${opponentId}>`, inline: true }
            )
            .setFooter({ text: 'À valider par l’organisateur. Pour lancer le duel, utilisez /battle-phoenix et renseignez les personnages.' })
            .setTimestamp();

        await thread.send({
            content: `<@${organizerId}> — nouvelle demande Phénix.`,
            embeds: [embed],
            allowedMentions: { users: [organizerId], roles: [] }
        });
    } catch (error) {
        await thread.delete().catch(cleanupError => {
            console.error('Impossible de supprimer le fil privé incomplet de la demande Phénix :', cleanupError);
        });
        throw error;
    }
}

module.exports = {
    handlePhoenixRequestInteraction
};
