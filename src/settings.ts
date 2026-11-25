import { App, Notice, PluginSettingTab, Setting } from "obsidian";
import type PokemonCollectionPlugin from "./main";
import {
	SORT_FIELD_LABELS,
	SortDirection,
	SortField,
} from "./parser/MarkdownParser";
import {
	CONDITION_LABELS,
	CONDITIONS,
	DEFAULT_CONDITION_MULTIPLIERS,
} from "./condition";

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

export type PriceProvider = "tcgdex-cardmarket" | "tcgdex-tcgplayer";

export interface PokemonCollectionSettings {
	/** Language used for all TCGdex API calls. */
	preferredLanguage: string;
	/** Currency of the price source (kept in sync; EUR or USD). */
	preferredCurrency: string;
	/** Price source: Cardmarket (EUR) or TCGplayer (USD), both via TCGdex. */
	priceProvider: PriceProvider;
	/** Prices older than this many days are highlighted as stale. */
	stalePriceDays: number;
	/** Auto-update interval in minutes. 0 = disabled (manual only). */
	autoUpdateIntervalMinutes: number;
	/** How long cached API responses stay fresh, in hours. */
	cacheDurationHours: number;
	/** How long the cached set list (/sets) stays fresh, in hours. */
	setsListTtlHours: number;
	/** Max recorded price points kept per card. */
	priceHistoryPoints: number;
	/** Price multiplier per raw condition vs. the Cardmarket (NM) price. */
	conditionMultipliers: Record<string, number>;
	/** Default quantity added per "Add Card" action. */
	defaultQuantity: number;
	/** Rendered image width in pixels (previews). */
	imageSize: number;
	/** Whether to show card image previews in modals. */
	enableImagePreviews: boolean;
	/** Whether to embed a thumbnail Image column in the collection table. */
	imageColumn: boolean;
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
	stalePriceDays: 7,
	autoUpdateIntervalMinutes: 0,
	cacheDurationHours: 24,
	setsListTtlHours: 6,
	priceHistoryPoints: 100,
	conditionMultipliers: { ...DEFAULT_CONDITION_MULTIPLIERS },
	defaultQuantity: 1,
	imageSize: 200,
	enableImagePreviews: false,
	imageColumn: true,
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
			.setName("Price source")
			.setDesc(
				"Where market prices come from. The currency follows the source. After switching, run \"Update all collection prices\" to re-price your tables — until then, cards still priced in the old currency are kept apart (never added to the new currency)."
			)
			.addDropdown((dd) => {
				dd.addOption("tcgdex-cardmarket", "Cardmarket (EUR)");
				dd.addOption("tcgdex-tcgplayer", "TCGplayer (USD)");
				dd.setValue(this.plugin.settings.priceProvider).onChange(
					async (value) => {
						const prev = this.plugin.settings.priceProvider;
						this.plugin.settings.priceProvider = value as PriceProvider;
						this.plugin.settings.preferredCurrency = this.plugin.price.currency;
						await this.plugin.saveSettings();
						if (prev !== value) {
							new Notice(
								`Price source: ${this.plugin.price.sourceLabel} (${this.plugin.price.currency}). Run "Update all collection prices" to re-price your tables.`,
								10000
							);
						}
					}
				);
			});

		new Setting(containerEl)
			.setName("Stale price after (days)")
			.setDesc("Prices not updated for longer are highlighted in tables and the dashboard.")
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.stalePriceDays))
					.onChange(async (value) => {
						const n = Number.parseFloat(value);
						this.plugin.settings.stalePriceDays = Number.isFinite(n) && n > 0 ? n : 7;
						await this.plugin.saveSettings();
					});
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
			.setName("Set list refresh (hours)")
			.setDesc(
				'How long the list of sets stays fresh, so new releases show up sooner. Run "Refresh Pokémon sets" to update it immediately.'
			)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.setsListTtlHours))
					.onChange(async (value) => {
						const n = Number.parseFloat(value);
						this.plugin.settings.setsListTtlHours =
							Number.isFinite(n) && n > 0 ? n : 6;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Price history per card")
			.setDesc(
				"How many price changes to keep for each card (a point is recorded only when its price changes)."
			)
			.addText((text) => {
				text
					.setValue(String(this.plugin.settings.priceHistoryPoints))
					.onChange(async (value) => {
						const n = Number.parseInt(value, 10);
						this.plugin.settings.priceHistoryPoints =
							Number.isFinite(n) && n >= 2 ? n : 100;
						await this.plugin.saveSettings();
					});
			});

		new Setting(containerEl)
			.setName("Condition pricing")
			.setDesc(
				"Raw cards are priced as the market price (from the price source) × multiplier for their condition. Graded cards (with a Grade) are never auto-priced — enter their price by hand; price updates keep it."
			)
			.setHeading();
		for (const cond of CONDITIONS) {
			if (cond === "NM") continue;
			new Setting(containerEl)
				.setName(`${cond} — ${CONDITION_LABELS[cond]}`)
				.addText((text) => {
					const cur =
						this.plugin.settings.conditionMultipliers?.[cond] ??
						DEFAULT_CONDITION_MULTIPLIERS[cond];
					text
						.setPlaceholder(String(DEFAULT_CONDITION_MULTIPLIERS[cond]))
						.setValue(String(cur))
						.onChange(async (value) => {
							const n = Number.parseFloat(value.replace(",", "."));
							this.plugin.settings.conditionMultipliers = {
								...this.plugin.settings.conditionMultipliers,
								[cond]:
									Number.isFinite(n) && n >= 0
										? n
										: DEFAULT_CONDITION_MULTIPLIERS[cond],
							};
							await this.plugin.saveSettings();
						});
				});
		}

		new Setting(containerEl).setName("Images").setHeading();

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
			.setName("Image column in table")
			.setDesc(
				"Embed a card thumbnail as the first column. Applied the next time the plugin rewrites a table (add card / update prices / sort)."
			)
			.addToggle((toggle) => {
				toggle
					.setValue(this.plugin.settings.imageColumn)
					.onChange(async (value) => {
						this.plugin.settings.imageColumn = value;
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

		new Setting(containerEl).setName("Maintenance").setHeading();

		new Setting(containerEl)
			.setName("Clear API cache")
			.setDesc("Remove cached TCGdex responses (price history is kept).")
			.addButton((btn) => {
				btn.setButtonText("Clear cache").onClick(async () => {
					await this.plugin.cache.clearApiCache();
				});
			});
	}
}
