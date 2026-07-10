/**
 * Cardmarket link helpers.
 *
 * Cardmarket single-card pages follow the pattern
 *   https://www.cardmarket.com/en/Pokemon/Products/Singles/{Expansion}/{Card-Name}-{ABBR}{Number}
 * e.g. .../Singles/Darkness-Ablaze/Furret-DAA136. The set abbreviation lives
 * only on the full /sets/{id} endpoint, so the fully-qualified URL is built
 * asynchronously in ApiService; the sync helpers here handle slugging, the
 * fallback (no code suffix), and parsing pasted links.
 */

const CM_BASE = "https://www.cardmarket.com/en/Pokemon/Products";

/** Slugify a name the way Cardmarket does for its URLs. */
export function slug(value: string): string {
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

/**
 * Build a canonical single-card URL. `code` is the Cardmarket suffix
 * (`{ABBR}{Number}`, e.g. "DAA136"); omit it for the best-effort fallback.
 */
export function cardmarketSingleUrl(
	setName: string,
	name: string,
	code?: string
): string {
	if (!setName) return cardmarketSearchUrl(name);
	const suffix = code ? `-${code}` : "";
	return `${CM_BASE}/Singles/${slug(setName)}/${slug(name)}${suffix}`;
}

/** Sync fallback used when rendering rows without a cached URL. */
export function cardmarketUrl(setName: string, name: string): string {
	return cardmarketSingleUrl(setName, name);
}

/** Parsed hint extracted from a pasted Cardmarket URL. */
export interface CardmarketLinkInfo {
	name?: string;
	set?: string;
	number?: string;
}

/**
 * Extract card name / set / number from a pasted Cardmarket URL. Handles the
 * canonical Singles path (with or without the `{ABBR}{Number}` suffix) and the
 * search URL form. Returns null if nothing useful can be parsed.
 */
export function parseCardmarketUrl(url: string): CardmarketLinkInfo | null {
	const trimmed = url.trim();

	const single = trimmed.match(/\/Singles\/([^/?#]+)\/([^/?#]+)/i);
	if (single) {
		const set = deslug(single[1]);
		const raw = single[2];
		// Peel off a "{ABBR}{Number}" code suffix (e.g. Furret-DAA136).
		const code = raw.match(/^(.+?)-([A-Za-z]{2,4})(\d{1,4})$/);
		if (code) {
			return {
				set,
				name: deslug(code[1]),
				number: String(Number.parseInt(code[3], 10)),
			};
		}
		// Otherwise drop a plain "-V1" disambiguation suffix if present.
		return { set, name: deslug(raw).replace(/\s+V\d+$/i, "") };
	}

	const search = trimmed.match(/[?&]searchString=([^&#]+)/i);
	if (search) {
		return { name: deslug(search[1]) };
	}

	return null;
}
