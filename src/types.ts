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
 * user-supplied string (e.g. "Full Art", "Secret Rare", "Alt Art").
 */
export type Variant = KnownVariant | string;

/** Stable identity used to join a table row to the JSON cache: `id:variant`. */
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
	/** Per-unit market price in the configured currency. May be undefined. */
	price?: number;
	/** Composite cache key `id:variant`. */
	key: CardKey;
}

/** Cached metadata for a card that is not stored in the Markdown table. */
export interface CachedCardMeta {
	id: string;
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

/** Persistent price history: portfolio snapshots only (per spec, v1). */
export interface PriceHistory {
	snapshots: ValueSnapshot[];
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
	set?: TcgdexSetRef;
	variants?: TcgdexVariants;
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

/** Pricing block; we consume cardmarket.trend (EUR). */
export interface TcgdexPricing {
	cardmarket?: TcgdexMarketPricing;
	tcgplayer?: Record<string, unknown>;
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
	/** Cardmarket-style set abbreviation, e.g. { official: "DAA" }. */
	abbreviation?: { official?: string; localId?: string };
	cards?: TcgdexCardBrief[];
}
