import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardBrief } from "../types";
import type { CardSearchQuery } from "../services/ApiService";
import { SUPPORTED_LANGUAGES } from "../settings";
import { VariantSelectorModal } from "./VariantSelectorModal";
import { ManualAddModal } from "./ManualAddModal";

export type AddCardCallback = (entry: CollectionEntry, addQty: number) => void;

/** Compare collector numbers leniently ("062" == "62", case-insensitive). */
function sameNumber(localId: string | undefined, num: string): boolean {
	if (!localId) return false;
	const a = String(localId).toUpperCase();
	const b = num.toUpperCase();
	if (a === b) return true;
	return a.replace(/^0+/, "") === b.replace(/^0+/, "");
}

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
				this.onEnter(t.inputEl);
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl)
			.setName("Card number")
			.setDesc("Tip: type a set code + number here, e.g. \"DRI 062\".")
			.addText((t) => {
				t.setPlaceholder("58  ·  DRI 062  ·  sv10-021")
					.setValue(this.numberValue)
					.onChange((v) => {
						this.numberValue = v;
						this.scheduleSearch();
					});
				this.onEnter(t.inputEl);
			});

		new Setting(contentEl).setName("Set").addText((t) => {
			t.setPlaceholder("Base Set (name or id)")
				.setValue(this.setValue)
				.onChange((v) => {
					this.setValue = v;
					this.scheduleSearch();
				});
			this.onEnter(t.inputEl);
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
					.onClick(() => this.runSearch(true))
			)
			.addButton((b) =>
				b
					.setButtonText("Add manually")
					.onClick(() => this.addManually())
			);

		this.resultsEl = contentEl.createDiv({ cls: "pokemon-collection-results" });
		this.resultsEl.createEl("p", {
			text: "Search by name, or jump straight to a card with its set code + number (e.g. DRI 062).",
			cls: "pokemon-collection-hint",
		});

		// Auto-search when pre-filled (e.g. from a Cardmarket link).
		if (this.nameValue || this.setValue || this.numberValue) {
			void this.runSearch(true);
		}
	}

	/** Submit a deep search when Enter is pressed in an input. */
	private onEnter(input: HTMLInputElement): void {
		input.addEventListener("keydown", (e) => {
			if (e.key === "Enter") {
				e.preventDefault();
				void this.runSearch(true);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
	}

	private scheduleSearch(): void {
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
		this.searchTimer = window.setTimeout(() => this.runSearch(false), 350);
	}

	/**
	 * Run a search. `deep` (Search button / Enter) allows network-heavy work
	 * such as lazily building the set index to resolve an unknown set code.
	 */
	private async runSearch(deep: boolean): Promise<void> {
		// Direct "set code + number" lookup (e.g. "DRI 062", "sv10-021").
		const direct = this.parseDirect();
		if (direct) {
			await this.directLookup(direct.code, direct.num, deep);
			return;
		}

		const name = this.nameValue.trim();
		const number = this.numberValue.trim();
		const set = this.setValue.trim();
		if (!name && !set) {
			return; // need at least a name or a set
		}

		this.setHint("Searching…");
		try {
			const results = await this.plugin.api.searchCards(
				{ name, number, set },
				this.lang
			);
			this.renderResults(results);
		} catch (err) {
			console.error("[pokemon-collection] search failed", err);
			this.setHint("Search failed. Check your connection.", true);
		}
	}

	private setHint(text: string, error = false): void {
		this.resultsEl.empty();
		this.resultsEl.createEl("p", {
			text,
			cls: error
				? "pokemon-collection-error"
				: "pokemon-collection-hint",
		});
	}

	/** Detect a "CODE NUMBER" / "setId-localId" direct lookup from the inputs. */
	private parseDirect(): { code: string; num: string } | null {
		const single = /^([A-Za-z][A-Za-z0-9.]{1,6})[\s-]+([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)$/;
		for (const raw of [this.numberValue, this.nameValue]) {
			const m = raw.trim().match(single);
			if (m) return { code: m[1], num: m[2] };
		}
		// Code-like Set field + a number field.
		const set = this.setValue.trim();
		const num = this.numberValue.trim();
		if (
			num &&
			/^[A-Za-z0-9.]{2,10}$/.test(set) &&
			/^[A-Za-z]{0,3}\d{1,4}[A-Za-z]?$/.test(num)
		) {
			return { code: set, num };
		}
		return null;
	}

	/** Resolve a set code + number to one card and open the variant selector. */
	private async directLookup(
		code: string,
		num: string,
		deep: boolean
	): Promise<void> {
		this.setHint(`Looking up ${code.toUpperCase()} ${num}…`);

		let setId = this.plugin.setIndex.findSetIdByCode(code, this.lang);

		// A lowercase/numeric token may be a raw set id — verify by fetching it.
		if (!setId && /[a-z0-9]/.test(code) && code === code.toLowerCase()) {
			const maybe = await this.plugin.api.getSet(code.toLowerCase(), this.lang);
			if (maybe?.cards?.length) setId = maybe.id;
		}
		// Only the explicit Search/Enter path may build the index (network-heavy).
		if (!setId && deep) {
			setId = await this.plugin.setIndex.resolveCode(code, this.lang);
		}

		if (!setId) {
			this.setHint(
				deep
					? `Set code "${code.toUpperCase()}" not recognized. Try "Rebuild Pokémon set index", or search by set name.`
					: `Press Search to look up set code "${code.toUpperCase()}".`
			);
			return;
		}

		const set = await this.plugin.api.getSet(setId, this.lang);
		const match = set?.cards?.find((c) => sameNumber(c.localId, num));
		if (!match) {
			this.setHint(`No card #${num} in ${set?.name ?? setId}.`);
			return;
		}
		await this.pickCard(match);
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
