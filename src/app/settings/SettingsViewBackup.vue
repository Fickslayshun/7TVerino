<template>
	<main class="seventv-settings-backup">
		<h3>Backup</h3>
		<p>
			Export your current settings or import from a settings file. Exports always overwrite
			<code>7tverino_settings.json</code> in your downloads folder.
		</p>

		<div class="seventv-settings-backup-buttons">
			<UiButton class="seventv-settings-backup-button" @click="exportSettingsFile">Export</UiButton>
			<UiButton class="seventv-settings-backup-button" @click="importSettingsFile">Import</UiButton>
		</div>

		<section class="seventv-settings-backup-autosave">
			<label class="seventv-settings-backup-autosave-switch" for="settings-backup-autosave">
				<input
					id="settings-backup-autosave"
					v-model="tverinoAutoSave"
					type="checkbox"
				/>
				<span class="seventv-settings-backup-autosave-track"></span>
			</label>
			<div class="seventv-settings-backup-autosave-copy">
				<h5>Auto Save</h5>
				<p>While Twitch is open, refresh `7tverino_settings.json` once per hour.</p>
				<p>One background writer handles the backup, so multiple Twitch tabs do not fight each other.</p>
			</div>
		</section>

		<div v-if="errorMessage">
			<p class="seventv-settings-backup-error">{{ errorMessage }}</p>
		</div>

		<div v-if="exportableTVerinoSettings.length > 0" class="seventv-settings-backup-status-container">
			<section class="seventv-settings-backup-status-group">
				<h5 class="seventv-settings-backup-status-title exportable">7TVerino settings able to export/import:</h5>
				<p
					v-for="label of exportableTVerinoSettings"
					:key="`exportable-${label}`"
					class="seventv-settings-backup-status-item exportable"
				>
					{{ label }}
				</p>
			</section>
		</div>
	</main>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { log } from "@/common/Logger";
import {
	exportSettings,
	importSettings,
	useConfig,
	useSettings,
} from "@/composable/useSettings";
import {
	deserializeSettings,
	downloadSettingsBackupBlobFallback,
	requestBackgroundSettingsBackupDownload,
	type SerializedSettings,
} from "@/common/settingsBackup";
import UiButton from "@/ui/UiButton.vue";

const errorMessage = ref<string>("");
const tverinoAutoSave = useConfig<boolean>("chat.tverino.auto_save", false);
const { nodes } = useSettings();

const TVERINO_EXPORTABLE_SETTING_KEYS = [
	"chat.tverino.enabled",
	"chat.tverino.timestamps",
	"chat.tverino.auto_save",
	"chat.tverino.workspace",
	"chat.recent_emote_bar.mode",
	"chat.recent_emote_bar.scope",
	"chat.recent_emote_bar.history",
	"chat.recent_emote_bar.usage",
	"chat.recent_emote_bar.channel_meta",
] as const;

function isSerializableNode(node: SevenTV.SettingNode | undefined): boolean {
	if (!node) return false;
	if (node.persist === false || node.serialize === false) return false;

	if (
		typeof node.defaultValue === "object" &&
		node.defaultValue !== null &&
		!["Map", "Set"].includes(node.defaultValue.constructor.name)
	) {
		return false;
	}

	return true;
}

function resolveSettingLabels(keys: readonly string[]): string[] {
	return keys
		.map((key) => {
			const node = nodes[key];
			if (!node) return "";
			if (!isSerializableNode(node)) return "";
			return node.label;
		})
		.filter((label): label is string => label !== "");
}

const exportableTVerinoSettings = computed(() => resolveSettingLabels(TVERINO_EXPORTABLE_SETTING_KEYS));

async function exportSettingsFile() {
	errorMessage.value = "";

	try {
		const file = await exportSettings();
		try {
			await requestBackgroundSettingsBackupDownload(file);
		} catch (err) {
			log.warn("<Settings>", "background export failed, falling back to browser download", (err as Error).message);
			downloadSettingsBackupBlobFallback(file);
		}
	} catch (err) {
		handleError("failed to export settings", err, "There was an error exporting your settings.");
	}
}

