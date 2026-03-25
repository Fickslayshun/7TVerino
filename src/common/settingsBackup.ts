import { log } from "@/common/Logger";
import { db } from "@/db/idb";

export const SETTINGS_EXPORT_FILE_NAME = "7tverino_settings.json";
export const SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY = "settings_backup_autosave_enabled";
export const SETTINGS_BACKUP_AUTOSAVE_ALARM_NAME = "settings-backup-autosave";
export const SETTINGS_BACKUP_AUTOSAVE_PERIOD_MINUTES = 60;

const deserializationFunctions: {
	[key: string]: (value: SevenTV.SettingType) => object;
} = {
	Map: (value) => {
		return new Map(value as Iterable<[string, SevenTV.SettingType]>);
	},
	Set: (value) => {
		return new Set(value as Iterable<SevenTV.SettingType>);
	},
};

export interface SerializedSettings {
	timestamp: number;
	settings: SerializedSetting[];
}

export interface SerializedSetting extends SevenTV.Setting<SevenTV.SettingType> {
	constructorName?: string;
}

export function serializeSettings(settings: SevenTV.Setting<SevenTV.SettingType>[]) {
	const serialized: SerializedSetting[] = [];

	settings.forEach((setting: SevenTV.Setting<SevenTV.SettingType>) => {
		if (setting.serialize === false) return;

		if (typeof setting.value !== "object" || setting.value === null) {
			serialized.push(setting);
			return;
		}

		const constructorName = setting.value.constructor?.name;
		if (!constructorName || !Object.keys(deserializationFunctions).includes(constructorName)) return;

		serialized.push({
			...setting,
			constructorName,
			value: Array.from(setting.value as Iterable<object>),
		} as SerializedSetting);
	});

	return serialized;
}

export function deserializeSettings(serialized: SerializedSettings) {
	if (!(serialized.settings instanceof Array)) throw new Error("invalid settings file: invalid format");

	const deserializedSettings: SevenTV.Setting<SevenTV.SettingType>[] = [];

	for (const { key, type, constructorName, value, timestamp } of serialized.settings) {
		if (key == undefined || type == undefined || value == undefined || timestamp == undefined)
			throw new Error("invalid settings file: missing keys");

		if (typeof value !== type) throw new Error(`invalid settings file: ${value} is not of type '${type}'`);

		if (type !== "object") {
			deserializedSettings.push({
				key,
				type,
				value,
			});
			continue;
		}

		if (!constructorName) throw new Error("invalid settings file: missing 'constructorName' for object type");
		if (!Object.keys(deserializationFunctions).includes(constructorName))
			throw new Error(`invalid settings file: cannot deserialize constructor type '${constructorName}'`);

		const deserializedValue: object = deserializationFunctions[constructorName](value);

		deserializedSettings.push({
			key,
			type,
			value: deserializedValue,
		});
	}

	return deserializedSettings;
}

export async function createSettingsExportBlob(): Promise<Blob> {
	await db.ready();

	const settings = await db.settings.toArray();
	const serializedSettings: SerializedSetting[] = serializeSettings(
		settings.filter((v) => v.key !== "app.version").filter((v) => v.serialize !== false),
	);

	log.info("<Settings>", "Exporting settings");

	return new Blob(
		[
			JSON.stringify({
				timestamp: Date.now(),
				settings: serializedSettings,
			} as SerializedSettings),
		],
		{
			type: "application/json",
		},
	);
}

export async function downloadSettingsBackupBlob(file: Blob): Promise<void> {
	const url = await blobToDataUrl(file);

	await new Promise<void>((resolve, reject) => {
		chrome.downloads.download(
			{
				url,
				filename: SETTINGS_EXPORT_FILE_NAME,
				conflictAction: "overwrite",
				saveAs: false,
			},
			(downloadId) => {
				const err = chrome.runtime.lastError;
				if (err) {
					reject(new Error(err.message));
					return;
				}

				if (typeof downloadId !== "number") {
					reject(new Error("failed to start settings backup download"));
					return;
				}

				resolve();
			},
		);
	});
}

export function downloadSettingsBackupBlobFallback(file: Blob): void {
	const url = URL.createObjectURL(file);
	const anchor = document.createElement("a");
	anchor.href = url;
	anchor.download = SETTINGS_EXPORT_FILE_NAME;
	anchor.click();
	setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function requestBackgroundSettingsBackupDownload(file: Blob): Promise<void> {
	const text = await file.text();
	const mimeType = file.type || "application/json";

	await new Promise<void>((resolve, reject) => {
		chrome.runtime.sendMessage(
			{
				type: "settings-backup-download",
				data: {
					text,
					mimeType,
				},
			},
			(response?: { ok?: boolean; error?: string }) => {
				const err = chrome.runtime.lastError;
				if (err) {
					reject(new Error(err.message));
					return;
				}

				if (!response?.ok) {
					reject(new Error(response?.error || "failed to export settings"));
					return;
				}

				resolve();
			},
		);
	});
}

export async function getSettingsBackupAutosaveEnabled(): Promise<boolean> {
	return new Promise<boolean>((resolve, reject) => {
		chrome.storage.local.get(SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY, (items) => {
			const err = chrome.runtime.lastError;
			if (err) {
				reject(new Error(err.message));
				return;
			}

			resolve(items[SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY] === true);
		});
	});
}

export async function setSettingsBackupAutosaveEnabled(enabled: boolean): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		chrome.storage.local.set({ [SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY]: enabled }, () => {
			const err = chrome.runtime.lastError;
			if (err) {
				reject(new Error(err.message));
				return;
			}

			resolve();
		});
	});
}

async function blobToDataUrl(file: Blob): Promise<string> {
	const body = encodeURIComponent(await file.text());
	const mimeType = file.type || "application/octet-stream";

	return `data:${mimeType};charset=utf-8,${body}`;
}
