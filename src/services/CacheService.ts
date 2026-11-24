import { Notice } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type {
	ApiCache,
	CachedCardMeta,
	CacheRecord,
	CardKey,
	MetaCache,
	PriceHistory,
	PricePoint,
	ValueSnapshot,
} from "../types";

const CACHE_FILE = "cache.json";
const META_FILE = "meta.json";
const HISTORY_FILE = "price-history.json";

/**
 * Owns the plugin's on-disk JSON files (separate from Obsidian's data.json):
 *  - cache.json         TTL-bound raw TCGdex API responses
 *  - meta.json          long-lived per-card metadata (image, rarity, price…)
 *  - price-history.json portfolio value snapshots
 *
 * Everything is loaded into memory on startup and written back on change.
 */
export class CacheService {
	private plugin: PokemonCollectionPlugin;
	private apiCache: ApiCache = { entries: {} };
	private metaCache: MetaCache = { cards: {} };
	private history: PriceHistory = { snapshots: [] };
	private dir: string;
	/** Pending debounced write of cache.json. */
	private apiSaveTimer: number | null = null;
	/** Pending debounced write of price-history.json. */
	private historySaveTimer: number | null = null;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
		// manifest.dir is the plugin folder relative to the vault root.
		this.dir = plugin.manifest.dir ?? ".obsidian/plugins/pokemon-collection";
	}

	async load(): Promise<void> {
		this.apiCache = (await this.readJson<ApiCache>(CACHE_FILE)) ?? {
			entries: {},
		};
		this.metaCache = (await this.readJson<MetaCache>(META_FILE)) ?? {
			cards: {},
		};
		const history = await this.readJson<PriceHistory>(HISTORY_FILE);
		this.history = {
			snapshots: history?.snapshots ?? [],
			cards: history?.cards ?? {},
		};
	}

	// --- API response cache (TTL) ------------------------------------------

	/**
	 * Returns cached data for `key` if still fresh, else undefined. `ttlHours`
	 * overrides the global cache duration (e.g. a shorter TTL for /sets).
	 */
	getFresh<T>(key: string, ttlHours?: number): T | undefined {
		const rec = this.apiCache.entries[key];
		if (!rec) return undefined;
		const ageMs = Date.now() - new Date(rec.fetchedAt).getTime();
		const hours = ttlHours ?? this.plugin.settings.cacheDurationHours;
		const ttlMs = hours * 3600 * 1000;
		if (ageMs > ttlMs) return undefined;
		return rec.data as T;
	}

	/** Returns cached data regardless of age (used as offline fallback). */
	getStale<T>(key: string): T | undefined {
		return this.apiCache.entries[key]?.data as T | undefined;
	}

	/**
	 * Store a response. The file write is debounced: loading a whole set means
	 * hundreds of puts, and rewriting cache.json for each would be wasteful.
	 */
	async put(key: string, data: unknown): Promise<void> {
		const rec: CacheRecord = { fetchedAt: new Date().toISOString(), data };
		this.apiCache.entries[key] = rec;
		if (this.apiSaveTimer !== null) window.clearTimeout(this.apiSaveTimer);
		this.apiSaveTimer = window.setTimeout(() => void this.flush(), 2000);
	}

	/** Write any pending cache.json change now (e.g. on unload). */
	async flush(): Promise<void> {
		if (this.historySaveTimer !== null) await this.flushHistory();
		if (this.apiSaveTimer === null) return;
		window.clearTimeout(this.apiSaveTimer);
		this.apiSaveTimer = null;
		await this.writeJson(CACHE_FILE, this.apiCache);
	}

	async clearApiCache(): Promise<void> {
		if (this.apiSaveTimer !== null) window.clearTimeout(this.apiSaveTimer);
		this.apiSaveTimer = null;
		this.apiCache = { entries: {} };
		await this.writeJson(CACHE_FILE, this.apiCache);
		new Notice("Pokémon Collection: API cache cleared.");
	}

	// --- Per-card metadata cache -------------------------------------------

	getMeta(key: CardKey): CachedCardMeta | undefined {
		return this.metaCache.cards[key];
	}

	getAllMeta(): Record<CardKey, CachedCardMeta> {
		return this.metaCache.cards;
	}

	async putMeta(key: CardKey, meta: CachedCardMeta): Promise<void> {
		const existing = this.metaCache.cards[key];
		this.metaCache.cards[key] = { ...existing, ...meta };
		await this.writeJson(META_FILE, this.metaCache);
	}

	// --- Price history (portfolio snapshots) -------------------------------

	getSnapshots(): ValueSnapshot[] {
		return this.history.snapshots;
	}

	async addSnapshot(snapshot: ValueSnapshot): Promise<void> {
		this.history.snapshots.push(snapshot);
		await this.flushHistory();
	}

	// --- Per-card price history ---------------------------------------------

	/**
	 * Recorded price points of a card, oldest first (empty if none). With
	 * `currency`, only the points in that currency (points recorded before
	 * price sources existed are EUR) — never mix EUR and USD in one series.
	 */
	getCardHistory(key: CardKey, currency?: string): PricePoint[] {
		const all = this.history.cards?.[key] ?? [];
		return currency ? all.filter((p) => (p.c ?? "EUR") === currency) : all;
	}

	/** Every card key that has recorded history. */
	getCardHistoryKeys(): CardKey[] {
		return Object.keys(this.history.cards ?? {});
	}

	/**
	 * Append a price point unless it equals the last one (to the cent), then
	 * keep only the newest `max` points. Returns whether a point was added.
	 * The write is debounced: "Update all prices" records hundreds of points.
	 */
	addCardPoint(key: CardKey, price: number, max: number, currency = "EUR"): boolean {
		if (!Number.isFinite(price)) return false;
		const cards = (this.history.cards ??= {});
		const list = (cards[key] ??= []);
		// Compare with the last point in the same currency (sources can switch).
		const same = list.filter((p) => (p.c ?? "EUR") === currency);
		const last = same[same.length - 1];
		if (last && Math.abs(last.p - price) < 0.005) return false;
		list.push({ t: new Date().toISOString(), p: price, c: currency });
		// Keep the newest `max` points per currency.
		const keep = Math.max(2, Math.floor(max) || 2);
		if (same.length + 1 > keep) {
			let drop = same.length + 1 - keep;
			for (let i = 0; i < list.length && drop > 0; ) {
				if ((list[i].c ?? "EUR") === currency) {
					list.splice(i, 1);
					drop--;
				} else i++;
			}
		}
		if (this.historySaveTimer !== null) window.clearTimeout(this.historySaveTimer);
		this.historySaveTimer = window.setTimeout(() => void this.flushHistory(), 2000);
		return true;
	}

	private async flushHistory(): Promise<void> {
		if (this.historySaveTimer !== null) window.clearTimeout(this.historySaveTimer);
		this.historySaveTimer = null;
		await this.writeJson(HISTORY_FILE, this.history);
	}

	// --- Low-level file IO --------------------------------------------------

	private path(file: string): string {
		return `${this.dir}/${file}`;
	}

	private async readJson<T>(file: string): Promise<T | null> {
		const path = this.path(file);
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(path))) return null;
			const raw = await adapter.read(path);
			return JSON.parse(raw) as T;
		} catch (err) {
			console.error(`[pokemon-collection] failed reading ${file}`, err);
			return null;
		}
	}

	private async writeJson(file: string, data: unknown): Promise<void> {
		const path = this.path(file);
		try {
			const adapter = this.plugin.app.vault.adapter;
			if (!(await adapter.exists(this.dir))) {
				await adapter.mkdir(this.dir);
			}
			await adapter.write(path, JSON.stringify(data, null, "\t"));
		} catch (err) {
			console.error(`[pokemon-collection] failed writing ${file}`, err);
			new Notice(`Pokémon Collection: could not save ${file}.`);
		}
	}
}
