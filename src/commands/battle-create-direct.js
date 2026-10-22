const {
    SlashCommandBuilder,
    ActionRowBuilder,
    StringSelectMenuBuilder,
    PermissionFlagsBits
} = require('discord.js');
const Battle = require('../models/Battle');
const Player = require('../models/Player');
const { finalizeAndStartBattle } = require('./battle-start');

const MAX_PARTICIPANTS = 10;

const commandData = new SlashCommandBuilder()
    .setName('battle-create-direct')
    .setDescription('Crée et lance une Team Battle sans inscription ni check-in.')
    .addStringOption(option => option
        .setName('date')
        .setDescription('Format : JJ/MM/AAAA')
        .setRequired(true))
    .addStringOption(option => option
        .setName('heure')
        .setDescription('Format : HH:mm')
        .setRequired(true))
    .addStringOption(option => option
        .setName('equipe1')
        .setDescription('Nom de la Team 1')
        .setRequired(true))
    .addStringOption(option => option
        .setName('equipe2')
        .setDescription('Nom de la Team 2')
        .setRequired(true))
    .addIntegerOption(option => option
        .setName('vies')
        .setDescription('Nombre de vies initiales par joueur')
        .setMinValue(1)
        .setRequired(true));

for (let index = 1; index <= MAX_PARTICIPANTS; index++) {
    commandData.addUserOption(option => option
        .setName(`joueur${index}`)
        .setDescription(`Participant ${index}`)
        .setRequired(index <= 2));
}

module.exports = {
    data: commandData.setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        const activeBattle = await Battle.findOne({
            guildId: interaction.guildId,
            status: 'started'
        });

        if (activeBattle) {
            return interaction.reply({
                content: "⚠️ Une Team Battle est déjà lancée. Termine-la avant d'en lancer une nouvelle.",
                ephemeral: true
            });
        }

        const participantIds = [];
        for (let index = 1; index <= MAX_PARTICIPANTS; index++) {
            const participant = interaction.options.getUser(`joueur${index}`);
            if (participant && !participantIds.includes(participant.id)) {
                participantIds.push(participant.id);
            } else if (participant) {
                return interaction.reply({
                    content: `❌ <@${participant.id}> a été sélectionné plusieurs fois.`,
                    ephemeral: true
                });
            }
        }

        if (participantIds.length < 2) {
            return interaction.reply({
                content: '❌ Sélectionne au moins deux participants pour former les deux équipes.',
                ephemeral: true
            });
        }

        const players = await Player.find({ _id: { $in: participantIds } });
        const foundIds = new Set(players.map(player => player._id));
        const missingProfiles = participantIds.filter(id => !foundIds.has(id));
        if (missingProfiles.length) {
            return interaction.reply({
                content: `❌ Ces participants n'ont pas de profil ou de rang enregistré : ${missingProfiles.map(id => `<@${id}>`).join(', ')}.`,
                ephemeral: true
            });
        }

        await interaction.deferReply();

        const options = [];
        for (const player of players) {
            const member = await interaction.guild.members.fetch(player._id).catch(() => null);
            if (!member) {
                return interaction.editReply(`❌ <@${player._id}> ne fait pas partie de ce serveur.`);
            }

            options.push({
                label: member.displayName.substring(0, 100),
                value: player._id
            });
        }

        const team1Menu = new StringSelectMenuBuilder()
            .setCustomId('direct_battle_team1')
            .setPlaceholder('Choisissez les joueurs de la Team 1')
            .setMinValues(1)
            .setMaxValues(Math.min(participantIds.length - 1, 25))
            .addOptions(options);

        const menuMessage = await interaction.followUp({
            content: '🛡️ **Composition manuelle de la Team 1**\nSélectionne ses joueurs ; les autres formeront la Team 2.',
            components: [new ActionRowBuilder().addComponents(team1Menu)],
            ephemeral: true,
            fetchReply: true
        });

        let selectedTeam1Ids;
        let selection;
        try {
            selection = await menuMessage.awaitMessageComponent({
                filter: component => component.user.id === interaction.user.id
                    && component.customId === 'direct_battle_team1',
                time: 120000
            });
        } catch (error) {
            if (error.code !== 'InteractionCollectorError') {
                throw error;
            }
            await menuMessage.edit({ components: [] });
            return interaction.editReply('⏰ Temps écoulé : la composition des équipes a été annulée.');
        }
        selectedTeam1Ids = selection.values;
        await selection.deferUpdate();
        await menuMessage.edit({ components: [] });

        const latestActiveBattle = await Battle.findOne({
            guildId: interaction.guildId,
            status: 'started'
        });
        if (latestActiveBattle) {
            return interaction.editReply("⚠️ Une autre Team Battle a été lancée entre-temps. Aucune nouvelle bataille n'a été lancée.");
        }

        const date = interaction.options.getString('date');
        const heure = interaction.options.getString('heure');
        const battle = await Battle.create({
            guildId: interaction.guildId,
            isDirect: true,
            dateTournoi: date,
            heureTournoi: heure,
            status: 'calling',
            participants: participantIds,
            waitlist: [],
            presents: participantIds,
            history: []
        });

        try {
            await finalizeAndStartBattle(
                interaction,
                battle,
                interaction.options.getString('equipe1'),
                interaction.options.getString('equipe2'),
                interaction.options.getInteger('vies'),
                selectedTeam1Ids
            );
        } finally {
            const startedBattle = await Battle.exists({ _id: battle._id, status: 'started' });
            if (!startedBattle) {
                await Battle.deleteOne({ _id: battle._id });
            }
        }
    }
};