async function importSettingsFile() {
	errorMessage.value = "";

	const fileList = await open();
	if (!fileList) return;

	const raw = await read(fileList[0]);

	let serialized: SerializedSettings;
	try {
		serialized = JSON.parse(raw);
	} catch (err) {
		handleError("failed to parse settings file", err, "There was an error importing your settings.");
		return;
	}

	let deserializedSettings: SevenTV.Setting<SevenTV.SettingType>[] = [];
	try {
		deserializedSettings = deserializeSettings(serialized);
	} catch (err) {
		handleError("failed to deserialize settings file", err, "There was an error importing your settings.");
		return;
	}

	log.debugWithObjects(["<Settings>", "Deserialized settings file"], [deserializedSettings]);
	try {
		await importSettings(deserializedSettings);
		log.info("<Settings>", "Loaded settings from file");
	} catch (err) {
		handleError("failed to save settings from file", err, "There was an error importing your settings.");
	}
}

async function open(): Promise<FileList | null> {
	return new Promise((res) => {
		const input = document.createElement("input");
		input.type = "file";
		input.accept = "application/json";

		input.onchange = () => res(input.files);
		input.oncancel = () => res(null);

		input.click();
	});
}

async function read(file: Blob): Promise<string> {
	return new Promise((res, rej) => {
		const fileReader = new FileReader();
		fileReader.readAsText(file, "utf-8");
		fileReader.onload = () => {
			res(fileReader.result as string);
		};
		fileReader.onerror = (err) => rej(err);
	});
}

function handleError(context: string, err: unknown, message: string): void {
	log.error(context, (err as Error).message);
	errorMessage.value = message;
}
</script>

<style scoped lang="scss">
main.seventv-settings-backup {
	display: grid;
	place-items: center;

	.seventv-settings-backup-error {
		color: rgb(196, 43, 43);
	}

	.seventv-settings-backup-status-container {
		display: grid;
		gap: 1rem;
		width: 100%;
		max-width: 25rem;
		border: rgb(230, 230, 230) solid 1px;
		border-radius: 0.3rem;
		padding: 0.95rem 1rem;
		margin-top: 1.25rem;
	}

	.seventv-settings-backup-status-group {
		display: grid;
		gap: 0.3rem;
	}

	.seventv-settings-backup-status-title {
		margin: 0;
		color: rgb(240, 240, 240);
		font-size: 1rem;
		font-weight: 700;
	}

	.seventv-settings-backup-status-item {
		margin: 0;
		font-size: 0.98rem;
		line-height: 1.3;
	}

	.seventv-settings-backup-status-title.exportable,
	.seventv-settings-backup-status-item.exportable {
		color: rgb(116, 247, 133);
	}

	.seventv-settings-backup-buttons {
		margin-top: 20px;

		.seventv-settings-backup-button {
			margin-left: 10px;
			margin-right: 10px;
			padding: 3px 20px;
		}
	}

	.seventv-settings-backup-autosave {
		width: 100%;
		max-width: 25rem;
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 0.9rem;
		align-items: start;
		padding: 1rem;
		margin-top: 1rem;
		border: rgb(72, 72, 72) solid 1px;
		border-radius: 0.45rem;
		background: rgba(255, 255, 255, 0.03);
	}

	.seventv-settings-backup-autosave-copy {
		display: grid;
		gap: 0.35rem;

		h5,
		p {
			margin: 0;
		}

		h5 {
			color: rgb(240, 240, 240);
			font-size: 0.98rem;
			font-weight: 700;
		}

		p {
			color: rgb(204, 204, 204);
			line-height: 1.35;
		}
	}

	.seventv-settings-backup-autosave-switch {
		display: inline-block;
		height: 2rem;
		position: relative;
		width: 4rem;

		input {
			opacity: 0;
			position: absolute;
			inset: 0;

			&:focus + .seventv-settings-backup-autosave-track {
				outline: 0.1rem solid currentcolor;
			}

			&:checked + .seventv-settings-backup-autosave-track::before {
				background-color: var(--seventv-primary);
				transform: translateX(2rem);
			}

			&:disabled + .seventv-settings-backup-autosave-track {
				opacity: 0.55;
				cursor: default;
			}
		}
	}

	.seventv-settings-backup-autosave-track {
		background-color: var(--seventv-input-background);
		border-radius: 0.25rem;
		cursor: pointer;
		inset: 0;
		outline: 0.01rem solid var(--seventv-input-border);
		position: absolute;
		transition: 0.25s;
	}

	.seventv-settings-backup-autosave-track::before {
		background-color: var(--seventv-input-border);
		border-radius: 0.25rem;
		bottom: 0.3rem;
		content: "";
		height: 1.4rem;
		left: 0.3rem;
		position: absolute;
		transition: 0.25s;
		width: 1.4rem;
	}
}
</style>
