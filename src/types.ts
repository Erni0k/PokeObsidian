/**
 * Data models for the Pokémon Collection plugin.
 *
 * Design note: the Markdown table in a note is the source of truth for what the
 * user owns (which card, variant, language, quantity, price). Everything here
 * that is *not* stored in the table lives in the JSON cache and is keyed by the
 * card's stable {@link CardKey} (`tcgdexId:variant`).
 */

/** Variants exposed by TCGdex as booleans on a card, plus user-defined ones. */
export type KnownVariant =
	| "normal"
	| "reverse"
	| "holo"
	| "firstEdition"
	| "promo";

/**
 * A variant is either one of the known TCGdex variants or an arbitrary
 * user-supplied string (e.g. "Full Art", "Secret Rare", "Alt Art"); see
 * {@link KnownVariant} for the known ones.
 */
export type Variant = string;

/**
 * Row identity: `id:variant:cond` plus `:grade` for graded cards (legacy
 * `id:variant` = NM). The JSON caches (meta, price history) are keyed by the
 * printing only, `id:variant`, since image and market price don't depend on
 * condition.
 */
export type CardKey = string;

/** Human display labels for the known variants. */
export const VARIANT_LABELS: Record<KnownVariant, string> = {
	normal: "Normal",
	reverse: "Reverse Holo",
	holo: "Holo",
	firstEdition: "First Edition",
	promo: "Promo",
};

/**
 * A single row of a collection, as reconstructed from the Markdown table.
 * The visible columns are: Card | Set | Number | Variant | Lang | Qty | Price | ID.
 */
export interface CollectionEntry {
	/** TCGdex card id, e.g. "swsh3-136". */
	id: string;
	/** Card name, e.g. "Pikachu". */
	name: string;
	/** Set display name, e.g. "Base Set". */
	setName: string;
	/** Local card number within the set, e.g. "58". */
	number: string;
	/** Chosen variant (known or custom). */
	variant: Variant;
	/** Language label, e.g. "EN", "JA". */
	language: string;
	/** How many copies are owned. */
	quantity: number;
	/** Raw card condition (NM, LP, MP, HP, DMG); NM for legacy rows. */
	condition: string;
	/** Professional grade, e.g. "PSA 10"; empty/undefined for raw cards. */
	grade?: string;
	/**
	 * Per-unit price in the configured currency. May be undefined. Graded
	 * cards are priced by hand only (never overwritten by price updates).
	 */
	price?: number;
	/**
	 * Currency of `price` ("EUR", "USD"), read from the Price cell's symbol.
	 * Undefined = the active price source's currency.
	 */
	currency?: string;
	/** Row identity `id:variant:cond[:grade]`. */
	key: CardKey;
}

/** Cached metadata for a card that is not stored in the Markdown table. */
export interface CachedCardMeta {
	id: string;
	/** TCGdex language the card was fetched in (ids are per language). */
	lang?: string;
	name: string;
	setName: string;
	setCode: string;
	rarity?: string;
	/** Base image URL (without quality/extension suffix). */
	image?: string;
	/** Set symbol icon URL (without extension). */
	setIcon?: string;
	/** Canonical card URL on tcgdex.dev / dashboards. */
	cardUrl?: string;
	/** Last fetched per-unit market price. */
	marketPrice?: number;
	/** Currency of {@link marketPrice}. */
	currency?: string;
	/** Cardmarket product id (from TCGdex pricing), if known. */
	cardmarketId?: number;
	/** Link to the card on Cardmarket. */
	cardmarketUrl?: string;
	/** ISO timestamp of the last price refresh. */
	lastPriceUpdate?: string;
	/** ISO timestamp when first cached. */
	dateAdded?: string;
}

/** A single portfolio-value snapshot appended on "update all prices". */
export interface ValueSnapshot {
	/** ISO timestamp. */
	timestamp: string;
	/** Total value = Σ (price × quantity) across the collection folder. */
	totalValue: number;
	/** Total number of physical cards (Σ quantity). */
	totalCards: number;
	/** Number of distinct card keys. */
	uniqueCards: number;
	/** Currency of {@link totalValue}. */
	currency: string;
}

/** One recorded price of a card: ISO timestamp + per-unit price. */
export interface PricePoint {
	t: string;
	p: number;
	/** Currency of `p` (absent on points recorded before sources existed = EUR). */
	c?: string;
}

/**
 * Persistent price history: portfolio snapshots, plus per-card points keyed
 * by {@link CardKey} (recorded only when the price changes). Older files have
 * no `cards` — treated as empty.
 */
