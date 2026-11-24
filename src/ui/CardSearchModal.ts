import { Modal, Notice, Setting, TextComponent } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardBrief } from "../types";
import type {
	CardSearchQuery,
	CodeLookupResult,
} from "../services/ApiService";
import { SUPPORTED_LANGUAGES } from "../settings";
import { VariantSelectorModal } from "./VariantSelectorModal";
import { ManualAddModal } from "./ManualAddModal";
import { SetSuggest } from "./SetSuggest";

export type AddCardCallback = (entry: CollectionEntry, addQty: number) => void;

/** A parsed "set code + number" query. */
interface DirectQuery {
	/** Short code ("DRI") or raw set id ("sv10") as typed. */
	code: string;
	num: string;
	/** Which input it came from (decides the fallback when the code is unknown). */
	source: "number" | "name" | "set";
	/** Exact set id when already known (picked from set autocomplete). */
	setId?: string;
}

/**
 * "Add Card" step 1: search TCGdex by name / number / set and pick a card.
 * Selecting a result opens the {@link VariantSelectorModal}. After a card is
 * added the modal stays open (continuous mode): name/number are cleared, the
 * set + language are kept, and a running "Added N" counter is shown. An
 * optional initial query pre-fills the fields (e.g. from a Cardmarket link).
 */
