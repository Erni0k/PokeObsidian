import { App, PluginSettingTab, Setting } from "obsidian";
import type PokemonCollectionPlugin from "./main";
import {
	SORT_FIELD_LABELS,
	SortDirection,
	SortField,
} from "./parser/MarkdownParser";

/** Languages supported by the TCGdex API. */
export const SUPPORTED_LANGUAGES = [
	"en",
	"fr",
	"de",
	"es",
	"it",
	"pt",
	"pt-br",
	"nl",
	"pl",
	"ru",
	"ja",
	"ko",
	"zh-cn",
	"zh-tw",
	"id",
	"th",
] as const;

export type PriceProvider = "tcgdex-cardmarket";

export interface PokemonCollectionSettings {
	/** Language used for all TCGdex API calls. */
	preferredLanguage: string;
	/** Display currency. Fixed to EUR in v1 (Cardmarket source). */
	preferredCurrency: string;
	/** Price data provider. Only TCGdex/Cardmarket in v1. */
	priceProvider: PriceProvider;
	/** Auto-update interval in minutes. 0 = disabled (manual only). */
	autoUpdateIntervalMinutes: number;
	/** How long cached API responses stay fresh, in hours. */
	cacheDurationHours: number;
	/** Default quantity added per "Add Card" action. */
	defaultQuantity: number;
	/** Rendered image width in pixels (previews). */
	imageSize: number;
	/** Whether to show card image previews. */
	enableImagePreviews: boolean;
	/** Folder scanned by the dashboard for collection notes. */
	collectionFolder: string;
	/** Keep collection tables sorted automatically after every change. */
	autoSort: boolean;
	/** Field used for auto-sorting. */
	autoSortField: SortField;
	/** Direction used for auto-sorting. */
	autoSortDirection: SortDirection;
}

export const DEFAULT_SETTINGS: PokemonCollectionSettings = {
	preferredLanguage: "en",
	preferredCurrency: "EUR",
	priceProvider: "tcgdex-cardmarket",
	autoUpdateIntervalMinutes: 0,
	cacheDurationHours: 24,
	defaultQuantity: 1,
	imageSize: 200,
	enableImagePreviews: false,
	collectionFolder: "Pokemon",
	autoSort: false,
	autoSortField: "name",
	autoSortDirection: "asc",
};

export class PokemonCollectionSettingTab extends PluginSettingTab {
	plugin: PokemonCollectionPlugin;

	constructor(app: App, plugin: PokemonCollectionPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Pokémon Collection settings" });

		new Setting(containerEl)
			.setName("Preferred language")
			.setDesc("Language used for TCGdex API lookups (card names, images).")
			.addDropdown((dd) => {
				for (const lang of SUPPORTED_LANGUAGES) {
					dd.addOption(lang, lang.toUpperCase());
				}
				dd.setValue(this.plugin.settings.preferredLanguage).onChange(
					async (value) => {
						this.plugin.settings.preferredLanguage = value;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Currency")
			.setDesc(
				"Display currency. v1 sources prices from Cardmarket (EUR) only."
			)
			.addText((text) => {
				text.setValue(this.plugin.settings.preferredCurrency).setDisabled(
					true
				);
			});

		new Setting(containerEl)
			.setName("Price provider")
			.setDesc("Source of market prices.")
			.addDropdown((dd) => {
				dd.addOption("tcgdex-cardmarket", "TCGdex — Cardmarket (EUR)");
				dd.setValue(this.plugin.settings.priceProvider).onChange(
					async (value) => {
						this.plugin.settings.priceProvider = value as PriceProvider;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Collection folder")
			.setDesc(
				"Folder scanned by the dashboard for collection notes (leave blank to scan the whole vault)."
			)
			.addText((text) => {
				text
					.setPlaceholder("Pokemon")
					.setValue(this.plugin.settings.collectionFolder)
					.onChange(async (value) => {
						this.plugin.settings.collectionFolder = value.trim();
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Keep table sorted")
			.setDesc(
				"Automatically re-sort the collection table after adding a card or updating prices."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.autoSort)
					.onChange(async (value) => {
						this.plugin.settings.autoSort = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Auto-sort field")
			.setDesc("Field used when \"Keep table sorted\" is on.")
			.addDropdown((dd) => {
				for (const key of Object.keys(SORT_FIELD_LABELS) as SortField[]) {
					dd.addOption(key, SORT_FIELD_LABELS[key]);
				}
				dd.setValue(this.plugin.settings.autoSortField).onChange(
					async (value) => {
						this.plugin.settings.autoSortField = value as SortField;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Auto-sort direction")
			.addDropdown((dd) => {
				dd.addOption("asc", "Ascending (A→Z, low→high)");
				dd.addOption("desc", "Descending (Z→A, high→low)");
				dd.setValue(this.plugin.settings.autoSortDirection).onChange(
					async (value) => {
						this.plugin.settings.autoSortDirection = value as SortDirection;
						await this.plugin.saveSettings();
					}
				);
			});

		new Setting(containerEl)
			.setName("Default quantity")
			.setDesc("Quantity added when inserting a card.")
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.defaultQuantity))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.defaultQuantity =
							Number.isFinite(n) && n > 0 ? n : 1;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Auto-update interval")
			.setDesc(
				"Automatically refresh all collection prices every N minutes. 0 disables it."
			)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.autoUpdateIntervalMinutes))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.autoUpdateIntervalMinutes =
							Number.isFinite(n) && n >= 0 ? n : 0;
						await this.plugin.saveSettings();
						this.plugin.restartAutoUpdate();
					});
			});

		new Setting(containerEl)
			.setName("Cache duration (hours)")
			.setDesc("How long TCGdex API responses are considered fresh.")
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.cacheDurationHours))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.cacheDurationHours =
							Number.isFinite(n) && n > 0 ? n : 24;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Enable image previews")
			.setDesc("Show card images in search results and the variant selector.")
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.enableImagePreviews)
					.onChange(async (value) => {
						this.plugin.settings.enableImagePreviews = value;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Image size (px)")
			.setDesc("Width of rendered card image previews.")
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.imageSize))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.imageSize =
							Number.isFinite(n) && n > 0 ? n : 200;
						await this.plugin.saveSettings();
					});
			});

		containerEl.createEl("hr");
		const actions = containerEl.createDiv();
		new Setting(actions)
			.setName("Clear API cache")
			.setDesc("Remove cached TCGdex responses (price history is kept).")
			.addButton((btn) => {
				btn.setButtonText("Clear cache").onClick(async () => {
					await this.plugin.cache.clearApiCache();
				});
			});
	}
}
