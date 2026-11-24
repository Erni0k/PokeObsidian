import { requestUrl, RequestUrlResponse } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type {
	TcgdexCardBrief,
	TcgdexCardFull,
	TcgdexSetBrief,
	TcgdexSetFull,
} from "../types";
import {
	cardmarketSearchUrl,
	cardmarketSingleUrl,
	isLatinName,
} from "../cardmarket";
import type { SetIndexEntry } from "./SetIndexService";

const BASE_URL = "https://api.tcgdex.net/v2";

/** Options for the cached GET. */
interface GetOptions {
	/** Skip the fresh cache and hit the network. */
	force?: boolean;
	/** Freshness window override, in hours. */
	ttlHours?: number;
	/** Return null instead of stale cache on network failure. */
	noStale?: boolean;
}

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
	/** Set ids whose English layer is being fetched or has no English set. */
	private enPending = new Set<string>();

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

	/**
	 * Full card details for a single id. TCGdex matches ids case-insensitively,
	 * so asking English for a Japanese id ("SV10-021", Heat Rotom) returns a
	 * different English card ("sv10-021", Smoliv). Only an exact id match is
	 * accepted, so localized ids never pick up another language's card.
	 */
	async getCard(
		id: string,
		lang?: string,
		opts: { force?: boolean } = {}
	): Promise<TcgdexCardFull | null> {
		const path = `/cards/${encodeURIComponent(id)}`;
		const card = await this.get<TcgdexCardFull>(path, lang, { force: opts.force });
		return card && card.id === id ? card : null;
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
	async resolveSetCode(
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

	/**
	 * Full set details (includes the Cardmarket abbreviation), recorded into
	 * the set index. For a non-English set, the English layer is filled in the
	 * background (once per set), since Cardmarket links need English names.
	 */
	async getSet(id: string, lang?: string): Promise<TcgdexSetFull | null> {
		const l = lang || this.lang;
		const path = `/sets/${encodeURIComponent(id)}`;
		const set = await this.get<TcgdexSetFull>(path, l);
		if (set) {
			this.plugin.setIndex?.noteFull(l, set);
			if (l !== "en") this.fillEnglishLayer(set.id);
		}
		return set;
	}

	/** Fetch the English variant of a set into the index, if not known yet. */
	private fillEnglishLayer(setId: string): void {
		const index = this.plugin.setIndex;
		if (!index || index.hasFull("en", setId) || this.enPending.has(setId)) {
			return;
		}
		// Stays in the set when there is no English set (e.g. Japanese-only),
		// so we don't retry it on every lookup this session.
		this.enPending.add(setId);
		void this.getSet(setId, "en")
			.then((en) => {
				// Exact id only: "SV10" (ja) resolves to EN "sv10", another set.
				if (en?.id === setId) this.enPending.delete(setId);
			})
			.catch(() => undefined);
	}

	/**
	 * The full set list for a language, recorded into the set index. Uses its
	 * own (shorter) TTL so newly released sets appear without a manual refresh.
	 */
	async getSets(lang?: string, force = false): Promise<TcgdexSetBrief[]> {
		const list =
			(await this.get<TcgdexSetBrief[]>("/sets", lang, {
				force,
				ttlHours: this.plugin.settings.setsListTtlHours,
			})) ?? [];
		if (list.length) {
			const added = this.plugin.setIndex?.noteBriefs(lang || this.lang, list);
			// A TTL-expired reload can surface new releases: announce them here
			// too, since a later "Refresh Pokémon sets" would see them as known.
			if (added?.length) this.plugin.setIndex.announceNew(lang || this.lang, added);
		}
		return list;
	}

	/**
	 * Force a fresh /sets download; null when the network is unavailable (no
	 * stale fallback, so callers can tell "offline" from "nothing new").
	 */
	async fetchSetsFresh(lang?: string): Promise<TcgdexSetBrief[] | null> {
		const list = await this.get<TcgdexSetBrief[]>("/sets", lang, {
			force: true,
			noStale: true,
		});
		if (list?.length) this.plugin.setIndex?.noteBriefs(lang || this.lang, list);
		return list;
	}

	// --- set index (local, works offline) -------------------------------------

	/**
	 * Map a set short code (e.g. "DRI", case-insensitive) to a set id using
	 * the local index only: searches `lang`, then English.
	 */
	abbreviationToSetId(code: string, lang?: string): string | undefined {
		return this.plugin.setIndex.findSetIdByCode(code, lang);
	}

	/** Every indexed set for a language (id, name, codes, card counts). */
	getSetIndex(lang?: string): SetIndexEntry[] {
		return this.plugin.setIndex.allSets(lang);
	}

	/** English set name for a set id (for Cardmarket links), if indexed. */
	getSetNameEn(setId: string): string | undefined {
		return this.plugin.setIndex.getNameEn(setId);
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
	 * Best Cardmarket single-card URL for a card, always built from English
	 * data (Cardmarket uses English set + card names):
	 * `/Singles/{EN set}/{EN name}-{ABBR}{Number}`.
	 *
	 * For a non-English card the English printing is looked up by the same id
	 * (exact match only — see {@link getCard}). If there is none (a
	 * Japanese-only release), falls back to a Cardmarket search by the card's
	 * English name (derived from its Pokédex number), or no link at all when
	 * no English name can be found. Never slugs a localized name.
	 */
	async cardmarketUrlForCard(
		card: TcgdexCardFull,
		lang?: string
	): Promise<string | undefined> {
		const l = lang || this.lang;
		const en = l === "en" ? card : await this.englishPrinting(card);

		if (!en?.set?.name || !isLatinName(en.set.name) || !isLatinName(en.name)) {
			const name = en?.name ?? (await this.englishNameFor(card));
			return name && isLatinName(name) ? cardmarketSearchUrl(name) : undefined;
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

	/** The English printing of a localized card (same id), if it exists. */
	private async englishPrinting(
		card: TcgdexCardFull
	): Promise<TcgdexCardFull | null> {
		const en = await this.getCard(card.id, "en");
		if (!en) return null;
		// Same id but a different Pokémon would mean a different card.
		const a = card.dexId ?? [];
		const b = en.dexId ?? [];
		if (a.length && b.length && !a.some((d) => b.includes(d))) return null;
		return en;
	}

	/**
	 * English name for a card with no English printing, from its Pokédex
	 * number(s): the most common English card name for that Pokémon, plus a
	 * Latin mechanic suffix from the original name ("リザードンex" → "Charizard
	 * ex", tag teams joined with " & "). Undefined for trainers/energy.
	 */
	async englishNameFor(card: TcgdexCardFull): Promise<string | undefined> {
		const dex = card.dexId ?? [];
		if (!dex.length) return undefined;
		const species: string[] = [];
		for (const n of dex) {
			const list = await this.get<TcgdexCardBrief[]>(
				`/cards?dexId=eq:${encodeURIComponent(String(n))}`,
				"en"
			);
			const counts = new Map<string, number>();
			for (const c of list ?? []) {
				if (c.name) counts.set(c.name, (counts.get(c.name) ?? 0) + 1);
			}
			let best: string | undefined;
			for (const [name, count] of counts) {
				const cur = best ? counts.get(best) ?? 0 : -1;
				if (count > cur || (count === cur && best && name.length < best.length)) {
					best = name;
				}
			}
			if (!best) return undefined;
			species.push(best);
		}
		const suffix = card.name.match(
			/(?:^|[^\p{Script=Latin}])((?:ex|EX|GX|V|VMAX|VSTAR|V-UNION|BREAK|LV\.X|Prime|LEGEND|δ|☆))\s*$/u
		)?.[1];
		const base = species.join(" & ");
		return suffix ? `${base} ${suffix}` : base;
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
		opts: GetOptions = {}
	): Promise<T | null> {
		const l = lang || this.lang;
		const cacheKey = `${l}${path}`;
		const stale = (): T | null =>
			opts.noStale ? null : this.plugin.cache.getStale<T>(cacheKey) ?? null;
		if (!opts.force) {
			const fresh = this.plugin.cache.getFresh<T>(cacheKey, opts.ttlHours);
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
				return stale();
			}
			const data = res.json as T;
			await this.plugin.cache.put(cacheKey, data);
			return data;
		} catch (err) {
			console.error(`[pokemon-collection] network error for ${url}`, err);
			return stale();
		}
	}
}
