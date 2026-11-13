const crypto = require('node:crypto');

function registerControlPanelCommands(app, client, getConfiguredChannelId) {
    app.get('/api/control-panel/commands', (req, res) => {
        const commands = Array.from(client.commands.values(), command => {
            const data = command.data.toJSON();
            return {
                name: data.name,
                description: data.description,
                options: data.options || []
            };
        });
        res.json({ commands });
    });

    app.post('/api/control-panel/command', async (req, res) => {
        try {
            const { guildId, commandName, options } = req.body || {};
            if (typeof guildId !== 'string' || typeof commandName !== 'string'
                || !options || typeof options !== 'object' || Array.isArray(options)) {
                return res.status(400).json({ error: 'Commande ou paramètres invalides.' });
            }

            const command = client.commands.get(commandName);
            if (!command) return res.status(404).json({ error: 'Commande introuvable.' });
            if (commandName === 'player-profile' && !options.joueur) {
                return res.status(400).json({ error: 'Sélectionnez un joueur pour afficher son profil.' });
            }

            const guild = await client.guilds.fetch(guildId);
            const purpose = commandChannelPurpose(commandName);
            const channelId = getConfiguredChannelId(guildId, purpose);
            if (!channelId) {
                return res.status(400).json({
                    error: `Configurez le salon « ${purpose} » pour ce serveur dans CONTROL_PANEL_CHANNELS.`
                });
            }

            const channel = await client.channels.fetch(channelId);
            if (!channel?.isTextBased() || channel.guildId !== guild.id) {
                return res.status(400).json({ error: `Le salon « ${purpose} » est introuvable ou n’appartient pas à ce serveur.` });
            }

            const commandData = command.data.toJSON();
            const resolved = await resolveCommandOptions(commandData.options || [], options, guild, client);
            const interaction = createPanelInteraction({
                guild,
                channel,
                client,
                commandName,
                commandOptions: resolved.values,
                resolvedUsers: resolved.users,
                resolvedMembers: resolved.members
            });

            const execution = Promise.resolve()
                .then(() => command.execute(interaction))
                .then(() => interaction.complete())
                .catch(error => {
                    console.error(`Erreur de la commande /${commandName} depuis le panneau :`, error);
                    interaction.fail(error);
                    return { error };
                });

            const componentFlow = ['battle-start', 'battle-create-direct'].includes(commandName);
            const executionResult = componentFlow ? null : await execution;
            if (executionResult?.error) {
                return res.status(500).json({ error: 'La commande a échoué. Vérifiez le salon Discord configuré.' });
            }
            const response = await interaction.initialResponse;
            res.json({
                message: response.message,
                channelName: channel.name,
                messageUrl: response.messageUrl || null,
                hasComponents: response.hasComponents,
                note: response.hasComponents
                    ? 'La commande a publié un menu ou des boutons à terminer dans Discord.'
                    : null
            });
            void execution;
        } catch (error) {
            console.error('Erreur de lancement d’une commande depuis le panneau :', error);
            res.status(500).json({ error: error.message || 'Impossible de lancer cette commande.' });
        }
    });
}

function commandChannelPurpose(commandName) {
    if (commandName === 'battle-create') return 'registration';
    if (commandName === 'battle-checkin') return 'checkin';
    return 'battle';
}

async function resolveCommandOptions(definitions, supplied, guild, client) {
    const knownNames = new Set(definitions.map(option => option.name));
    const unknownName = Object.keys(supplied).find(name => !knownNames.has(name));
    if (unknownName) throw new Error(`Option inconnue : ${unknownName}.`);

    const values = {};
    const users = {};
    const members = {};

    for (const definition of definitions) {
        if (definition.type === 1 || definition.type === 2) {
            throw new Error('Les sous-commandes ne sont pas encore prises en charge par le panneau.');
        }

        const rawValue = supplied[definition.name];
        const missing = rawValue === undefined || rawValue === null || rawValue === '';
        if (missing) {
            if (definition.required) throw new Error(`L’option « ${definition.name} » est requise.`);
            continue;
        }

        switch (definition.type) {
            case 3:
                if (typeof rawValue !== 'string') throw new Error(`L’option « ${definition.name} » doit être du texte.`);
                values[definition.name] = rawValue;
                break;
            case 4:
                values[definition.name] = validateNumber(rawValue, definition, true);
                break;
            case 10:
                values[definition.name] = validateNumber(rawValue, definition, false);
                break;
            case 5:
                if (typeof rawValue !== 'boolean') throw new Error(`L’option « ${definition.name} » doit être cochée ou décochée.`);
                values[definition.name] = rawValue;
                break;
            case 6: {
                if (typeof rawValue !== 'string' || !/^\d{15,22}$/.test(rawValue)) {
                    throw new Error(`Saisissez un identifiant Discord valide pour « ${definition.name} ».`);
                }
                const user = await client.users.fetch(rawValue);
                const member = await guild.members.fetch(rawValue).catch(() => null);
                if (!member) throw new Error(`${user.username} n’est pas membre de ce serveur.`);
                users[definition.name] = user;
                members[definition.name] = member;
                values[definition.name] = user;
                break;
            }
            case 7: {
                const channel = await client.channels.fetch(String(rawValue));
                if (!channel || channel.guildId !== guild.id || !channel.isTextBased()) {
                    throw new Error(`Salon invalide pour « ${definition.name} ».`);
                }
                values[definition.name] = channel;
                break;
            }
            case 8: {
                const role = await guild.roles.fetch(String(rawValue));
                if (!role) throw new Error(`Rôle invalide pour « ${definition.name} ».`);
                values[definition.name] = role;
                break;
            }
            default:
                throw new Error(`Le type d’option « ${definition.name} » n’est pas pris en charge.`);
        }

        if (definition.choices && !definition.choices.some(choice => choice.value === values[definition.name])) {
            throw new Error(`Valeur non autorisée pour « ${definition.name} ».`);
        }
    }

    return { values, users, members };
}

