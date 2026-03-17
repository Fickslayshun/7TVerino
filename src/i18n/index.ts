import { createI18n } from "vue-i18n";
import enUS from "@locale/en_US";

const locale: Record<string, Record<string, unknown>> = {
	en_US: enUS as Record<string, unknown>,
};

// Create i18n instance
export function setupI18n() {
	const inst = createI18n({
		locale: "en_US",
		legacy: false,
		globalInjection: true,
		messages: locale as never,
	});

	return inst;
}
