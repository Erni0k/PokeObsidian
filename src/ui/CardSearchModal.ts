import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardBrief } from "../types";
import { VariantSelectorModal } from "./VariantSelectorModal";

export type AddCardCallback = (entry: CollectionEntry, addQty: number) => void;

/**
 * "Add Card" step 1: search TCGdex by name / number / set and pick a card.
 * Selecting a result opens the {@link VariantSelectorModal}.
 */
export class CardSearchModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onConfirm: AddCardCallback;

	private nameValue = "";
	private numberValue = "";
	private setValue = "";
	private resultsEl!: HTMLElement;
	private searchTimer: number | null = null;

	constructor(plugin: PokemonCollectionPlugin, onConfirm: AddCardCallback) {
		super(plugin.app);
		this.plugin = plugin;
		this.onConfirm = onConfirm;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Add Pokémon card" });

		new Setting(contentEl)
			.setName("Card name")
			.addText((t) => {
				t.setPlaceholder("Pikachu").onChange((v) => {
					this.nameValue = v;
					this.scheduleSearch();
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl).setName("Card number").addText((t) => {
			t.setPlaceholder("58").onChange((v) => {
				this.numberValue = v;
				this.scheduleSearch();
			});
		});

		new Setting(contentEl).setName("Set").addText((t) => {
			t.setPlaceholder("Base Set (name or id)").onChange((v) => {
				this.setValue = v;
				this.scheduleSearch();
			});
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Search")
				.setCta()
				.onClick(() => this.runSearch())
		);

		this.resultsEl = contentEl.createDiv({ cls: "pokemon-collection-results" });
		this.resultsEl.createEl("p", {
			text: "Enter a card name (and optionally a number/set), then search.",
			cls: "pokemon-collection-hint",
		});
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
			const results = await this.plugin.api.searchCards({
				name,
				number,
				set,
			});
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
			label.createEl("span", {
				text: `#${card.localId ?? "?"} · ${card.id}`,
				cls: "pokemon-collection-result-meta",
			});

			row.onClickEvent(() => this.pickCard(card));
		}
	}

	private async pickCard(brief: TcgdexCardBrief): Promise<void> {
		const notice = new Notice("Loading card details…", 0);
		try {
			const full = await this.plugin.api.getCard(brief.id);
			notice.hide();
			if (!full) {
				new Notice("Could not load card details.");
				return;
			}
			new VariantSelectorModal(this.plugin, full, (entry, addQty) => {
				this.close();
				this.onConfirm(entry, addQty);
			}).open();
		} catch (err) {
			notice.hide();
			console.error("[pokemon-collection] failed to load card", err);
			new Notice("Could not load card details.");
		}
	}
}
