/* eslint-disable @typescript-eslint/no-non-null-assertion */
import {
	APIApplicationCommandOption,
	APIApplicationCommandOptionChoice,
	ApplicationCommandOptionType,
	ApplicationCommandType,
	ChatInputCommandInteraction,
	CommandInteractionOption,
	GuildMember,
	RESTPostAPIApplicationGuildCommandsJSONBody,
	Routes,
	Snowflake,
	User
} from 'discord.js';

import type { CommandOption, CommandOptions } from '../lib/types';
import type { ICommand } from './structures/ICommand';
import type { MahojiClient } from './structures/Mahoji';

export function isValidCommand(data: any): data is ICommand {
	if (!isValidPiece(data)) return false;
	if (!data.name || typeof data.name !== 'string' || data.name.length < 1 || data.name.length > 32) {
		return false;
	}
	if (
		!data.description ||
		typeof data.description !== 'string' ||
		data.description.length < 1 ||
		data.description.length > 100
	) {
		return false;
	}
	if (typeof data.run !== 'function') return false;
	return true;
}

export function isValidPiece(data: any) {
	if (!data || !data.name) return false;
	return true;
}

export function convertCommandOptionToAPIOption(option: CommandOption): APIApplicationCommandOption {
	switch (option.type) {
		case ApplicationCommandOptionType.Number:
		case ApplicationCommandOptionType.Integer:
		case ApplicationCommandOptionType.String: {
			return {
				...option,
				autocomplete: 'autocomplete' in option ?? undefined
			};
		}

		default: {
			return {
				...option,
				// TODO(gc): How the fuck do I fix this
				// @ts-ignore
				options:
					'options' in option && option.options ? option.options.map(convertCommandOptionToAPIOption) : []
			};
		}
	}
}

export function convertCommandToAPICommand(
	cmd: ICommand
): RESTPostAPIApplicationGuildCommandsJSONBody & { description: string } {
	return {
		type: ApplicationCommandType.ChatInput,
		name: cmd.name,
		description: cmd.description,
		options: cmd.options.map(convertCommandOptionToAPIOption)
	};
}

export async function bulkUpdateCommands({
	client,
	commands,
	guildID
}: {
	client: MahojiClient;
	commands: ICommand[];
	guildID: Snowflake | null;
}) {
	const apiCommands = commands.map(convertCommandToAPICommand);

	const route =
		guildID === null
			? Routes.applicationCommands(client.applicationID)
			: Routes.applicationGuildCommands(client.applicationID, guildID);

	return client.djsClient.rest.put(route, {
		body: apiCommands
	});
}

export async function updateCommand({
	client,
	command,
	guildID
}: {
	client: MahojiClient;
	command: ICommand;
	guildID: Snowflake | null;
}) {
	const apiCommand = convertCommandToAPICommand(command);
	const route =
		guildID === null
			? Routes.applicationCommands(client.applicationID)
			: Routes.applicationGuildCommands(client.applicationID, guildID ?? command.guildID);
	return client.djsClient.rest.post(route, {
		body: apiCommand
	});
}

export function convertAPIOptionsToCommandOptions(
	options: ChatInputCommandInteraction['options']['data'],
	resolvedObjects: ChatInputCommandInteraction['options']['resolved'] | null
): CommandOptions {
	if (!options) return {};

	let parsedOptions: CommandOptions = {};

	for (const opt of options) {
		if (
			opt.type === ApplicationCommandOptionType.SubcommandGroup ||
			opt.type === ApplicationCommandOptionType.Subcommand
		) {
			let opts: CommandOptions = {};
			for (const [key, value] of Object.entries(
				convertAPIOptionsToCommandOptions(opt.options ?? [], resolvedObjects)
			)) {
				opts[key] = value;
			}
			parsedOptions[opt.name] = opts;
		} else if (opt.type === ApplicationCommandOptionType.Channel) {
			if (resolvedObjects?.channels) {
				parsedOptions[opt.name] = resolvedObjects.channels.get(opt.value as string)!;
			}
		} else if (opt.type === ApplicationCommandOptionType.Role) {
			if (resolvedObjects?.roles) {
				parsedOptions[opt.name] = resolvedObjects.roles.get(opt.value as string)!;
			}
		} else if (opt.type === ApplicationCommandOptionType.User) {
			if (resolvedObjects?.users && resolvedObjects.members) {
				parsedOptions[opt.name] = {
					user: resolvedObjects.users.get(opt.value as string)!,
					member: resolvedObjects.members.get(opt.value as string)!
				};
			}
		} else {
			parsedOptions[opt.name as string] = opt.value as any;
		}
	}

	return parsedOptions;
}

export async function handleAutocomplete(
	command: ICommand | undefined,
	autocompleteData: CommandInteractionOption[],
	member: GuildMember | undefined,
	user: User,
	option?: CommandOption
): Promise<APIApplicationCommandOptionChoice[]> {
	if (!command || !autocompleteData) return [];
	const data = autocompleteData.find(i => 'focused' in i && i.focused === true) ?? autocompleteData[0];
	if (data.type === ApplicationCommandOptionType.SubcommandGroup) {
		const group = command.options.find(c => c.name === data.name);
		if (group?.type !== ApplicationCommandOptionType.SubcommandGroup) return [];
		const subCommand = group.options?.find(
			c => c.name === data.options?.[0].name && c.type === ApplicationCommandOptionType.Subcommand
		);
		if (
			!subCommand ||
			!data.options ||
			!data.options[0] ||
			subCommand.type !== ApplicationCommandOptionType.Subcommand
		) {
			return [];
		}
		const option = data.options[0].options?.find(t => (t as any).focused);
		if (!option) return [];
		const subSubCommand = subCommand.options?.find(o => o.name === option.name);
		return handleAutocomplete(command, [option], member, user, subSubCommand);
	}
	if (data.type === ApplicationCommandOptionType.Subcommand) {
		if (!data.options || !data.options[0]) return [];
		const subCommand = command.options.find(c => c.name === data.name);
		if (subCommand?.type !== ApplicationCommandOptionType.Subcommand) return [];
		const option = data.options.find(o => ('focused' in o ? Boolean(o.focused) : false)) ?? data.options[0];
		const subOption = subCommand.options?.find(c => c.name === option.name);
		if (!subOption) return [];

		return handleAutocomplete(command, [option], member, user, subOption);
	}

	const optionBeingAutocompleted = option ?? command.options.find(o => o.name === data.name);

	if (
		optionBeingAutocompleted &&
		'autocomplete' in optionBeingAutocompleted &&
		optionBeingAutocompleted.autocomplete !== undefined
	) {
		const autocompleteResult = await optionBeingAutocompleted.autocomplete(data.value as never, user, member);
		return autocompleteResult.slice(0, 25).map(i => ({
			name: i.name,
			value: i.value.toString()
		}));
	}
	return [];
}
