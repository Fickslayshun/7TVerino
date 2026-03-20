// REST Helpers
// Fetches initial data from API
import { BitField, EmoteSetFlags } from "@/common/Flags";
import { imageHostToSrcset } from "@/common/Image";
import { log } from "@/common/Logger";
import { convertBttvEmoteSet, convertFFZEmoteSet, convertFfzBadges } from "@/common/Transform";
import { db } from "@/db/idb";
import type { WorkerDriver } from "./worker.driver";
import type { WorkerPort } from "./worker.port";
import { EventAPIMessage, EventAPIMessageData, TypedWorkerMessage } from ".";

namespace API_BASE {
	export const SEVENTV = import.meta.env.VITE_APP_API;
	export const FFZ = "https://api.frankerfacez.com/v1";
	export const BTTV = "https://api.betterttv.net/3";
}

enum ProviderPriority {
	BTTV_GLOBAL,
	FFZ_GLOBAL,
	SEVENTV_GLOBAL,
	BTTV,
	FFZ,
	SEVENTV,
	TWITCH,
}

const SHOULD_LOG_API_RESPONSE_BODY = import.meta.env.MODE !== "production";
const sevenTVUserConnectionLoads = new Map<string, Promise<SevenTV.UserConnection>>();

export class WorkerHttp {
	private lastPresenceAt: Map<string, number> = new Map();
	private tverinoGlobalBadgeSetsPromise: Promise<Map<string, Map<string, Twitch.ChatBadge>>> | null = null;
	private tverinoChannelBadgeSetsPromises = new Map<string, Promise<Map<string, Map<string, Twitch.ChatBadge>>>>();
	private personalEmoteSetLoads = new Map<string, Promise<void>>();
	static imageFormat: SevenTV.ImageFormat = "WEBP";

