import { AbstractInputSuggest } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { SetIndexEntry } from "../services/SetIndexService";

/**
 * Autocomplete for the "Set" field, backed by the per-language set index.
 * Picking a set passes its exact id back so the search scopes precisely.
 */
export class SetSuggest extends AbstractInputSuggest<SetIndexEntry> {
	private plugin: PokemonCollectionPlugin;
	private getLang: () => string;
	private onPick: (entry: SetIndexEntry) => void;

	constructor(
		plugin: PokemonCollectionPlugin,
		inputEl: HTMLInputElement,
		getLang: () => string,
		onPick: (entry: SetIndexEntry) => void
	) {
		super(plugin.app, inputEl);
		this.plugin = plugin;
		this.getLang = getLang;
		this.onPick = onPick;
	}

	async getSuggestions(query: string): Promise<SetIndexEntry[]> {
		const lang = this.getLang();
		let sets = this.plugin.setIndex.allSets(lang);
		if (!sets.length) {
			await this.plugin.api.getSets(lang); // populate names
			sets = this.plugin.setIndex.allSets(lang);
		}
		const q = query.trim().toLowerCase();
		const match = q
			? sets.filter(
					(s) =>
						s.name.toLowerCase().includes(q) ||
						s.abbreviation?.toLowerCase().includes(q) ||
						s.id.toLowerCase().includes(q)
				)
			: sets;
		return match.slice(0, 20);
	}

	renderSuggestion(item: SetIndexEntry, el: HTMLElement): void {
		el.createEl("div", { text: item.name });
		el.createEl("small", {
			text: item.abbreviation ?? item.id,
			cls: "pokemon-collection-result-meta",
		});
	}

	selectSuggestion(item: SetIndexEntry): void {
		this.setValue(item.name);
		this.close();
		this.onPick(item);
	}
}
