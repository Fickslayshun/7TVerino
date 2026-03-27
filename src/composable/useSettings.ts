import { Ref, customRef, reactive, toRaw } from "vue";
import { log } from "@/common/Logger";
import { createSettingsExportBlob } from "@/common/settingsBackup";
import { db } from "@/db/idb";
import { useFrankerFaceZ } from "./useFrankerFaceZ";
import { useLiveQuery } from "./useLiveQuery";

const raw = reactive({} as Record<string, SevenTV.SettingType>);
const nodes = reactive({} as Record<string, SevenTV.SettingNode>);

const ffz = useFrankerFaceZ();
const settingsBootstrap = db.ready().then(async () => {
	fillSettings(await db.settings.toArray());
});

function toConfigRef<T extends SevenTV.SettingType>(key: string, defaultValue?: T): Ref<T> {
	return customRef<T>((track, trigger) => {
		return {
			get() {
				track();
				return (raw[key] as T) ?? defaultValue;
			},
			set(newVal) {
				const n = nodes[key];
				// Only write the setting if it passes the optional predicate
				const predicate = n.predicate;
				if (predicate && !predicate(newVal)) return;
				const timestamp = Date.now();

				raw[key] = newVal;
				n.timestamp = timestamp;
				trigger();

				if (n.persist !== false) {
					const storedValue = toPersistableSettingValue(newVal);

					// Write changes to the db
					db.settings
						.put(
							{ key: key, type: typeof newVal, value: storedValue, timestamp, serialize: n.serialize },
							key,
						)
						.catch((err) => log.error("failed to write setting", key, "to db:", err));
				}

				if (typeof n.effect === "function") {
					n.effect(newVal);
				}
			},
		};
	});
}

void settingsBootstrap.then(() =>
	useLiveQuery(
		() => db.settings.toArray(),
		(s) => fillSettings(s),
	),
);

export async function fillSettings(s: SevenTV.Setting<SevenTV.SettingType>[]) {
	for (const { key, value, timestamp, serialize } of s) {
		const cur = nodes[key];
		if (cur?.timestamp && (!timestamp || cur.timestamp >= timestamp)) continue;

		raw[key] = value;
		nodes[key] = {
			...(nodes[key] ?? {}),
			timestamp,
			serialize: serialize ?? true,
			persist: nodes[key]?.persist ?? true,
		} as SevenTV.SettingNode;
	}
}

function toPersistableSettingValue<T extends SevenTV.SettingType>(value: T): T {
	return clonePersistableValue(value) as T;
}

function clonePersistableValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;

	const valueType = typeof value;
	if (valueType !== "object") return value;

	const rawValue = toRaw(value);

	if (rawValue instanceof Map) {
		return new Map(
			Array.from(rawValue.entries(), ([entryKey, entryValue]) => [entryKey, clonePersistableValue(entryValue)]),
		);
	}

	if (rawValue instanceof Set) {
		return new Set(Array.from(rawValue.values(), (entryValue) => clonePersistableValue(entryValue)));
	}

	if (rawValue instanceof Date) {
		return new Date(rawValue.getTime());
	}

	if (Array.isArray(rawValue)) {
		return rawValue.map((entryValue) => clonePersistableValue(entryValue));
	}

	return Object.fromEntries(
		Object.entries(rawValue).map(([entryKey, entryValue]) => [entryKey, clonePersistableValue(entryValue)]),
	);
}

export function waitForSettingsBootstrap(): Promise<void> {
	return settingsBootstrap;
}

export function getUnserializableSettings() {
	const out = [];
	for (const key of Object.keys(nodes)) {
		const node = nodes[key];

		if (node.serialize === false) {
			out.push(node);
			continue;
		}

		if (typeof node.defaultValue === "object" && !["Map", "Set"].includes(node.defaultValue.constructor.name)) {
			out.push(node);
			continue;
		}
	}
	return out;
}

export async function exportSettings() {
	return createSettingsExportBlob();
}

export async function importSettings(settings: SevenTV.Setting<SevenTV.SettingType>[]) {
	for (const { key, type, value } of settings) {
		if (nodes[key]?.persist === false) continue;
		const node = nodes[key];
		const timestamp = Date.now();

		await db.settings.put({ key, type, value, timestamp, serialize: node?.serialize }, key).catch((err) => {
			throw new Error(`failed to write setting, ${key}, to db:, ${err}`);
		});

		if (typeof node?.effect === "function") {
			node.effect(value);
		}
	}
	fillSettings(
		settings.map((setting) => ({
			...setting,
			timestamp: Date.now(),
		})),
	);
}

export function useConfig<T extends SevenTV.SettingType>(key: string, defaultValue?: T) {
	return toConfigRef<T>(key, defaultValue);
}

export function synchronizeFrankerFaceZ() {
	const keys = Object.keys(nodes);
	for (let i = 0; i < keys.length; i++) {
		const n = nodes[Object.keys(nodes)[i]];
		if (!n.ffz_key || raw[n.key]) continue;

		ffz.getConfigChanges(n.ffz_key, (v) => {
			raw[n.key] = typeof n.ffz_transform === "function" ? n.ffz_transform(v) : (v as SevenTV.SettingType);
		});
	}
}

export function useSettings() {
	function register(newNodes: SevenTV.SettingNode[]) {
		for (const node of newNodes) {
			const previousNode = nodes[node.key];
			nodes[node.key] = {
				...node,
				persist: node.persist ?? true,
				timestamp: previousNode?.timestamp ?? undefined,
			};

			if (node.persist === false) {
				raw[node.key] =
					previousNode === undefined || raw[node.key] === undefined ? node.defaultValue : raw[node.key];
				void db.settings.delete(node.key).catch((err) => {
					log.error("failed to delete non-persistent setting", node.key, "from db:", err);
				});

				if (typeof node.effect === "function") {
					node.effect(raw[node.key]);
				}
				continue;
			}

			if (["string", "boolean", "object", "number", "undefined"].includes(typeof raw[node.key])) {
				raw[node.key] = (() => {
					const v = raw[node.key];
					if (v === undefined) return node.defaultValue;

					if (v.constructor.name === node.defaultValue?.constructor.name) return v;

					if (typeof node.transform === "function") return node.transform(v);
					return node.defaultValue ? node.defaultValue : v;
				})();
			}

			if (typeof node.effect === "function") {
				node.effect(raw[node.key]);
			}
		}
	}

	return {
		nodes,
		register,
	};
}

export function declareConfig<T extends SevenTV.SettingType, C = SevenTV.SettingNode.ComponentType>(
	key: string,
	comType: C,
	data: Omit<SevenTV.SettingNode<T, C>, "key" | "type">,
): SevenTV.SettingNode<SevenTV.SettingType, SevenTV.SettingNode.ComponentType> {
	return {
		key,
		type: comType,
		...data,
	} as SevenTV.SettingNode<SevenTV.SettingType, SevenTV.SettingNode.ComponentType>;
}