export class CardSearchModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onConfirm: AddCardCallback;

	private nameValue = "";
	private numberValue = "";
	private setValue = "";
	/** Exact set id chosen from autocomplete (overrides the free-text set). */
	private pickedSetId: string | undefined;
	private setInput?: TextComponent;
	private nameInput?: TextComponent;
	private numberInput?: TextComponent;
	/** The name/number input used last, refocused after each add. */
	private lastQueryInput?: HTMLInputElement;
	private setSuggest?: SetSuggest;
	/** Continuous mode: cards added in this session of the modal. */
	private addedCount = 0;
	private addedNames: string[] = [];
	private counterEl!: HTMLElement;
	private lang: string;
	private resultsEl!: HTMLElement;
	private searchTimer: number | null = null;
	/** Incremented per search so a slow, stale response can't overwrite a newer one. */
	private searchSeq = 0;
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
		this.counterEl = contentEl.createDiv({ cls: "pokemon-collection-added" });
		this.counterEl.hide();

		new Setting(contentEl)
			.setName("Card name")
			.addText((t) => {
				this.nameInput = t;
				this.trackFocus(t.inputEl);
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
				this.numberInput = t;
				this.trackFocus(t.inputEl);
				t.setPlaceholder("58  ·  DRI 062  ·  sv10-021")
					.setValue(this.numberValue)
					.onChange((v) => {
						this.numberValue = v;
						this.scheduleSearch();
					});
				this.onEnter(t.inputEl);
			});

		new Setting(contentEl).setName("Set").addText((t) => {
			this.setInput = t;
			t.setPlaceholder("Name or code, e.g. Destined Rivals / DRI")
				.setValue(this.setValue)
				.onChange((v) => {
					this.setValue = v;
					this.pickedSetId = undefined; // manual typing clears the pick
					this.scheduleSearch();
				});
			this.onEnter(t.inputEl);
			this.setSuggest = new SetSuggest(
				this.plugin,
				t.inputEl,
				() => this.lang,
				(entry) => {
					this.pickedSetId = entry.id;
					this.setValue = entry.name;
					void this.runSearch(true);
				}
			);
		});

		new Setting(contentEl)
			.setName("Language")
			.setDesc("Which TCGdex language to search (e.g. ja for Japanese).")
			.addDropdown((dd) => {
				for (const l of SUPPORTED_LANGUAGES) dd.addOption(l, l.toUpperCase());
				dd.setValue(this.lang).onChange((v) => {
					this.lang = v;
					this.abbrCache.clear();
					void this.onLanguageChanged(v);
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
			)
			.addButton((b) => b.setButtonText("Done").onClick(() => this.close()));

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

	/**
	 * Set names are localized: load the new language's set list for the
	 * autocomplete and re-label (or drop) a picked set, then search again.
	 */
	private async onLanguageChanged(lang: string): Promise<void> {
		try {
			await this.setSuggest?.preload(lang);
		} catch (err) {
			console.error("[pokemon-collection] set list unavailable", err);
		}
		if (lang !== this.lang) return; // switched again meanwhile
		if (this.pickedSetId) {
			const entry = this.plugin.api
				.getSetIndex(lang)
				.find((e) => e.id === this.pickedSetId);
			if (entry) {
				this.setValue = entry.name;
				// Direct assignment fires no onChange, so the pick survives.
				if (this.setInput) this.setInput.inputEl.value = entry.name;
			} else {
				this.pickedSetId = undefined; // set not available in this language
			}
		}
		this.scheduleSearch();
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
	 * such as lazily building the set index to resolve an unknown set code,
	 * and opens the variant selector straight away for a single direct hit.
	 */
	private async runSearch(deep: boolean): Promise<void> {
		if (deep && this.searchTimer) {
			window.clearTimeout(this.searchTimer);
			this.searchTimer = null;
		}
		const seq = ++this.searchSeq;

		// Direct "set code + number" lookup (e.g. "DRI 062", "DRI062", "sv10-021").
		const direct = this.parseDirect();
		if (direct) {
			await this.directLookup(direct, deep, seq);
			return;
		}

		const name = this.nameValue.trim();
		const number = this.numberValue.trim();
		const set = this.pickedSetId ?? this.setValue.trim();
		if (!name && !set) {
			return; // need at least a name or a set
		}

		this.setHint("Searching…");
		const results = await this.plainSearch({ name, number, set });
		if (seq !== this.searchSeq) return;
		if (results) this.renderResults(results);
		else this.setHint("Search failed. Check your connection.", true);
	}

	/** Regular name / number / set search; null on failure. */
	private async plainSearch(
		query: CardSearchQuery
	): Promise<TcgdexCardBrief[] | null> {
		try {
			return await this.plugin.api.searchCards(query, this.lang);
		} catch (err) {
			console.error("[pokemon-collection] search failed", err);
			return null;
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

	/**
	 * Detect a direct lookup from the inputs:
	 * - "DRI 062", "dri-062", "sv10-021", "sv10 21" (code/id, separator, number)
	 * - "DRI062" (letters-only code glued to the number)
	 * typed into Card number or Card name; or a set picked from autocomplete /
	 * a code-like Set field together with a number.
	 */
	private parseDirect(): DirectQuery | null {
		const separated = /^([A-Za-z][A-Za-z0-9.]{1,7})[\s-]+([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)$/;
		const glued = /^([A-Za-z]{2,4})(\d{1,4})$/;
		const fields: [string, DirectQuery["source"]][] = [
			[this.numberValue, "number"],
			[this.nameValue, "name"],
		];
		for (const [raw, source] of fields) {
			const v = raw.trim();
			const m = v.match(separated) ?? v.match(glued);
			if (m) return { code: m[1], num: m[2], source };
		}

		const num = this.numberValue.trim();
		if (!num || !/^[A-Za-z]{0,3}\d{1,4}[A-Za-z]?$/.test(num)) return null;
		if (this.pickedSetId) {
			return { code: this.pickedSetId, num, source: "set", setId: this.pickedSetId };
		}
		const set = this.setValue.trim();
		if (/^[A-Za-z0-9.]{2,10}$/.test(set)) return { code: set, num, source: "set" };
		return null;
	}

	/** Resolve a set code + number to card(s); one hit opens the variant selector. */
	private async directLookup(
		q: DirectQuery,
		deep: boolean,
		seq: number
	): Promise<void> {
		const label = `${q.code.toUpperCase()} ${q.num}`;
		this.setHint(`Looking up ${label}…`);

		// Long letter-only words ("Pikachu 58", Set "Jungle") are names, not
		// codes: skip the (possibly network-heavy) code resolution for them.
		const codeLike = /\d/.test(q.code) || /^[A-Za-z]{2,4}$/.test(q.code);

		let res: CodeLookupResult = { cards: [] };
		try {
			if (q.setId) {
				res = await this.plugin.api.findCardsInSet(q.setId, q.num, this.lang);
			} else if (codeLike || q.source === "number") {
				res = await this.plugin.api.findCardByCodeNumber(
					q.code,
					q.num,
					this.lang,
					deep
				);
			}
		} catch (err) {
			console.error("[pokemon-collection] code lookup failed", err);
			if (seq === this.searchSeq) {
				this.setHint("Lookup failed. Check your connection.", true);
			}
			return;
		}
		if (seq !== this.searchSeq) return;

		if (res.setId) {
			const where = res.setName ?? res.setId;
			if (!res.cards.length) {
				this.setHint(`No card #${q.num} in ${where}.`);
			} else if (res.cards.length === 1 && deep) {
				this.setHint(`Found ${res.cards[0].name} (${label}).`);
				await this.pickCard(res.cards[0]);
			} else {
				this.renderResults(res.cards);
			}
			return;
		}

		// Not a set code. The text may still be a card or set name ("Pikachu 58",
		// Set "Jungle" + number), so fall back to the regular search first.
		if (q.source !== "number") {
			const query: CardSearchQuery =
				q.source === "name"
					? { name: q.code, number: q.num, set: this.setValue.trim() }
					: { name: this.nameValue.trim(), number: q.num, set: q.code };
			const results = await this.plainSearch(query);
			if (seq !== this.searchSeq) return;
			if (results?.length || !codeLike) {
				if (results) this.renderResults(results);
				else this.setHint("Search failed. Check your connection.", true);
				return;
			}
		}

		this.setHint(
			deep
				? `Set code "${q.code.toUpperCase()}" doesn't match any set. Check the code, run "Rebuild Pokémon set index", or search by set name.`
				: `Press Enter to look up set code "${q.code.toUpperCase()}".`,
			deep
		);
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

	private trackFocus(input: HTMLInputElement): void {
		input.addEventListener("focus", () => (this.lastQueryInput = input));
	}

	/**
	 * A card was confirmed: hand it to the caller, then reset for the next one
	 * instead of closing (continuous mode).
	 */
	private onAdded(entry: CollectionEntry, addQty: number): void {
		this.onConfirm(entry, addQty);
		this.addedCount += addQty;
		this.addedNames.push(entry.name);
		this.renderCounter();

		// Cancel any pending/in-flight search and clear the query fields.
		if (this.searchTimer) window.clearTimeout(this.searchTimer);
		this.searchTimer = null;
		this.searchSeq++;
		this.nameValue = "";
		this.numberValue = "";
		this.nameInput?.setValue("");
		this.numberInput?.setValue("");

		const set = this.pickedSetId ? this.setValue : "";
		this.setHint(
			set
				? `Added ${entry.name}. Next card — type a number in ${set}, or a set code + number.`
				: `Added ${entry.name}. Search for the next card.`
		);
		// Refocus after the variant modal has finished closing.
		const target = this.lastQueryInput ?? this.nameInput?.inputEl;
		window.setTimeout(() => target?.focus(), 50);
	}

	private renderCounter(): void {
		this.counterEl.empty();
		this.counterEl.show();
		this.counterEl.createSpan({
			text: `Added ${this.addedCount} card${this.addedCount === 1 ? "" : "s"}`,
			cls: "pokemon-collection-added-count",
		});
		const recent = this.addedNames.slice(-3).reverse().join(", ");
		const more = this.addedNames.length > 3 ? ", …" : "";
		this.counterEl.createSpan({
			text: ` · last: ${recent}${more}`,
			cls: "pokemon-collection-result-meta",
		});
	}

	private addManually(): void {
		new ManualAddModal(
			this.plugin,
			(entry, addQty) => this.onAdded(entry, addQty),
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
				(entry, addQty) => this.onAdded(entry, addQty),
				this.lang
			).open();
		} catch (err) {
			notice.hide();
			console.error("[pokemon-collection] failed to load card", err);
			new Notice("Could not load card details.");
		}
	}
}
