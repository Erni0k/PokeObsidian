import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardBrief } from "../types";
import type { CardSearchQuery } from "../services/ApiService";
import { SUPPORTED_LANGUAGES } from "../settings";
import { VariantSelectorModal } from "./VariantSelectorModal";
import { ManualAddModal } from "./ManualAddModal";

export type AddCardCallback = (entry: CollectionEntry, addQty: number) => void;

/**
 * "Add Card" step 1: search TCGdex by name / number / set and pick a card.
 * Selecting a result opens the {@link VariantSelectorModal}. An optional
 * initial query pre-fills the fields (e.g. parsed from a Cardmarket link).
 */
export class CardSearchModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onConfirm: AddCardCallback;

	private nameValue = "";
	private numberValue = "";
	private setValue = "";
	private lang: string;
	private resultsEl!: HTMLElement;
	private searchTimer: number | null = null;
	/** Dedupes set-abbreviation lookups across result rows. */
	private abbrCache = new Map<string, Promise<string | undefined>>();

	constructor(
		plugin: PokemonCollectionPlugin,
		onConfirm: AddCardCallback,
		initial?: CardSearchQuery
	) {
		super(plugin.app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
		this.nameValue = initial?.name ?? "";
		this.numberValue = initial?.number ?? "";
		this.setValue = initial?.set ?? "";
		this.lang = plugin.settings.preferredLanguage || "en";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Add Pokémon card" });

		new Setting(contentEl)
			.setName("Card name")
			.addText((t) => {
				t.setPlaceholder("Pikachu")
					.setValue(this.nameValue)
					.onChange((v) => {
						this.nameValue = v;
						this.scheduleSearch();
					});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl).setName("Card number").addText((t) => {
			t.setPlaceholder("58")
				.setValue(this.numberValue)
				.onChange((v) => {
					this.numberValue = v;
					this.scheduleSearch();
				});
		});

		new Setting(contentEl).setName("Set").addText((t) => {
			t.setPlaceholder("Base Set (name or id)")
				.setValue(this.setValue)
				.onChange((v) => {
					this.setValue = v;
					this.scheduleSearch();
				});
		});

		new Setting(contentEl)
			.setName("Language")
			.setDesc("Which TCGdex language to search (e.g. ja for Japanese).")
			.addDropdown((dd) => {
				for (const l of SUPPORTED_LANGUAGES) dd.addOption(l, l.toUpperCase());
				dd.setValue(this.lang).onChange((v) => {
					this.lang = v;
					this.abbrCache.clear();
					this.scheduleSearch();
				});
			});

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Search")
					.setCta()
					.onClick(() => this.runSearch())
			)
			.addButton((b) =>
				b
					.setButtonText("Add manually")
					.onClick(() => this.addManually())
			);

		this.resultsEl = contentEl.createDiv({ cls: "pokemon-collection-results" });
		this.resultsEl.createEl("p", {
			text: "Enter a card name (and optionally a number/set), then search.",
			cls: "pokemon-collection-hint",
		});

		// Auto-search when pre-filled (e.g. from a Cardmarket link).
		if (this.nameValue || this.setValue) {
			void this.runSearch();
		}
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
	}

	private scheduleSearch(): void {
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => this.runSearch(), 350);
	}

	private async runSearch(): Promise<void> {
		const name = this.nameValue.trim();
		const number = this.numberValue.trim();
		const set = this.setValue.trim();
		if (!name && !set) {
			return; // need at least a name or a set
		}

		this.resultsEl.empty();
		this.resultsEl.createEl("p", {
			text: "Searching…",
			cls: "pokemon-collection-hint",
		});

		try {
			const results = await this.plugin.api.searchCards(
				{ name, number, set },
				this.lang
			);
			this.renderResults(results);
		} catch (err) {
			console.error("[pokemon-collection] search failed", err);
			this.resultsEl.empty();
			this.resultsEl.createEl("p", {
				text: "Search failed. Check your connection.",
				cls: "pokemon-collection-error",
			});
		}
	}

	/** Get the set's short code, caching the in-flight promise per set. */
	private abbr(setId: string): Promise<string | undefined> {
		let p = this.abbrCache.get(setId);
		if (!p) {
			p = this.plugin.api.setAbbreviation(setId, this.lang);
			this.abbrCache.set(setId, p);
		}
		return p;
	}

	private renderResults(results: TcgdexCardBrief[]): void {
		this.resultsEl.empty();
		if (!results.length) {
			this.resultsEl.createEl("p", {
				text: "No matching cards found.",
				cls: "pokemon-collection-hint",
			});
			return;
		}

		const list = this.resultsEl.createDiv({
			cls: "pokemon-collection-result-list",
		});
		for (const card of results) {
			const row = list.createDiv({ cls: "pokemon-collection-result" });

			if (this.plugin.settings.enableImagePreviews && card.image) {
				const img = row.createEl("img", {
					cls: "pokemon-collection-thumb",
				});
				img.src = this.plugin.api.imageUrl(card.image, "low") ?? "";
				img.width = 40;
			}

			const label = row.createDiv({ cls: "pokemon-collection-result-label" });
			label.createEl("span", {
				text: card.name,
				cls: "pokemon-collection-result-name",
			});
			const metaEl = label.createEl("span", {
				text: `#${card.localId ?? "?"} · `,
				cls: "pokemon-collection-result-meta",
			});
			// Show the set's short code (e.g. DRI); fetched lazily, with the
			// set id as a placeholder until the abbreviation resolves.
			const setId = this.plugin.api.setIdFromCardId(card.id);
			const codeEl = metaEl.createSpan({ text: setId.toUpperCase() });
			void this.abbr(setId).then((code) => {
				if (code) codeEl.setText(code);
			});

			row.onClickEvent(() => this.pickCard(card));
		}
	}

	private addManually(): void {
		new ManualAddModal(
			this.plugin,
			(entry, addQty) => {
				this.close();
				this.onConfirm(entry, addQty);
			},
			{
				name: this.nameValue,
				number: this.numberValue,
				setName: this.setValue,
				language: this.lang.toUpperCase(),
			}
		).open();
	}

	private async pickCard(brief: TcgdexCardBrief): Promise<void> {
		const notice = new Notice("Loading card details…", 0);
		try {
			const full = await this.plugin.api.getCard(brief.id, this.lang);
			notice.hide();
			if (!full) {
				new Notice("Could not load card details.");
				return;
			}
			new VariantSelectorModal(
				this.plugin,
				full,
				(entry, addQty) => {
					this.close();
					this.onConfirm(entry, addQty);
				},
				this.lang
			).open();
		} catch (err) {
			notice.hide();
			console.error("[pokemon-collection] failed to load card", err);
			new Notice("Could not load card details.");
		}
	}
}