	constructor(private driver: WorkerDriver) {
		this.driver = driver;

		driver.addEventListener("join_channel", (ev) =>
			ev.port ? this.fetchChannelData(ev.detail, ev.port) : undefined,
		);
		driver.addEventListener("part_channel", (ev) => {
			if (!ev.port) return;

			this.driver.eventAPI.unsubscribeChannel(ev.detail.id, ev.port);
		});
		driver.addEventListener("identity_updated", async (ev) => {
			const user = await this.API()
				.seventv.loadUserData(ev.port?.platform ?? "TWITCH", ev.detail.id)
				.catch(() => void 0);
			if (user && ev.port) {
				ev.port.user = user;
			}

			ev.port?.postMessage("IDENTITY_FETCHED", {
				user: user ?? null,
			});
		});
		driver.addEventListener("set_channel_presence", (ev) => {
			if (!ev.port || !ev.port.platform || !ev.port.user || !ev.detail) return;

			const lastPresenceAt = this.lastPresenceAt?.get(ev.detail.id);
			if (lastPresenceAt && lastPresenceAt > Date.now() - 1e4) {
				return;
			}

			this.lastPresenceAt.set(ev.detail.id, Date.now());
			this.writePresence(ev.port.platform, ev.port.user.id, ev.detail.id);
		});
		driver.addEventListener("imageformat_updated", async (ev) => {
			if (!ev.port) return;
			WorkerHttp.imageFormat = ev.port.imageFormat!;
		});
		driver.addEventListener("request_user_cosmetics", async (ev) => {
			if (!ev.port) return;

			const { identifiers, kinds } = ev.detail;
			const shouldLoadCosmetics = kinds.some((kind) => kind !== "EMOTE_SET");
			const shouldLoadEmoteSet = kinds.includes("EMOTE_SET");

			if (shouldLoadCosmetics) {
				const cosmeticEvents = await this.API()
					.seventv.loadUserCosmetics(identifiers)
					.catch(() => void 0);

				if (cosmeticEvents) {
					for (const cosmeticEvent of cosmeticEvents) {
						this.driver.eventAPI.onDispatch(cosmeticEvent);
					}
				}
			}

			if (shouldLoadEmoteSet) {
				await Promise.allSettled(
					identifiers
						.filter((identifier): identifier is ["id", string] => identifier[0] === "id" && !!identifier[1])
						.map(([, id]) => this.loadPersonalEmoteSetForUserOnce(ev.port!, id)),
				);
			}
		});
		driver.addEventListener("tverino_badge_sets_fetch", async (ev) => {
			if (!ev.port) return;

			const { requestID, channelID, clientID, token } = ev.detail;
			try {
				const badgeSets = await this.fetchTverinoBadgeSets(channelID, clientID, token);
				ev.port.postMessage("TVERINO_BADGE_SETS_RESULT", {
					requestID,
					channelID,
					badgeSets,
				});
			} catch (err) {
				ev.port.postMessage("TVERINO_BADGE_SETS_RESULT", {
					requestID,
					channelID,
					badgeSets: null,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		});
		driver.addEventListener("tverino_custom_reward_redeem", async (ev) => {
			if (!ev.port) return;

			const { requestID, channelID, rewardID } = ev.detail;
			try {
				await this.redeemTverinoCustomReward(ev.detail);
				ev.port.postMessage("TVERINO_CUSTOM_REWARD_REDEEM_RESULT", {
					requestID,
					channelID,
					rewardID,
					ok: true,
				});
			} catch (err) {
				ev.port.postMessage("TVERINO_CUSTOM_REWARD_REDEEM_RESULT", {
					requestID,
					channelID,
					rewardID,
					ok: false,
					error: err instanceof Error ? err.message : String(err),
				});
			}
		});
	}

	private async fetchTverinoBadgeSets(
		channelID: string,
		clientID: string,
		token: string,
	): Promise<Twitch.BadgeSets> {
		const [globalsBySet, channelsBySet] = await Promise.all([
			this.fetchTverinoGlobalBadgeSets(clientID, token),
			this.fetchTverinoChannelBadgeSets(channelID, clientID, token),
		]);

		return {
			globalsBySet,
			channelsBySet,
			count: globalsBySet.size + channelsBySet.size,
		};
	}

	private fetchTverinoGlobalBadgeSets(
		clientID: string,
		token: string,
	): Promise<Map<string, Map<string, Twitch.ChatBadge>>> {
		this.tverinoGlobalBadgeSetsPromise ??= fetchTwitchHelixBadgeSets(
			"https://api.twitch.tv/helix/chat/badges/global",
			clientID,
			token,
		).catch((err) => {
			this.tverinoGlobalBadgeSetsPromise = null;
			throw err;
		});
		return this.tverinoGlobalBadgeSetsPromise;
	}

	private fetchTverinoChannelBadgeSets(
		channelID: string,
		clientID: string,
		token: string,
	): Promise<Map<string, Map<string, Twitch.ChatBadge>>> {
		const normalizedChannelID = channelID.trim();
		if (!normalizedChannelID) {
			return Promise.resolve(new Map());
		}

		let pending = this.tverinoChannelBadgeSetsPromises.get(normalizedChannelID);
		if (!pending) {
			pending = fetchTwitchHelixBadgeSets(
				`https://api.twitch.tv/helix/chat/badges?broadcaster_id=${encodeURIComponent(normalizedChannelID)}`,
				clientID,
				token,
			).catch((err) => {
				this.tverinoChannelBadgeSetsPromises.delete(normalizedChannelID);
				throw err;
			});
			this.tverinoChannelBadgeSetsPromises.set(normalizedChannelID, pending);
		}

		return pending;
	}

	private async redeemTverinoCustomReward(
		input: TypedWorkerMessage<"TVERINO_CUSTOM_REWARD_REDEEM">,
	): Promise<void> {
		const gqlPayload = JSON.stringify([
			{
				operationName: "RedeemCustomReward",
				variables: {
					input: {
						channelID: input.channelID,
						cost: input.cost,
						prompt: input.prompt ?? null,
						rewardID: input.rewardID,
						title: input.title,
						transactionID: input.transactionID ?? createHexToken(16),
					},
				},
				extensions: {
					persistedQuery: {
						version: 1,
						sha256Hash: "d56249a7adb4978898ea3412e196688d4ac3cea1c0c2dfd65561d229ea5dcc42",
					},
				},
			},
		]);

		let bearerError: unknown = null;
		if (input.token?.trim()) {
			try {
				const attemptWithBearer = await this.postTwitchRewardRedemptionRequest(
					gqlPayload,
					input.clientID,
					input.token,
					false,
				);
				const bearerResult = attemptWithBearer[0];
				if (bearerResult?.data?.redeemCommunityPointsCustomReward?.redemption?.id) {
					return;
				}

				const bearerMessage = extractTwitchGraphQLError(attemptWithBearer);
				if (bearerMessage) {
					throw new Error(bearerMessage);
				}
			} catch (error) {
				bearerError = error;
			}
		}

		const attemptWithCookies = await this.postTwitchRewardRedemptionRequest(gqlPayload, input.clientID, undefined, true).catch(
			(error) => {
				if (bearerError instanceof Error && bearerError.message.trim()) throw bearerError;
				throw error;
			},
		);
		const cookieResult = attemptWithCookies[0];
		if (cookieResult?.data?.redeemCommunityPointsCustomReward?.redemption?.id) {
			return;
		}

		const cookieMessage = extractTwitchGraphQLError(attemptWithCookies);
		if (cookieMessage) {
			throw new Error(cookieMessage);
		}

		if (bearerError instanceof Error && bearerError.message.trim()) {
			throw bearerError;
		}

		throw new Error("Reward redemption was not accepted");
	}

	private async postTwitchRewardRedemptionRequest(
		body: string,
		clientID: string,
		token?: string,
		includeCredentials = false,
	): Promise<TwitchPersistedMutationResponse[]> {
		const headers = {
			"Client-Id": clientID.trim(),
			"Content-Type": "application/json",
		} as Record<string, string>;

		if (token?.trim()) {
			headers.Authorization = `Bearer ${token.trim().replace(/^oauth:/i, "")}`;
		}

		const response = await fetch("https://gql.twitch.tv/gql#origin=twilight", {
			method: "POST",
			headers,
			body,
			credentials: includeCredentials ? "include" : "omit",
		});

		if (!response.ok) {
			throw new Error(`Reward redemption failed: ${response.status}`);
		}

		return (await response.json()) as TwitchPersistedMutationResponse[];
	}

	public async fetchConfig(): Promise<SevenTV.Config> {
		const configName =
			"extension" +
			(import.meta.env.VITE_APP_VERSION_BRANCH ? `-${import.meta.env.VITE_APP_VERSION_BRANCH}` : "");
		const resp = await doRequest<SevenTV.Config>(API_BASE.SEVENTV, `config/${configName}`, "GET").catch((err) =>
			Promise.reject(err),
		);
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const data = await resp.json();
		return Promise.resolve(data);
	}

	public async fetchChannelData(channel: CurrentChannel, port: WorkerPort) {
		await this.driver.db.ready();

		this.driver.log.debug(`<Net/Http> fetching channel data for #${channel.username}`);

		const userPromise = port.providers.has("7TV")
			? seventv.loadUserConnection(port.platform ?? "TWITCH", channel.id).catch(() => void 0)
			: Promise.resolve(void 0);
		const providerSetPromises = [
			["7TV", userPromise.then((es) => (es ? es.emote_set : null)).catch(() => void 0)],
			["FFZ", port.providers.has("FFZ") ? frankerfacez.loadUserEmoteSet(channel.id).catch(() => void 0) : Promise.resolve(void 0)],
			["BTTV", port.providers.has("BTTV") ? betterttv.loadUserEmoteSet(channel.id).catch(() => void 0) : Promise.resolve(void 0)],
		] as [SevenTV.Provider, Promise<SevenTV.EmoteSet | null | undefined>][];

		const existingChannel = await db.channels.where("id").equals(channel.id).first().catch(() => void 0);
		const existingSetIDs = Array.isArray(existingChannel?.set_ids) ? [...existingChannel.set_ids] : [];
		const existingSets = existingSetIDs.length
			? await db.emoteSets.where("id").anyOf(existingSetIDs).toArray().catch(() => [] as SevenTV.EmoteSet[])
			: [];
		const staleSetIDsByProvider = new Map<SevenTV.Provider, string[]>();
		for (const set of existingSets) {
			if (!set.provider) continue;
			const provider = set.provider as SevenTV.Provider;
			if (!["7TV", "FFZ", "BTTV"].includes(provider)) continue;

			const staleSetIDs = staleSetIDsByProvider.get(provider) ?? [];
			staleSetIDs.push(set.id);
			staleSetIDsByProvider.set(provider, staleSetIDs);
		}

		// store the channel into IDB
		await db.withErrorFallback(
			db.channels.put({
				id: channel.id,
				platform: port.platform as Platform,
				set_ids: existingSetIDs,
			}),
			() =>
				db.channels.where("id").equals(channel.id).modify({
					platform: port.platform as Platform,
					set_ids: existingSetIDs,
				}),
		);

		const onResult = async (set: SevenTV.EmoteSet) => {
			if (!set || !set.id || !set.provider) return;
			const provider = set.provider as SevenTV.Provider;

			// store set to DB
			await db.withErrorFallback(db.emoteSets.put(set), () =>
				db.emoteSets.where({ id: set.id, provider: set.provider }).modify(set),
			);

			// add set ID to the channel
			await db.channels
				.where("id")
				.equals(channel.id)
				.modify((x) => {
					if (!Array.isArray(x.set_ids)) x.set_ids = [];

					for (const staleSetID of staleSetIDsByProvider.get(provider) ?? []) {
						if (staleSetID === set.id) continue;
						const staleIndex = x.set_ids.indexOf(staleSetID);
						if (staleIndex !== -1) {
							x.set_ids.splice(staleIndex, 1);
						}
					}

					staleSetIDsByProvider.set(provider, [set.id]);
					if (!x.set_ids.includes(set.id)) x.set_ids.push(set.id);
				});

			if (set.provider == "7TV") {
				this.driver.eventAPI.subscribe(
					"emote_set.*",
					{
						object_id: set.id,
					},
					port,
					channel.id,
				);
			}
		};

		// iterate results and store sets to DB
		Promise.allSettled(
			providerSetPromises.map(([provider, pendingSet]) =>
				pendingSet
					.then((set) => {
						if (!set) return;
						return onResult(set);
					})
						.catch((err) =>
							this.driver.log.error(
								`<Net/Http> failed to load emote set from provider ${provider} in #${channel.username}`,
								err,
							),
						),
				),
		).then(() => {
			port?.postMessage("CHANNEL_SETS_FETCHED", {
				channel,
			});
		});

		channel.user = (await userPromise)?.user ?? undefined;
		if (port) {
			// Post channel fetch notification back to port
			port.postMessage("CHANNEL_FETCHED", {
				channel,
			});
		}

		const stvUser = (await userPromise)?.user;
		if (stvUser) {
			this.driver.eventAPI.subscribe("user.*", { object_id: stvUser.id }, port, channel.id);
		}

		// begin subscriptions to personal events in the channel
		const cond = {
			ctx: "channel",
			platform: port.platform ?? "TWITCH",
			id: channel.id,
		};

		this.driver.eventAPI.subscribe("entitlement.*", cond, port, channel.id);
		this.driver.eventAPI.subscribe("cosmetic.*", cond, port, channel.id);
		this.driver.eventAPI.subscribe("emote_set.*", cond, port, channel.id);

		// Send an initial presence so that the current user immediately has their cosmetics
		// (sent with "self" property, so that the presence and entitlements are not published)
		if (port.platform && port.user) {
			this.writePresence(port.platform, port.user.id, channel.id, true);
		}

		// Fetch 3rd party static cosmetics if relevant
		Promise.all([
			port.providerExtensions.has("FFZ") // load ffz badges if their extension is installed
				? await this.API()
						.frankerfacez.loadCosmetics()
						.catch(() => void 0)
				: void 0,
		]).then(([ffz]) => {
			const badges = [...(ffz ? convertFfzBadges(ffz) : [])];

			setTimeout(() => {
				port.postMessage("STATIC_COSMETICS_FETCHED", {
					badges,
					paints: [],
				});
			}, 5000);

			log.info(`<3rd Party Cosmetics> ${badges.length} badges`);
		});
	}

	/**
	 * Emit a presence update to 7TV for the given user & channel location
	 *
	 * This will make the EventAPI send the user's entitlements to other users in the channel
	 * @param self if true, the entitlements will only be sent to the current user
	 */
	async writePresence(platform: Platform, userID: string, channelID: string, self?: boolean): Promise<void> {
		doRequest(API_BASE.SEVENTV, `users/${userID}/presences`, "POST", {
			kind: 1,
			passive: self,
			session_id: self ? this.driver.eventAPI.sessionID : undefined,
			data: {
				platform,
				id: channelID,
			},
		}).then(() => log.debug("<API> Presence sent"));
	}

	public API() {
		return {
			seventv,
			frankerfacez,
			betterttv,
		};
	}

	private loadPersonalEmoteSetForUserOnce(port: WorkerPort, userID: string): Promise<void> {
		const key = `${port.platform ?? "UNKNOWN"}:${userID}`;
		const existing = this.personalEmoteSetLoads.get(key);
		if (existing) return existing;

		const pendingLoad = this.loadPersonalEmoteSetForUser(port, userID).finally(() => {
			if (this.personalEmoteSetLoads.get(key) === pendingLoad) {
				this.personalEmoteSetLoads.delete(key);
			}
		});

		this.personalEmoteSetLoads.set(key, pendingLoad);
		return pendingLoad;
	}

	private buildPersonalEmoteEntitlementScope(platform: Platform): string {
		const scopeChannels = new Set<string>();

		for (const targetPort of this.driver.ports.values()) {
			if (targetPort.platform !== platform) continue;
			for (const channelID of targetPort.channelIds) {
				scopeChannels.add(channelID ?? "X");
			}
		}

		return Array.from(scopeChannels)
			.map((channelID) => `${platform}:${channelID}`)
			.join(",");
	}

	private async loadPersonalEmoteSetForUser(port: WorkerPort, userID: string): Promise<void> {
		if (!port.platform) return;

		const user = await this.API()
			.seventv.loadUserData(port.platform, userID)
			.catch(() => void 0);
		if (!user?.emote_sets?.length) return;

		const personalSetIDs = user.emote_sets
			.filter((set) => BitField(EmoteSetFlags, set.flags ?? 0).has("Personal"))
			.map((set) => set.id)
			.filter(Boolean);
		const existingEntitlements = await db.entitlements
			.filter((ent) => ent.kind === "EMOTE_SET" && ent.platform_id === userID)
			.toArray();

		for (const entitlement of existingEntitlements) {
			if (personalSetIDs.includes(entitlement.ref_id)) continue;

			await db.entitlements.delete(entitlement.id);

			for (const targetPort of this.driver.ports.values()) {
				if (targetPort.platform !== port.platform) continue;

				targetPort.postMessage("ENTITLEMENT_DELETED", {
					id: entitlement.id,
					kind: entitlement.kind,
					ref_id: entitlement.ref_id,
					user_id: entitlement.user_id,
					platform_id: entitlement.platform_id,
				});
			}
		}
		if (!personalSetIDs.length) return;

		const loadedSets = await Promise.allSettled(personalSetIDs.map((setID) => this.API().seventv.loadEmoteSet(setID)));

		for (const result of loadedSets) {
			if (result.status !== "fulfilled") continue;

			const set = result.value;
			await db.withErrorFallback(db.emoteSets.put(set), () => db.emoteSets.where("id").equals(set.id).modify(set));

			const entitlement = {
				id: `${userID}:EMOTE_SET:${set.id}`,
				kind: "EMOTE_SET" as const,
				ref_id: set.id,
				user_id: user.id,
				platform_id: userID,
				scope: this.buildPersonalEmoteEntitlementScope(port.platform),
			};
			await db.withErrorFallback(db.entitlements.put(entitlement), () =>
				db.entitlements.where("id").equals(entitlement.id).modify(entitlement),
			);

			for (const targetPort of this.driver.ports.values()) {
				if (targetPort.platform !== port.platform) continue;

				targetPort.postMessage("ENTITLEMENT_CREATED", entitlement);
			}
		}
	}
}

export const seventv = {
	async loadUserConnection(platform: Platform, id: string): Promise<SevenTV.UserConnection> {
		const data = await loadSevenTVUserConnection(platform, id);

		const set = structuredClone(data.emote_set) as SevenTV.EmoteSet;

		set.provider = "7TV";
		set.scope = "CHANNEL";
		set.priority = ProviderPriority.SEVENTV;

		set.emotes.map((ae) => {
			ae.provider = set.provider;
			ae.scope = "CHANNEL";

			if (ae.data) ae.data.host.srcset = imageHostToSrcset(ae.data.host, "7TV", WorkerHttp.imageFormat, 2);
			return ae;
		});

		data.emote_set = set;

		return Promise.resolve(data);
	},

	async loadEmoteSet(id: string): Promise<SevenTV.EmoteSet> {
		const resp = await doRequest(API_BASE.SEVENTV, `emote-sets/${id}`).catch((err) => Promise.reject(err));
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const set = (await resp.json()) as SevenTV.EmoteSet;

		set.provider = "7TV";
		if (id === "global") set.scope = "GLOBAL";
		else if (BitField(EmoteSetFlags, set.flags ?? 0).has("Personal")) set.scope = "PERSONAL";
		else set.scope = "CHANNEL";
		set.priority = ProviderPriority.SEVENTV_GLOBAL;

		set.emotes.map((ae) => {
			ae.provider = set.provider;
			ae.scope = set.scope;
			if (ae.data) ae.data.host.srcset = imageHostToSrcset(ae.data.host, "7TV", WorkerHttp.imageFormat, 2);

			return ae;
		});

		db.emoteSets.put(set).catch(() => db.emoteSets.where({ id: set.id, provider: "7TV" }).modify(set));
		return Promise.resolve(set);
	},

	async loadUserData(platform: Platform, id: string): Promise<SevenTV.User> {
		const userConn = await loadSevenTVUserConnection(platform, id);
		if (!userConn.user) return Promise.reject(new Error("No user was returned!"));

		return Promise.resolve(userConn.user);
	},

	async loadUserCosmetics(identifiers: ["id" | "username", string][]): Promise<EventAPIMessage<"DISPATCH">[]> {
		const body = {
			identifiers: identifiers.map(([idType, id]) => `${idType}:${id}`),
		};

		const resp = await doRequest(API_BASE.SEVENTV, "bridge/event-api", "POST", body).catch((err) =>
			Promise.reject(err),
		);

		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const cosmetics = (await resp.json()) as EventAPIMessageData<"DISPATCH">[];
		const message = cosmetics.map((c) => ({ data: c, op: "DISPATCH" })) as EventAPIMessage<"DISPATCH">[];
		return Promise.resolve(message);
	},
};

async function loadSevenTVUserConnection(platform: Platform, id: string): Promise<SevenTV.UserConnection> {
	const key = `${platform.toLowerCase()}:${id}`;
	const existing = sevenTVUserConnectionLoads.get(key);
	if (existing) {
		return structuredClone(await existing);
	}

	const pending = doRequest(API_BASE.SEVENTV, `users/${platform.toLowerCase()}/${id}`)
		.then(async (resp) => {
			if (!resp || resp.status !== 200) {
				return Promise.reject(resp);
			}

			return (await resp.json()) as SevenTV.UserConnection;
		})
		.finally(() => {
			if (sevenTVUserConnectionLoads.get(key) === pending) {
				sevenTVUserConnectionLoads.delete(key);
			}
		});

	sevenTVUserConnectionLoads.set(key, pending);
	return structuredClone(await pending);
}

export const frankerfacez = {
	async loadUserEmoteSet(channelID: string): Promise<SevenTV.EmoteSet> {
		const resp = await doRequest(API_BASE.FFZ, `room/id/${channelID}`).catch((err) => Promise.reject(err));
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const ffz_data = (await resp.json()) as FFZ.RoomResponse;

		const set = convertFFZEmoteSet(ffz_data, channelID);

		set.scope = "CHANNEL";
		set.priority = ProviderPriority.FFZ;

		set.emotes.forEach((e) => {
			e.scope = "CHANNEL";
		});

		return Promise.resolve(set);
	},

	async loadGlobalEmoteSet(): Promise<SevenTV.EmoteSet> {
		const resp = await doRequest(API_BASE.FFZ, "set/global").catch((err) => Promise.reject(err));
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const ffz_data = (await resp.json()) as FFZ.RoomResponse;

		const set = convertFFZEmoteSet({ sets: { emoticons: ffz_data.sets["3"] } }, "GLOBAL");

		set.scope = "GLOBAL";
		set.priority = ProviderPriority.FFZ_GLOBAL;

		set.emotes.forEach((e) => {
			e.scope = "GLOBAL";
		});

		db.emoteSets.put(set).catch(() => {
			db.emoteSets.where({ id: set.id, provider: "FFZ" }).modify(set);
		});

		return Promise.resolve(set);
	},
	async loadCosmetics(): Promise<FFZ.BadgesResponse> {
		const resp = await doRequest(API_BASE.FFZ, "badges/ids");
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		return Promise.resolve(structuredClone(await resp.json()));
	},
};

export const betterttv = {
	async loadUserEmoteSet(channelID: string): Promise<SevenTV.EmoteSet> {
		const resp = await doRequest(API_BASE.BTTV, `cached/users/twitch/${channelID}`).catch((err) =>
			Promise.reject(err),
		);
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const bttv_data = (await resp.json()) as BTTV.UserResponse;

		const set = convertBttvEmoteSet(bttv_data, channelID);

		set.scope = "CHANNEL";
		set.priority = ProviderPriority.BTTV;

		set.emotes.forEach((e) => {
			e.scope = "CHANNEL";
		});

		return Promise.resolve(set);
	},

	async loadGlobalEmoteSet(): Promise<SevenTV.EmoteSet> {
		const resp = await doRequest(API_BASE.BTTV, "cached/emotes/global").catch((err) => Promise.reject(err));
		if (!resp || resp.status !== 200) {
			return Promise.reject(resp);
		}

		const bttv_data = (await resp.json()) as BTTV.Emote[];

		const data = {
			channelEmotes: bttv_data,
			sharedEmotes: [] as BTTV.Emote[],
			id: "GLOBAL",
			avatar: "",
		} as BTTV.UserResponse;

		const set = convertBttvEmoteSet(data, data.id);
		set.scope = "GLOBAL";
		set.priority = ProviderPriority.BTTV_GLOBAL;

		set.emotes.forEach((e) => {
			e.scope = "GLOBAL";
		});

		db.emoteSets.put(set).catch(() => {
			db.emoteSets.where({ id: set.id, provider: "BTTV" }).modify(set);
		});

		return Promise.resolve(set);
	},
};

async function doRequest<T = object>(base: string, path: string, method?: string, body?: T): Promise<Response> {
	return fetch(`${base}/${path}`, {
		method,
		body: body ? JSON.stringify(body) : undefined,
		headers: body
			? {
					"Content-Type": "application/json",
			  }
			: undefined,
		referrer: location.origin,
		referrerPolicy: "origin",
	}).then(async (resp) => {
		if (SHOULD_LOG_API_RESPONSE_BODY) {
			const loggable = resp.clone();
			let payload: unknown = null;

			try {
				const text = await loggable.text();
				if (text) {
					try {
						payload = JSON.parse(text);
					} catch {
						payload = text;
					}
				}
			} catch {
				payload = null;
			}

			const obj = typeof payload === "object" && payload !== null ? payload : { payload };
			log.debugWithObjects(
				["<API>", `${resp.status} ${resp.statusText}${method ?? "GET"} ${base}/${path}`],
				[obj as object],
			);
		}

		return resp;
	});
}

interface TwitchHelixBadgeVersion {
	id: string;
	image_url_1x: string;
	image_url_2x: string;
	image_url_4x: string;
	title: string;
	description: string;
	click_action: string | null;
	click_url: string | null;
}

interface TwitchHelixBadgeSet {
	set_id: string;
	versions: TwitchHelixBadgeVersion[];
}

interface TwitchHelixBadgeResponse {
	data: TwitchHelixBadgeSet[];
}

interface TwitchPersistedMutationResponse {
	data?: {
		redeemCommunityPointsCustomReward?: {
			redemption?: {
				id?: string;
			} | null;
		} | null;
	};
	errors?: {
		message?: string;
	}[];
}

async function fetchTwitchHelixBadgeSets(
	url: string,
	clientID: string,
	token: string,
): Promise<Map<string, Map<string, Twitch.ChatBadge>>> {
	const response = await fetch(url, {
		headers: {
			Authorization: `Bearer ${token.trim().replace(/^oauth:/i, "")}`,
			"Client-Id": clientID.trim(),
		},
		referrer: location.origin,
		referrerPolicy: "origin",
	});

	if (!response.ok) {
		throw new Error(`Badge request failed: ${response.status}`);
	}

	const data = (await response.json()) as TwitchHelixBadgeResponse;
	const sets = new Map<string, Map<string, Twitch.ChatBadge>>();

	for (const set of data.data ?? []) {
		const versions = new Map<string, Twitch.ChatBadge>();
		for (const badge of set.versions ?? []) {
			versions.set(badge.id, {
				id: badge.id,
				image1x: badge.image_url_1x,
				image2x: badge.image_url_2x,
				image4x: badge.image_url_4x,
				title: badge.title || badge.description || `${set.set_id} ${badge.id}`,
				clickAction: badge.click_action,
				clickURL: badge.click_url,
				setID: set.set_id,
				version: badge.id,
				__typename: "ChatBadge",
			});
		}

		if (versions.size) {
			sets.set(set.set_id, versions);
		}
	}

	return sets;
}

function createHexToken(byteLength: number): string {
	const bytes = new Uint8Array(byteLength);
	crypto.getRandomValues(bytes);
	return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function extractTwitchGraphQLError(payload: TwitchPersistedMutationResponse[]): string {
	return payload
		.flatMap((result) => result.errors ?? [])
		.map((error) => error.message || "Unknown Twitch error")
		.filter(Boolean)
		.join("; ");
}

function hasUnauthenticatedError(payload: TwitchPersistedMutationResponse[]): boolean {
	return payload.some((result) =>
		(result.errors ?? []).some((error) => /unauthenticated/i.test(error.message || "")),
	);
}
