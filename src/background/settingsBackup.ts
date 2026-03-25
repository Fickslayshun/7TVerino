import { log } from "@/common/Logger";
import {
	createSettingsExportBlob,
	downloadSettingsBackupBlob,
	getSettingsBackupAutosaveEnabled,
	SETTINGS_BACKUP_AUTOSAVE_ALARM_NAME,
	SETTINGS_BACKUP_AUTOSAVE_PERIOD_MINUTES,
	SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY,
} from "@/common/settingsBackup";

const TWITCH_TAB_URLS = ["*://*.twitch.tv/*", "*://twitch.tv/*"];

chrome.alarms.onAlarm.addListener((alarm) => {
	if (alarm.name !== SETTINGS_BACKUP_AUTOSAVE_ALARM_NAME) return;

	void runSettingsBackupAutosave();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
	if (areaName !== "local" || !(SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY in changes)) return;

	void syncSettingsBackupAutosaveAlarm();

	if (changes[SETTINGS_BACKUP_AUTOSAVE_STORAGE_KEY]?.newValue === true) {
		void runSettingsBackupAutosave();
	}
});

void syncSettingsBackupAutosaveAlarm();

async function syncSettingsBackupAutosaveAlarm(): Promise<void> {
	try {
		const enabled = await getSettingsBackupAutosaveEnabled();
		if (!enabled) {
			await clearSettingsBackupAutosaveAlarm();
			return;
		}

		chrome.alarms.create(SETTINGS_BACKUP_AUTOSAVE_ALARM_NAME, {
			delayInMinutes: SETTINGS_BACKUP_AUTOSAVE_PERIOD_MINUTES,
			periodInMinutes: SETTINGS_BACKUP_AUTOSAVE_PERIOD_MINUTES,
		});
	} catch (err) {
		log.error("<SettingsBackup>", "failed to sync backup auto-save alarm", (err as Error).message);
	}
}

async function runSettingsBackupAutosave(): Promise<void> {
	try {
		if (!(await hasOpenTwitchTabs())) return;

		const file = await createSettingsExportBlob();
		await downloadSettingsBackupBlob(file);
		log.info("<SettingsBackup>", "Auto-saved settings backup");
	} catch (err) {
		log.error("<SettingsBackup>", "failed to auto-save settings backup", (err as Error).message);
	}
}

async function clearSettingsBackupAutosaveAlarm(): Promise<void> {
	await new Promise<void>((resolve) => {
		chrome.alarms.clear(SETTINGS_BACKUP_AUTOSAVE_ALARM_NAME, () => resolve());
	});
}

async function hasOpenTwitchTabs(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		chrome.tabs.query({ url: TWITCH_TAB_URLS }, (tabs) => {
			resolve(tabs.length > 0);
		});
	});
}
