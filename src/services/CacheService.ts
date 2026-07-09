import { Notice } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type {
	ApiCache,
	CachedCardMeta,
	CacheRecord,
	CardKey,
	MetaCache,
	PriceHistory,
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
		this.history = (await this.readJson<PriceHistory>(HISTORY_FILE)) ?? {
			snapshots: [],
		};
	}

	// --- API response cache (TTL) ------------------------------------------

	/** Returns cached data for `key` if still fresh, else undefined. */
	getFresh<T>(key: string): T | undefined {
		const rec = this.apiCache.entries[key];
		if (!rec) return undefined;
		const ageMs = Date.now() - new Date(rec.fetchedAt).getTime();
		const ttlMs = this.plugin.settings.cacheDurationHours * 3600 * 1000;
		if (ageMs > ttlMs) return undefined;
		return rec.data as T;
	}

	/** Returns cached data regardless of age (used as offline fallback). */
	getStale<T>(key: string): T | undefined {
		return this.apiCache.entries[key]?.data as T | undefined;
	}

	async put(key: string, data: unknown): Promise<void> {
		const rec: CacheRecord = { fetchedAt: new Date().toISOString(), data };
		this.apiCache.entries[key] = rec;
		await this.writeJson(CACHE_FILE, this.apiCache);
	}

	async clearApiCache(): Promise<void> {
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
