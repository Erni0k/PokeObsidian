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
		this.dir = plugin.manifest.dir ?? ".obsidian/plugins/pokemon-collection";
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

	/** Record set briefs (names + counts, no abbreviation) from a /sets list. */
	noteBriefs(lang: string, briefs: TcgdexSetBrief[]): void {
		const m = this.map(this.lang(lang));
		for (const b of briefs) {
			const prev = m[b.id];
			m[b.id] = {
				id: b.id,
				name: b.name,
				abbreviation: prev?.abbreviation,
				total: b.cardCount?.total ?? prev?.total,
				official: b.cardCount?.official ?? prev?.official,
			};
		}
		this.scheduleSave();
	}

	/** Record a full set (adds the abbreviation). */
	noteFull(lang: string, set: TcgdexSetFull): void {
		const m = this.map(this.lang(lang));
		m[set.id] = {
			id: set.id,
			name: set.name,
			abbreviation: set.abbreviation?.official?.toUpperCase(),
			total: set.cardCount?.total ?? m[set.id]?.total,
			official: set.cardCount?.official ?? m[set.id]?.official,
		};
		this.scheduleSave();
	}

	// --- lookups ------------------------------------------------------------

	/** Resolve a set short code to a set id from the index (lang then EN). */
	findSetIdByCode(code: string, lang?: string): string | undefined {
		const c = code.trim().toUpperCase();
		for (const l of [this.lang(lang), "en"]) {
			const m = this.index[l];
			if (!m) continue;
			for (const e of Object.values(m)) {
				if (e.abbreviation === c) return e.id;
			}
		}
		return undefined;
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
			if (this.map(l)[id]?.abbreviation) continue; // already known
			const set = await this.plugin.api.getSet(id, l);
			fetched++;
			if (set?.abbreviation?.official?.toUpperCase() === c) return id;
			if (fetched >= LAZY_FETCH_CAP) break;
		}
		return this.findSetIdByCode(code, lang);
	}

	// --- bulk operations ----------------------------------------------------

	/** Fully (re)build the index for the given languages. */
	async rebuild(langs: string[]): Promise<void> {
		const unique = [...new Set(langs.filter(Boolean))];
		const notice = new Notice("Building Pokémon set index…", 0);
		try {
			for (const l of unique) {
				const briefs = await this.plugin.api.getSets(l);
				let done = 0;
				for (const b of briefs) {
					await this.plugin.api.getSet(b.id, l); // records full set
					done++;
					if (done % 25 === 0) {
						notice.setMessage(
							`Building set index (${l}): ${done}/${briefs.length}…`
						);
					}
				}
			}
			await this.flush();
			notice.hide();
			new Notice("Pokémon set index built.");
		} catch (err) {
			notice.hide();
			console.error("[pokemon-collection] set index build failed", err);
			new Notice("Could not build the set index.");
		}
	}

	/**
	 * Force-refresh the set list and report newly added sets (compared to what
	 * the index already knows for that language).
	 */
	async refreshSets(lang?: string): Promise<void> {
		const l = this.lang(lang);
		const known = new Set(Object.keys(this.index[l] ?? {}));
		const briefs = await this.plugin.api.getSets(l, true);
		const fresh = briefs.filter((b) => !known.has(b.id));
		await this.flush();

		if (fresh.length === 0) {
			new Notice("Pokémon sets are up to date.");
			return;
		}
		const names = fresh.map((b) => b.name).slice(0, 5).join(", ");
		new Notice(
			`${fresh.length} new set(s): ${names}${
				fresh.length > 5 ? "…" : ""
			}`
		);
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
