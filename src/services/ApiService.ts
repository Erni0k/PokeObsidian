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

/** Result of resolving a "set code + number" lookup. */
export interface CodeLookupResult {
	/** Resolved set id, if the code was recognized. */
	setId?: string;
	/** Set display name (for messages). */
	setName?: string;
	/** First matching card brief (convenience for single-card callers). */
	brief?: TcgdexCardBrief;
	/** Every card in the set whose collector number matches. */
	cards: TcgdexCardBrief[];
}

/** Compare collector numbers leniently ("062" == "62", case-insensitive). */
export function sameNumber(localId: string | undefined, num: string): boolean {
	if (!localId) return false;
	const a = String(localId).toUpperCase();
	const b = num.toUpperCase();
	if (a === b) return true;
	return a.replace(/^0+/, "") === b.replace(/^0+/, "");
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
	async searchCards(
		query: CardSearchQuery,
		lang?: string
	): Promise<TcgdexCardBrief[]> {
		const name = query.name?.trim();
		const number = query.number?.trim();
		const set = query.set?.trim();

		let briefs: TcgdexCardBrief[];

		if (set) {
			// Resolve the set, then list its cards and filter locally.
			briefs = await this.cardsInSet(set, lang);
			if (name) {
				const lc = name.toLowerCase();
				briefs = briefs.filter((c) => c.name?.toLowerCase().includes(lc));
			}
		} else if (name) {
			const path = `/cards?name=${encodeURIComponent(name)}`;
			briefs = (await this.get<TcgdexCardBrief[]>(path, lang)) ?? [];
		} else if (number) {
			// Number-only search: too broad to fetch all cards; require a name/set.
			return [];
		} else {
			return [];
		}

		if (number) {
			briefs = briefs.filter((c) => sameNumber(c.localId, number));
		}

		return briefs.slice(0, 60);
	}

	/** Full card details for a single id. */
	async getCard(id: string, lang?: string): Promise<TcgdexCardFull | null> {
		const path = `/cards/${encodeURIComponent(id)}`;
		return await this.get<TcgdexCardFull>(path, lang);
	}

	/**
	 * Resolve a set code + collector number to card briefs. The code may be a
	 * short code ("DRI", or a localized one like FR "RVD") or a raw set id
	 * ("sv10"). `deep` allows lazily building the set index to resolve an
	 * unknown code (network-heavy); it searches the requested language first,
	 * then English, since short codes are sometimes localized.
	 */
	async findCardByCodeNumber(
		code: string,
		num: string,
		lang?: string,
		deep = false
	): Promise<CodeLookupResult> {
		const l = lang || this.lang;
		const setId = await this.resolveSetCode(code, l, deep);
		if (!setId) return { cards: [] };
		return this.findCardsInSet(setId, num, l);
	}

	/** Map a short code or raw set id to a set id, or undefined if unknown. */
	private async resolveSetCode(
		code: string,
		lang: string,
		deep: boolean
	): Promise<string | undefined> {
		const index = this.plugin.setIndex;
		const known = index.findSetIdByCode(code, lang);
		if (known) return known;

		// Raw set ids are lowercase and usually contain a digit ("sv10",
		// "swsh12.5"); verify by fetching rather than trusting the shape.
		const lc = code.toLowerCase();
		if (/\d/.test(code) || code === lc) {
			const maybe = await this.getSet(lc, lang);
			if (maybe?.cards?.length) return maybe.id;
		}

		if (!deep) return undefined;
		const found = await index.resolveCode(code, lang);
		if (found || lang === "en") return found;
		return await index.resolveCode(code, "en");
	}

	/**
	 * Cards in a set with the given collector number. Matches the set's card
	 * list leniently ("62" == "062"); if that yields nothing, tries the card id
	 * directly ("{setId}-{localId}", as typed and TCGdex-padded to 3 digits).
	 */
	async findCardsInSet(
		setId: string,
		num: string,
		lang?: string
	): Promise<CodeLookupResult> {
		const set = await this.getSet(setId, lang);
		let cards = set?.cards?.filter((c) => sameNumber(c.localId, num)) ?? [];

		if (!cards.length) {
			for (const local of this.localIdCandidates(num)) {
				const full = await this.getCard(`${setId}-${local}`, lang);
				if (full) {
					cards = [
						{
							id: full.id,
							localId: full.localId,
							name: full.name,
							image: full.image,
						},
					];
					break;
				}
			}
		}
		return {
			setId,
			setName: set?.name,
			brief: cards[0],
			cards,
		};
	}

	/** Plausible TCGdex localIds for a typed number ("21" → "21", "021"). */
	private localIdCandidates(num: string): string[] {
		const raw = num.trim();
		const out = [raw];
		const m = raw.match(/^([A-Za-z]*)(\d+)([A-Za-z]?)$/);
		if (m) {
			const [, pre, digits, suf] = m;
			const stripped = digits.replace(/^0+(?=\d)/, "");
			out.push(`${pre}${stripped.padStart(3, "0")}${suf}`);
			out.push(`${pre}${stripped}${suf}`);
			if (pre) out.push(`${pre.toUpperCase()}${stripped.padStart(2, "0")}${suf}`);
		}
		return [...new Set(out)];
	}

	/** Full set details (includes the Cardmarket abbreviation). */
	async getSet(id: string, lang?: string): Promise<TcgdexSetFull | null> {
		const path = `/sets/${encodeURIComponent(id)}`;
		const set = await this.get<TcgdexSetFull>(path, lang);
		if (set) this.plugin.setIndex?.noteFull(lang || this.lang, set);
		return set;
	}

	/** The full set list for a language, recorded into the set index. */
	async getSets(lang?: string, force = false): Promise<TcgdexSetBrief[]> {
		const list =
			(await this.get<TcgdexSetBrief[]>("/sets", lang, force)) ?? [];
		if (list.length) this.plugin.setIndex?.noteBriefs(lang || this.lang, list);
		return list;
	}

	/** The set id embedded in a card id ("sv10-021" → "sv10"). */
	setIdFromCardId(cardId: string): string {
		const i = cardId.indexOf("-");
		return i > 0 ? cardId.slice(0, i) : cardId;
	}

	/** The set's short code (abbreviation.official, e.g. "DRI"), if known. */
	async setAbbreviation(
		setId: string,
		lang?: string
	): Promise<string | undefined> {
		const set = await this.getSet(setId, lang);
		return set?.abbreviation?.official;
	}

	/**
	 * Best Cardmarket single-card URL for a card. Fetches the set to obtain the
	 * abbreviation and appends the `{ABBR}{Number}` suffix (e.g. Furret-DAA136).
	 * Falls back to a name search / suffix-less URL when data is missing.
	 */
	async cardmarketUrlForCard(
		card: TcgdexCardFull,
		lang?: string
	): Promise<string> {
		const l = lang || this.lang;
		// Cardmarket uses English card + set names, so always build from EN data.
		const en = l === "en" ? card : await this.getCard(card.id, "en");

		if (!en?.set?.name) {
			// No English set data (e.g. a Japanese-only set) — don't slug a
			// localized name; fall back to a search by the best name we have.
			return cardmarketSearchUrl(en?.name ?? card.name);
		}

		let code: string | undefined;
		const setId = en.set.id;
		if (setId) {
			const set = await this.getSet(setId, "en");
			const abbr = set?.abbreviation?.official;
			const num = this.cardmarketNumber(en.localId);
			if (abbr && num) code = `${abbr}${num}`;
		}
		return cardmarketSingleUrl(en.set.name, en.name, code);
	}

	/** Format a card's local id the way Cardmarket does (zero-pad numeric to 3). */
	private cardmarketNumber(localId?: string): string {
		if (localId === undefined || localId === null) return "";
		const s = String(localId);
		return /^\d+$/.test(s) ? s.padStart(3, "0") : s.toUpperCase();
	}

	/** Search sets by name (for the set filter dropdown / autocomplete). */
	async searchSets(name: string, lang?: string): Promise<TcgdexSetBrief[]> {
		const all = await this.getSets(lang);
		const lc = name.trim().toLowerCase();
		if (!lc) return all;
		return all.filter((s) => s.name?.toLowerCase().includes(lc));
	}

	private async cardsInSet(
		setQuery: string,
		lang?: string
	): Promise<TcgdexCardBrief[]> {
		// Try direct set id first, then fall back to a name search.
		const direct = await this.get<{ cards?: TcgdexCardBrief[] }>(
			`/sets/${encodeURIComponent(setQuery)}`,
			lang
		);
		if (direct?.cards?.length) return direct.cards;

		const matches = await this.searchSets(setQuery, lang);
		if (!matches.length) return [];
		const full = await this.get<{ cards?: TcgdexCardBrief[] }>(
			`/sets/${encodeURIComponent(matches[0].id)}`,
			lang
		);
		return full?.cards ?? [];
	}

	/**
	 * Cached GET. Returns fresh cache when available, otherwise fetches; on
	 * network error falls back to stale cache (offline support).
	 */
	private async get<T>(
		path: string,
		lang?: string,
		force = false
	): Promise<T | null> {
		const l = lang || this.lang;
		const cacheKey = `${l}${path}`;
		if (!force) {
			const fresh = this.plugin.cache.getFresh<T>(cacheKey);
			if (fresh !== undefined) return fresh;
		}

		const url = `${BASE_URL}/${l}${path}`;
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
