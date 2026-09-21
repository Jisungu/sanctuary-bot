const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const Player = require('../models/Player');
const Battle = require('../models/Battle');
require('dotenv').config();

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

            const sortedPlayers = registeredPlayers.sort((a, b) => b.level - a.level);
            const team1 = []; const team2 = [];
            let p1Lvl = 0; let p2Lvl = 0;

            for (const p of sortedPlayers) {
                if (p1Lvl <= p2Lvl) { team1.push(p); p1Lvl += p.level; } 
                else { team2.push(p); p2Lvl += p.level; }
            }

            let voice1Id = null;
            let voice2Id = null;

            const category = await interaction.guild.channels.fetch(categoryId).catch(() => null);
            if (category) {
                try {
                    const chan1 = await interaction.guild.channels.create({
                        name: `🛡️ ${team1Name.toUpperCase()}`,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                    });
                    const chan2 = await interaction.guild.channels.create({
                        name: `🔱 ${team2Name.toUpperCase()}`,
                        type: ChannelType.GuildVoice,
                        parent: category.id,
                    });
                    voice1Id = chan1.id;
                    voice2Id = chan2.id;
                } catch (e) { console.error("Erreur création salons :", e); }
            }

            battle.status = 'started';
            battle.viesParJoueur = viesInitiales;
            battle.presents.forEach(id => battle.viesActuelles.set(id.toString(), viesInitiales));
            battle.teams = {
                team1: { name: team1Name, players: team1.map(p => p._id), totalLevel: p1Lvl, voiceChannelId: voice1Id },
                team2: { name: team2Name, players: team2.map(p => p._id), totalLevel: p2Lvl, voiceChannelId: voice2Id }
            };
            battle.markModified('viesActuelles');
            await battle.save();

            const runEmbed = new EmbedBuilder()
                .setTitle('🏛️ Les Camps de la Guerre Sainte sont scellés')
                .setDescription(
                    `Le destin a parlé. Les salons vocaux ont été érigés dans le Sanctuaire.\n\n` +
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