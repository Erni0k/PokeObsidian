import { AbstractInputSuggest } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { SetIndexEntry } from "../services/SetIndexService";

const MAX_SUGGESTIONS = 20;
/** How many shown sets with an unknown code to fetch in the background. */
const CODE_PREFETCH = 6;

/**
 * Autocomplete for the "Set" field, backed by the set index for the current
 * search language (set names and some codes are localized). Matches by name
 * and by code, shown as "Name (CODE)". Picking a set hands its exact id back
 * so the search is scoped precisely; free text still works without a pick.
 */
export class SetSuggest extends AbstractInputSuggest<SetIndexEntry> {
	private plugin: PokemonCollectionPlugin;
	private getLang: () => string;
	private onPick: (entry: SetIndexEntry) => void;
	/** Set ids whose full details (codes) were already requested. */
	private prefetched = new Set<string>();
	/** Languages whose set list was loaded during this suggest's lifetime. */
	private loaded = new Set<string>();

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

	/**
	 * Load the set list for a language once (e.g. right after it was
	 * switched); cached with the set-list TTL, stale cache when offline.
	 */
	async preload(lang: string): Promise<void> {
		if (this.loaded.has(lang)) return;
		this.loaded.add(lang);
		await this.plugin.api.getSets(lang);
	}

	async getSuggestions(query: string): Promise<SetIndexEntry[]> {
		const lang = this.getLang();
		try {
			await this.preload(lang);
		} catch (err) {
			console.error("[pokemon-collection] set list unavailable", err);
		}
		// Index order follows /sets (oldest → newest); prefer newer sets.
		const sets = this.plugin.setIndex.allSets(lang).slice().reverse();
		const q = query.trim().toLowerCase();

		let shown: SetIndexEntry[];
		if (!q) {
			shown = sets.slice(0, MAX_SUGGESTIONS);
		} else {
			const scored: { s: SetIndexEntry; score: number; i: number }[] = [];
			sets.forEach((s, i) => {
				const score = this.score(s, q, lang);
				if (score > 0) scored.push({ s, score, i });
			});
			scored.sort((a, b) => b.score - a.score || a.i - b.i);
			shown = scored.slice(0, MAX_SUGGESTIONS).map((x) => x.s);
		}
		this.prefetchCodes(shown, lang);
		return shown;
	}

	/** Higher is better; 0 = no match. Codes outrank names, prefixes outrank infixes. */
	private score(s: SetIndexEntry, q: string, lang: string): number {
		const name = (s.name ?? "").toLowerCase();
		const codes = [s.abbreviation, s.abbreviationLocalized, s.id]
			.filter((c): c is string => !!c)
			.map((c) => c.toLowerCase());
		if (codes.includes(q)) return 100;
		if (name === q) return 90;
		if (name.startsWith(q)) return 70;
		if (codes.some((c) => c.startsWith(q))) return 60;
		if (name.split(/[\s:—–-]+/).some((w) => w.startsWith(q))) return 50;
		if (name.includes(q)) return 30;
		// Also match the English name, so "destined" finds a localized set.
		if (lang !== "en") {
			const en = this.plugin.setIndex.getNameEn(s.id)?.toLowerCase();
			if (en?.includes(q)) return 20;
		}
		return 0;
	}

	/** The code to show for a set: localized one in that language, else official. */
	private code(s: SetIndexEntry, lang: string): string | undefined {
		return (lang !== "en" && s.abbreviationLocalized) || s.abbreviation;
	}

	/** Fetch full details of shown sets with no known code (for next keystroke). */
	private prefetchCodes(shown: SetIndexEntry[], lang: string): void {
		let n = 0;
		for (const s of shown) {
			if (n >= CODE_PREFETCH) break;
			if (s.full || s.abbreviation || this.prefetched.has(`${lang}/${s.id}`)) {
				continue;
			}
			this.prefetched.add(`${lang}/${s.id}`);
			n++;
			void this.plugin.api.getSet(s.id, lang).catch(() => undefined);
		}
	}

	renderSuggestion(item: SetIndexEntry, el: HTMLElement): void {
		const lang = this.getLang();
		const code = this.code(item, lang);
		el.createDiv({
			text: code ? `${item.name} (${code})` : item.name,
		});
		const meta: string[] = [item.id];
		if (item.total) meta.push(`${item.total} cards`);
		el.createEl("small", {
			text: meta.join(" · "),
			cls: "pokemon-collection-result-meta",
		});
	}

	selectSuggestion(item: SetIndexEntry): void {
		this.setValue(item.name);
		this.close();
		this.onPick(item);
	}
}