function validateNumber(value, definition, integer) {
    const number = Number(value);
    if (!Number.isFinite(number) || (integer && !Number.isInteger(number))) {
        throw new Error(`Valeur numérique invalide pour « ${definition.name} ».`);
    }
    if (definition.min_value !== undefined && number < definition.min_value) {
        throw new Error(`« ${definition.name} » doit être supérieur ou égal à ${definition.min_value}.`);
    }
    if (definition.max_value !== undefined && number > definition.max_value) {
        throw new Error(`« ${definition.name} » doit être inférieur ou égal à ${definition.max_value}.`);
    }
    return number;
}

function createPanelInteraction({ guild, channel, client, commandName, commandOptions, resolvedUsers, resolvedMembers }) {
    let responseMessage = null;
    let firstResponseResolve;
    let firstResponseReject;
    let firstResponseSettled = false;
    const initialResponse = new Promise((resolve, reject) => {
        firstResponseResolve = resolve;
        firstResponseReject = reject;
    });
    void initialResponse.catch(() => {});

    const settleResponse = (value, error) => {
        if (firstResponseSettled) return;
        firstResponseSettled = true;
        if (error) firstResponseReject(error);
        else firstResponseResolve(value);
    };

    const makeResponse = async (payload, edit = false) => {
        const messagePayload = typeof payload === 'string' ? payload : { ...payload };
        if (messagePayload && typeof messagePayload === 'object') {
            delete messagePayload.ephemeral;
            delete messagePayload.fetchReply;
        }
        const message = edit && responseMessage
            ? await responseMessage.edit(messagePayload)
            : await channel.send(messagePayload);
        if (!responseMessage || edit) responseMessage = message;

        const embed = messagePayload && typeof messagePayload === 'object' ? messagePayload.embeds?.[0] : null;
        const summary = typeof messagePayload === 'string'
            ? messagePayload
            : messagePayload?.content || embed?.title || embed?.description || `/${commandName} exécutée.`;
        settleResponse({
            message: summary,
            messageUrl: message.url,
            hasComponents: Boolean(messagePayload?.components?.length)
        });
        return message;
    };

    const permissionSet = {
        has() {
            return true;
        }
    };
    const actorId = client.user?.id || guild.ownerId;
    const interaction = {
        id: crypto.randomUUID(),
        commandName,
        guild,
        guildId: guild.id,
        channel,
        channelId: channel.id,
        client,
        user: { id: actorId, username: 'Control panel', bot: true },
        member: {
            id: actorId,
            user: { id: actorId, username: 'Control panel', bot: true },
            displayName: 'Control panel',
            permissions: permissionSet,
            roles: { cache: new Map() }
        },
        memberPermissions: permissionSet,
        options: {
            data: Object.entries(commandOptions).map(([name, value]) => ({ name, value })),
            getString(name) {
                return typeof commandOptions[name] === 'string' ? commandOptions[name] : null;
            },
            getInteger(name) {
                return Number.isInteger(commandOptions[name]) ? commandOptions[name] : null;
            },
            getNumber(name) {
                return typeof commandOptions[name] === 'number' ? commandOptions[name] : null;
            },
            getBoolean(name) {
                return typeof commandOptions[name] === 'boolean' ? commandOptions[name] : null;
            },
            getUser(name) {
                return resolvedUsers[name] || null;
            },
            getMember(name) {
                return resolvedMembers[name] || null;
            },
            getChannel(name) {
                return commandOptions[name] || null;
            },
            getRole(name) {
                return commandOptions[name] || null;
            },
            getMentionable(name) {
                return commandOptions[name] || resolvedUsers[name] || null;
            },
            getFocused() {
                return null;
            }
        },
        replied: false,
        deferred: false,
        isRepliable: () => true,
        isChatInputCommand: () => true,
        deferReply: async () => {
            interaction.deferred = true;
        },
        reply: async payload => {
            interaction.replied = true;
            return makeResponse(payload);
        },
        editReply: async payload => {
            interaction.replied = true;
            return makeResponse(payload, true);
        },
        followUp: async payload => makeResponse(payload),
        fetchReply: async () => responseMessage,
        deleteReply: async () => {
            if (responseMessage) await responseMessage.delete();
            responseMessage = null;
        },
        complete: async () => {
            settleResponse({ message: `/${commandName} exécutée.` });
        },
        fail: error => {
            if (!firstResponseSettled) settleResponse(null, error);
            else {
                channel.send({ content: `❌ La commande /${commandName} a échoué après son lancement. Consultez les journaux du bot.` })
                    .catch(sendError => console.error(`Impossible de signaler l’échec de /${commandName} :`, sendError));
            }
        }
    };

    interaction.initialResponse = initialResponse;
    return interaction;
}

module.exports = registerControlPanelCommands;
