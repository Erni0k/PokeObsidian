import type { TcgdexCardFull } from "./types";

/**
 * Cardmarket link helpers.
 *
 * Cardmarket single-card pages follow the pattern
 *   https://www.cardmarket.com/en/Pokemon/Products/Singles/{Expansion}/{Card-Name}
 * We build that canonical URL from the TCGdex set + card name (best-effort:
 * slugs mostly match, but ambiguous names may need Cardmarket's -V1/-V2
 * suffixes). When the set is unknown we fall back to a name search.
 */

const CM_BASE = "https://www.cardmarket.com/en/Pokemon/Products";

/** Slugify a name the way Cardmarket does for its URLs. */
function slug(value: string): string {
	return value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "") // strip accents
		.replace(/['".]/g, "") // drop apostrophes/quotes/periods
		.replace(/[^A-Za-z0-9]+/g, "-") // everything else -> hyphen
		.replace(/^-+|-+$/g, "");
}

/** Reverse a slug back to a searchable phrase ("Darkness-Ablaze" -> "Darkness Ablaze"). */
function deslug(value: string): string {
	return decodeURIComponent(value).replace(/-+/g, " ").trim();
}

export function cardmarketSearchUrl(name: string): string {
	const q = encodeURIComponent(name.trim());
	return `${CM_BASE}/Search?searchString=${q}`;
}

/** Canonical Cardmarket single-card URL for a card, or a search fallback. */
export function cardmarketUrlForCard(card: TcgdexCardFull): string {
	const setName = card.set?.name;
	if (!setName) return cardmarketSearchUrl(card.name);
	return `${CM_BASE}/Singles/${slug(setName)}/${slug(card.name)}`;
}

/** Canonical URL from a stored set name + card name (used when rendering rows). */
export function cardmarketUrl(setName: string, name: string): string {
	if (!setName) return cardmarketSearchUrl(name);
	return `${CM_BASE}/Singles/${slug(setName)}/${slug(name)}`;
}

/** Parsed hint extracted from a pasted Cardmarket URL. */
export interface CardmarketLinkInfo {
	name?: string;
	set?: string;
}

/**
 * Extract a card name (and set) from a pasted Cardmarket URL. Handles both the
 * canonical Singles path and the search URL form. Returns null if nothing
 * useful can be parsed.
 */
export function parseCardmarketUrl(url: string): CardmarketLinkInfo | null {
	const trimmed = url.trim();

	const single = trimmed.match(/\/Singles\/([^/?#]+)\/([^/?#]+)/i);
	if (single) {
		const set = deslug(single[1]);
		// Drop Cardmarket's disambiguation suffix, e.g. "Furret-V1".
		const name = deslug(single[2]).replace(/\s+V\d+$/i, "");
		return { name, set };
	}

	const search = trimmed.match(/[?&]searchString=([^&#]+)/i);
	if (search) {
		return { name: deslug(search[1]) };
	}

	return null;
}
