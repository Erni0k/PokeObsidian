import { Notice } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { TcgdexSetBrief, TcgdexSetFull } from "../types";

const INDEX_FILE = "sets-index.json";
/** Upper bound on per-set fetches when lazily resolving an unknown code. */
const LAZY_FETCH_CAP = 120;

export interface SetIndexEntry {
	id: string;
	name: string;
	/** Cardmarket-style short code (abbreviation.official), uppercased. */
	abbreviation?: string;
	/** Localized printed code (e.g. FR "RVD" for DRI), uppercased, if any. */
	abbreviationLocalized?: string;
	/** True once recorded from a full set (both codes are known). */
	full?: boolean;
	/** True once seen in a /sets list (baseline for "new set" detection). */
	listed?: boolean;
	total?: number;
	official?: number;
}

/** Per-language maps keyed by set id, persisted to sets-index.json. */
type IndexData = Record<string, Record<string, SetIndexEntry>>;

/**
 * Builds and serves a local index of TCGdex sets so the plugin can map a set
 * short code (e.g. "DRI") to a set id, recognise newly released sets, and offer
 * set autocomplete. Names and codes are language-specific, so the index is kept
 * per language, always alongside an English layer (needed for Cardmarket links).
 */
export class SetIndexService {
	private plugin: PokemonCollectionPlugin;
	private index: IndexData = {};
	private dir: string;
	private saveTimer: number | null = null;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
		this.dir = plugin.manifest.dir ?? `${plugin.app.vault.configDir}/plugins/${plugin.manifest.id}`;
	}

	async load(): Promise<void> {
		const data = await this.readJson<IndexData>(INDEX_FILE);
		if (data) this.index = data;
	}

	// --- recording (incremental population) --------------------------------

	private lang(lang?: string): string {
		return lang || this.plugin.settings.preferredLanguage || "en";
	}

	private map(lang: string): Record<string, SetIndexEntry> {
		if (!this.index[lang]) this.index[lang] = {};
		return this.index[lang];
	}

	/**
	 * Record set briefs (names + counts, no abbreviation) from a /sets list.
	 * Returns the sets that were not indexed before (empty on the first list
	 * for a language, when there is nothing to compare against).
	 */
	noteBriefs(lang: string, briefs: TcgdexSetBrief[]): TcgdexSetBrief[] {
		const m = this.map(this.lang(lang));
		const added = this.hasList(lang) ? briefs.filter((b) => !m[b.id]) : [];
		for (const b of briefs) {
			const prev = m[b.id];
			m[b.id] = {
				id: b.id,
				name: b.name,
				abbreviation: prev?.abbreviation,
				abbreviationLocalized: prev?.abbreviationLocalized,
				full: prev?.full,
				listed: true,
				total: b.cardCount?.total ?? prev?.total,
				official: b.cardCount?.official ?? prev?.official,
			};
		}
		this.scheduleSave();
		return added;
	}

	/** Show a "New sets: …" notice for newly discovered sets. */
	announceNew(lang: string, added: TcgdexSetBrief[]): void {
		new Notice(this.newSetsMessage(lang, added), 10000);
	}

	private newSetsMessage(lang: string, added: TcgdexSetBrief[]): string {
		const names = added.map((b) => b.name).slice(0, 5).join(", ");
		const more = added.length > 5 ? ` and ${added.length - 5} more` : "";
		return `New Pokémon sets (${this.lang(lang).toUpperCase()}): ${names}${more}`;
	}

	/** Record a full set (adds the abbreviation). */
	noteFull(lang: string, set: TcgdexSetFull): void {
		const m = this.map(this.lang(lang));
		m[set.id] = {
			id: set.id,
			name: set.name,
			abbreviation: set.abbreviation?.official?.toUpperCase(),
			abbreviationLocalized: set.abbreviation?.localized?.toUpperCase(),
			full: true,
			listed: m[set.id]?.listed,
			total: set.cardCount?.total ?? m[set.id]?.total,
			official: set.cardCount?.official ?? m[set.id]?.official,
		};
		this.scheduleSave();
	}

	// --- lookups ------------------------------------------------------------

	/**
	 * Resolve a set short code to a set id from the index: the official code
	 * in the given language, then its localized code, then the English layer.
	 */
	findSetIdByCode(code: string, lang?: string): string | undefined {
		const c = code.trim().toUpperCase();
		if (!c) return undefined;
		for (const l of [...new Set([this.lang(lang), "en"])]) {
			const entries = Object.values(this.index[l] ?? {});
			const hit =
				entries.find((e) => e.abbreviation === c) ??
				entries.find((e) => e.abbreviationLocalized === c);
			if (hit) return hit.id;
		}
		return undefined;
	}

	/**
	 * Indexed languages other than `except` that know `code` as a short code
	 * or a set id (for "this set only exists in JA" hints).
	 */
	findCodeInOtherLanguages(
		code: string,
		except: string
	): { lang: string; entry: SetIndexEntry }[] {
		const c = code.trim().toUpperCase();
		if (!c) return [];
		const out: { lang: string; entry: SetIndexEntry }[] = [];
		for (const [lang, sets] of Object.entries(this.index)) {
			if (lang === except) continue;
			const entry = Object.values(sets).find(
				(e) =>
					e.abbreviation === c ||
					e.abbreviationLocalized === c ||
					e.id.toUpperCase() === c
			);
			if (entry) out.push({ lang, entry });
		}
		return out;
	}

	/** Whether a /sets list was recorded for a language (to diff against). */
	hasList(lang?: string): boolean {
		const m = this.index[this.lang(lang)];
		return !!m && Object.values(m).some((e) => e.listed);
	}

	/** Whether a set was recorded from its full details in a language. */
	hasFull(lang: string, setId: string): boolean {
		return !!this.index[lang]?.[setId]?.full;
	}

	/** English set name for a set id (for Cardmarket links). */
	getNameEn(setId: string): string | undefined {
		return this.index["en"]?.[setId]?.name;
	}

	/** All known sets for a language (for autocomplete). */
	allSets(lang?: string): SetIndexEntry[] {
		return Object.values(this.index[this.lang(lang)] ?? {});
	}

	/**
	 * Resolve a code to a set id, building the index on demand if needed:
	 * fetches the set list, then full sets newest-first until the code matches.
	 */
	async resolveCode(code: string, lang?: string): Promise<string | undefined> {
		const direct = this.findSetIdByCode(code, lang);
		if (direct) return direct;

		const l = this.lang(lang);
		const c = code.trim().toUpperCase();
		const briefs = await this.plugin.api.getSets(l);
		// Newest sets tend to be last in the list; search them first.
		const ids = briefs.map((b) => b.id).reverse();

		let fetched = 0;
		for (const id of ids) {
			if (this.map(l)[id]?.full) continue; // codes already known
			const set = await this.plugin.api.getSet(id, l);
			fetched++;
			const a = set?.abbreviation;
			if (
				a?.official?.toUpperCase() === c ||
				a?.localized?.toUpperCase() === c
			) {
				return id;
			}
			if (fetched >= LAZY_FETCH_CAP) break;
		}
		return this.findSetIdByCode(code, lang);
	}

	// --- bulk operations ----------------------------------------------------

	/**
	 * Build the index for the given languages (English always included, first,
	 * so the non-English pass doesn't trigger extra background EN fetches):
	 * refreshes /sets, then fetches /sets/{id} only for sets whose codes are
	 * not known yet. Progress is shown in a Notice.
	 */
	async rebuild(langs: string[]): Promise<void> {
		const unique = [...new Set(["en", ...langs.filter(Boolean)])];
		const notice = new Notice("Building Pokémon set index…", 0);
		let failed = 0;
		try {
			for (const l of unique) {
				const briefs =
					(await this.plugin.api.fetchSetsFresh(l)) ??
					(await this.plugin.api.getSets(l)); // offline: stale list
				const missing = briefs.filter((b) => !this.hasFull(l, b.id));
				let done = 0;
				for (const b of missing) {
					const set = await this.plugin.api.getSet(b.id, l); // records codes
					if (!set) failed++;
					done++;
					if (done % 10 === 0 || done === missing.length) {
						notice.setMessage(
							`Building set index (${l.toUpperCase()}): ${done}/${missing.length}…`
						);
					}
				}
			}
			await this.flush();
			notice.hide();
			new Notice(
				failed
					? `Pokémon set index built (${failed} set(s) could not be loaded — try again online).`
					: "Pokémon set index built."
			);
		} catch (err) {
			notice.hide();
			console.error("[pokemon-collection] set index build failed", err);
			new Notice("Could not build the set index.");
		}
	}

	/**
	 * Force-refresh the set list (for `lang` and English) and report sets that
	 * the index didn't know yet. New sets are fetched in full right away so
	 * their short codes resolve immediately.
	 */
	async refreshSets(lang?: string): Promise<void> {
		const langs = [...new Set([this.lang(lang), "en"])];
		const notice = new Notice("Refreshing Pokémon sets…", 0);
		const report: string[] = [];
		let offline = false;
		let firstRun = false;
		try {
			for (const l of langs) {
				const hadList = this.hasList(l);
				const known = new Set(Object.keys(this.index[l] ?? {}));
				const briefs = await this.plugin.api.fetchSetsFresh(l);
				if (!briefs) {
					offline = true;
					continue;
				}
				if (!hadList) {
					firstRun = true; // nothing to compare against yet
					continue;
				}
				const fresh = briefs.filter((b) => !known.has(b.id));
				for (const b of fresh) await this.plugin.api.getSet(b.id, l);
				// One line is enough: EN usually repeats the same releases.
				if (fresh.length && !report.length) {
					report.push(this.newSetsMessage(l, fresh));
				}
			}
			await this.flush();
		} finally {
			notice.hide();
		}

		if (offline) {
			new Notice("Could not refresh Pokémon sets — you seem to be offline.");
		} else if (report.length) {
			new Notice(report.join("\n"), 10000);
		} else if (firstRun) {
			new Notice(
				'Pokémon set list downloaded. Run "Rebuild Pokémon set index" to index all set codes.'
			);
		} else {
			new Notice("Pokémon sets are up to date.");
		}
	}

	// --- file IO ------------------------------------------------------------

	private scheduleSave(): void {
		if (this.saveTimer) window.clearTimeout(this.saveTimer);
		this.saveTimer = window.setTimeout(() => void this.flush(), 1500);
	}

	async flush(): Promise<void> {
		if (this.saveTimer) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		await this.writeJson(INDEX_FILE, this.index);
	}

	private path(file: string): string {
		return `${this.dir}/${file}`;
	}

	private async readJson<T>(file: string): Promise<T | null> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.path(file)))) return null;
			return JSON.parse(await adapter.read(this.path(file))) as T;
		} catch (err) {
			console.error(`[pokemon-collection] failed reading ${file}`, err);
			return null;
		}
	}

	private async writeJson(file: string, data: unknown): Promise<void> {
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.dir))) await adapter.mkdir(this.dir);
			await adapter.write(this.path(file), JSON.stringify(data, null, "\t"));
		} catch (err) {
			console.error(`[pokemon-collection] failed writing ${file}`, err);
		}
	}
}
