import { requestUrl, RequestUrlResponse } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type {
	TcgdexCardBrief,
	TcgdexCardFull,
	TcgdexSetBrief,
	TcgdexSetFull,
} from "../types";
import { cardmarketSearchUrl, cardmarketSingleUrl } from "../cardmarket";

const BASE_URL = "https://api.tcgdex.net/v2";

export interface CardSearchQuery {
	name?: string;
	number?: string;
	set?: string;
}

/**
 * Thin TCGdex REST client built on Obsidian's `requestUrl` so it works on both
 * desktop and mobile (bypasses CORS). All GETs are cached through
 * {@link CacheService} with a TTL; on network failure we fall back to stale
 * cache so the plugin degrades gracefully offline.
 */
export class ApiService {
	private plugin: PokemonCollectionPlugin;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
	}

	private get lang(): string {
		return this.plugin.settings.preferredLanguage || "en";
	}

	/** Base image URL → a concrete PNG url at the requested quality. */
	imageUrl(base: string | undefined, quality: "high" | "low" = "high"): string | undefined {
		if (!base) return undefined;
		return `${base}/${quality}.png`;
	}

	/** Set symbol/logo base → concrete PNG url. */
	assetUrl(base: string | undefined): string | undefined {
		if (!base) return undefined;
		return `${base}.png`;
	}

	/** tcgdex.dev card page for a card id. */
	cardPageUrl(id: string): string {
		return `https://www.tcgdex.dev/en/cards/${id}`;
	}

	/**
	 * Search cards by any combination of name / number / set.
	 * Returns up to a reasonable number of briefs, filtered client-side for
	 * fields the list endpoint cannot filter on.
	 */
	async searchCards(query: CardSearchQuery): Promise<TcgdexCardBrief[]> {
		const name = query.name?.trim();
		const number = query.number?.trim();
		const set = query.set?.trim();

		let briefs: TcgdexCardBrief[];

		if (set) {
			// Resolve the set, then list its cards and filter locally.
			briefs = await this.cardsInSet(set);
			if (name) {
				const lc = name.toLowerCase();
				briefs = briefs.filter((c) => c.name?.toLowerCase().includes(lc));
			}
		} else if (name) {
			const path = `/cards?name=${encodeURIComponent(name)}`;
			briefs = (await this.get<TcgdexCardBrief[]>(path)) ?? [];
		} else if (number) {
			// Number-only search: too broad to fetch all cards; require a name/set.
			return [];
		} else {
			return [];
		}

		if (number) {
			briefs = briefs.filter(
				(c) => (c.localId ?? "").toString() === number
			);
		}

		return briefs.slice(0, 60);
	}

	/** Full card details for a single id. */
	async getCard(id: string): Promise<TcgdexCardFull | null> {
		const path = `/cards/${encodeURIComponent(id)}`;
		return await this.get<TcgdexCardFull>(path);
	}

	/** Full set details (includes the Cardmarket abbreviation). */
	async getSet(id: string): Promise<TcgdexSetFull | null> {
		const path = `/sets/${encodeURIComponent(id)}`;
		return await this.get<TcgdexSetFull>(path);
	}

	/** The set id embedded in a card id ("sv10-021" → "sv10"). */
	setIdFromCardId(cardId: string): string {
		const i = cardId.indexOf("-");
		return i > 0 ? cardId.slice(0, i) : cardId;
	}

	/** The set's short code (abbreviation.official, e.g. "DRI"), if known. */
	async setAbbreviation(setId: string): Promise<string | undefined> {
		const set = await this.getSet(setId);
		return set?.abbreviation?.official;
	}

	/**
	 * Best Cardmarket single-card URL for a card. Fetches the set to obtain the
	 * abbreviation and appends the `{ABBR}{Number}` suffix (e.g. Furret-DAA136).
	 * Falls back to a name search / suffix-less URL when data is missing.
	 */
	async cardmarketUrlForCard(card: TcgdexCardFull): Promise<string> {
		const setName = card.set?.name;
		if (!setName) return cardmarketSearchUrl(card.name);

		let code: string | undefined;
		const setId = card.set?.id;
		if (setId) {
			const set = await this.getSet(setId);
			const abbr = set?.abbreviation?.official;
			const num = this.cardmarketNumber(card.localId);
			if (abbr && num) code = `${abbr}${num}`;
		}
		return cardmarketSingleUrl(setName, card.name, code);
	}

	/** Format a card's local id the way Cardmarket does (zero-pad numeric to 3). */
	private cardmarketNumber(localId?: string): string {
		if (localId === undefined || localId === null) return "";
		const s = String(localId);
		return /^\d+$/.test(s) ? s.padStart(3, "0") : s.toUpperCase();
	}

	/** Search sets by name (for the set filter dropdown / autocomplete). */
	async searchSets(name: string): Promise<TcgdexSetBrief[]> {
		const all = (await this.get<TcgdexSetBrief[]>("/sets")) ?? [];
		const lc = name.trim().toLowerCase();
		if (!lc) return all;
		return all.filter((s) => s.name?.toLowerCase().includes(lc));
	}

	private async cardsInSet(setQuery: string): Promise<TcgdexCardBrief[]> {
		// Try direct set id first, then fall back to a name search.
		const direct = await this.get<{ cards?: TcgdexCardBrief[] }>(
			`/sets/${encodeURIComponent(setQuery)}`
		);
		if (direct?.cards?.length) return direct.cards;

		const matches = await this.searchSets(setQuery);
		if (!matches.length) return [];
		const full = await this.get<{ cards?: TcgdexCardBrief[] }>(
			`/sets/${encodeURIComponent(matches[0].id)}`
		);
		return full?.cards ?? [];
	}

	/**
	 * Cached GET. Returns fresh cache when available, otherwise fetches; on
	 * network error falls back to stale cache (offline support).
	 */
	private async get<T>(path: string): Promise<T | null> {
		const cacheKey = `${this.lang}${path}`;
		const fresh = this.plugin.cache.getFresh<T>(cacheKey);
		if (fresh !== undefined) return fresh;

		const url = `${BASE_URL}/${this.lang}${path}`;
		try {
			const res: RequestUrlResponse = await requestUrl({
				url,
				method: "GET",
				headers: { Accept: "application/json" },
				throw: false,
			});
			if (res.status < 200 || res.status >= 300) {
				console.warn(
					`[pokemon-collection] GET ${url} -> ${res.status}`
				);
				return this.plugin.cache.getStale<T>(cacheKey) ?? null;
			}
			const data = res.json as T;
			await this.plugin.cache.put(cacheKey, data);
			return data;
		} catch (err) {
			console.error(`[pokemon-collection] network error for ${url}`, err);
			return this.plugin.cache.getStale<T>(cacheKey) ?? null;
		}
	}
}