export interface PriceHistory {
	snapshots: ValueSnapshot[];
	cards?: Record<CardKey, PricePoint[]>;
}

/** On-disk shape of the API response cache. */
export interface ApiCache {
	/** Keyed by cache key (e.g. "card:swsh3-136" or "search:pikachu"). */
	entries: Record<string, CacheRecord>;
}

export interface CacheRecord {
	/** ISO timestamp when stored. */
	fetchedAt: string;
	/** Arbitrary cached payload. */
	data: unknown;
}

/** Card metadata cache, keyed by {@link CardKey} for owned cards. */
export interface MetaCache {
	cards: Record<CardKey, CachedCardMeta>;
}

// ---------------------------------------------------------------------------
// TCGdex API response shapes (subset we consume).
// ---------------------------------------------------------------------------

/** Brief card as returned by the `/cards` list endpoint. */
export interface TcgdexCardBrief {
	id: string;
	localId?: string;
	name: string;
	image?: string;
}

/** Full card as returned by `/cards/{id}`. */
export interface TcgdexCardFull {
	id: string;
	localId?: string;
	name: string;
	image?: string;
	category?: string;
	rarity?: string;
	/** National Pokédex number(s) of the Pokémon on the card (none for trainers). */
	dexId?: number[];
	set?: TcgdexSetRef;
	variants?: TcgdexVariants;
	variants_detailed?: TcgdexVariantDetailed[];
	pricing?: TcgdexPricing;
}

/** One concrete printing of a card (type + optional subtype/stamp + pricing). */
export interface TcgdexVariantDetailed {
	/** "normal", "reverse", "holo", or another type TCGdex may add. */
	type: string;
	subtype?: string;
	stamp?: string[];
	size?: string;
	variantId?: string;
	thirdParty?: { cardmarket?: number; tcgplayer?: number };
	pricing?: TcgdexPricing;
}

export interface TcgdexSetRef {
	id: string;
	name: string;
	symbol?: string;
	logo?: string;
	cardCount?: { total?: number; official?: number };
}

export interface TcgdexVariants {
	normal?: boolean;
	reverse?: boolean;
	holo?: boolean;
	firstEdition?: boolean;
	wPromo?: boolean;
}

/** Pricing block: Cardmarket (EUR) and TCGplayer (USD). */
export interface TcgdexPricing {
	cardmarket?: TcgdexMarketPricing;
	/** `null` on printings TCGplayer doesn't price (e.g. shadowless). */
	tcgplayer?: TcgplayerPricing | null;
}

/** One TCGplayer printing price ("normal", "reverse-holofoil", "holofoil", …). */
export interface TcgplayerPrice {
	productId?: number;
	lowPrice?: number | null;
	midPrice?: number | null;
	highPrice?: number | null;
	marketPrice?: number | null;
	directLowPrice?: number | null;
}

/**
 * TCGdex `pricing.tcgplayer`: `unit` ("USD"), `updated`, plus one entry per
 * printing keyed like "normal", "reverse-holofoil", "holofoil",
 * "1st-edition-holofoil", "unlimited-holofoil", "1st-edition-normal".
 */
export interface TcgplayerPricing {
	unit?: string;
	updated?: string;
	[printing: string]: TcgplayerPrice | string | undefined;
}

export interface TcgdexMarketPricing {
	unit?: string;
	/** Cardmarket product id. */
	idProduct?: number;
	trend?: number;
	avg?: number;
	avg1?: number;
	avg7?: number;
	avg30?: number;
	low?: number;
	// Holo / reverse-holo prices (Cardmarket uses hyphenated keys).
	"trend-holo"?: number;
	"avg-holo"?: number;
	"avg1-holo"?: number;
	"avg7-holo"?: number;
	"avg30-holo"?: number;
	"low-holo"?: number;
}

/** Brief set as returned by `/sets`. */
export interface TcgdexSetBrief {
	id: string;
	name: string;
	symbol?: string;
	logo?: string;
	cardCount?: { total?: number; official?: number };
}

/** Full set as returned by `/sets/{id}` (adds abbreviation + card list). */
export interface TcgdexSetFull extends TcgdexSetBrief {
	/**
	 * Set abbreviation, e.g. { official: "DRI", localized: "RVD" }. `official`
	 * is the Cardmarket code; `localized` is the printed code in some languages.
	 */
	abbreviation?: { official?: string; localized?: string };
	cards?: TcgdexCardBrief[];
}
