import { TcgdexCardFull, TcgdexVariantDetailed, VARIANT_LABELS } from "./types";

/** A selectable variant of a card: the stored value, a label, and its printing. */
export interface VariantOption {
	value: string;
	label: string;
	detail?: TcgdexVariantDetailed;
}

const TYPE_LABEL: Record<string, string> = {
	normal: "Normal",
	reverse: "Reverse Holo",
	holo: "Holo",
};

function prettify(s: string): string {
	return s.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** True for a non-standard card size (e.g. jumbo), which is its own printing. */
function oddSize(d: TcgdexVariantDetailed): boolean {
	return !!d.size && d.size !== "standard";
}

/**
 * Stable variant value for a detailed printing, e.g. "holo",
 * "holo-shadowless-1st-edition", "normal-jumbo". Lowercase, no pipe/colon,
 * so it is safe inside the Markdown table and the `id:variant` key.
 */
export function detailValue(d: TcgdexVariantDetailed): string {
	const parts = [d.type];
	if (d.subtype) parts.push(d.subtype);
	if (d.stamp?.length) parts.push(...d.stamp);
	if (oddSize(d)) parts.push(d.size as string);
	return parts.join("-").toLowerCase();
}

/** Human label for a detailed printing, e.g. "Holo (Shadowless, 1st Edition)". */
export function detailLabel(d: TcgdexVariantDetailed): string {
	const base = TYPE_LABEL[d.type] ?? prettify(d.type);
	const extras: string[] = [];
	if (d.subtype) extras.push(prettify(d.subtype));
	if (d.stamp?.length) extras.push(...d.stamp.map(prettify));
	if (oddSize(d)) extras.push(prettify(d.size as string));
	return extras.length ? `${base} (${extras.join(", ")})` : base;
}

/**
 * Variants a card actually has. Prefers TCGdex `variants_detailed` (so a
 * holo-only card never offers "Normal"); falls back to the boolean `variants`.
 */
export function variantOptions(card: TcgdexCardFull): VariantOption[] {
	const detailed = card.variants_detailed;
	if (detailed?.length) {
		const seen = new Set<string>();
		const out: VariantOption[] = [];
		for (const d of detailed) {
			if (!d?.type) continue;
			const value = detailValue(d);
			if (seen.has(value)) continue;
			seen.add(value);
			out.push({ value, label: detailLabel(d), detail: d });
		}
		if (out.length) return out;
	}

	const v = card.variants ?? {};
	const out: VariantOption[] = [];
	if (v.normal) out.push({ value: "normal", label: VARIANT_LABELS.normal });
	if (v.reverse) out.push({ value: "reverse", label: VARIANT_LABELS.reverse });
	if (v.holo) out.push({ value: "holo", label: VARIANT_LABELS.holo });
	if (v.firstEdition)
		out.push({ value: "firstEdition", label: VARIANT_LABELS.firstEdition });
	if (v.wPromo) out.push({ value: "promo", label: VARIANT_LABELS.promo });
	if (!out.length) out.push({ value: "normal", label: VARIANT_LABELS.normal });
	return out;
}

/**
 * Sensible default: the only option; else the plainest Normal printing
 * (no stamp, standard size, "unlimited"/no subtype first); else the first.
 */
export function defaultVariant(options: VariantOption[]): string {
	if (options.length === 1) return options[0].value;
	const rank = (o: VariantOption): number => {
		const d = o.detail;
		if (!d) return o.value === "normal" ? 0 : 99;
		if (d.type !== "normal") return 99;
		let r = 1;
		if (d.stamp?.length) r += 4;
		if (oddSize(d)) r += 4;
		if (d.subtype && d.subtype !== "unlimited") r += 2;
		return r;
	};
	let best = options[0];
	for (const o of options) if (rank(o) < rank(best)) best = o;
	return rank(best) < 99 ? best.value : options[0].value;
}

/** The default variant value for a card (used by bulk add and the selector). */
export function defaultVariantForCard(card: TcgdexCardFull): string {
	return defaultVariant(variantOptions(card));
}

/**
 * The detailed printing a stored variant refers to: an exact value match,
 * else (for bare/legacy values like "holo", "Reverse Holo", "firstEdition")
 * the plainest printing of that type.
 */
export function findDetail(
	card: TcgdexCardFull,
	variant: string
): TcgdexVariantDetailed | undefined {
	const detailed = card.variants_detailed?.filter((d) => d?.type);
	if (!detailed?.length) return undefined;
	const v = variant.trim().toLowerCase();

	const exact = detailed.find((d) => detailValue(d) === v);
	if (exact) return exact;

	const firstEd = /1st|first/.test(v);
	const type = baseType(v);
	const pool = detailed.filter((d) =>
		firstEd
			? d.stamp?.includes("1st-edition")
			: type
				? d.type === type
				: false
	);
	// Plainest printing first: no (other) stamp, standard size, unlimited.
	const extra = (d: TcgdexVariantDetailed): number =>
		(d.stamp?.length && !firstEd ? 4 : 0) +
		(oddSize(d) ? 4 : 0) +
		(d.subtype && d.subtype !== "unlimited" ? 2 : 0);
	return [...pool].sort((a, b) => extra(a) - extra(b))[0];
}

/** The TCGdex type a free-form variant string names, if recognisable. */
export function baseType(variant: string): "normal" | "reverse" | "holo" | undefined {
	const v = variant.toLowerCase();
	if (/reverse/.test(v)) return "reverse";
	if (/holo|foil/.test(v)) return "holo";
	if (/^normal\b/.test(v)) return "normal";
	return undefined;
}

/**
 * Map a typed variant ("reverse", "holo 1st", "Reverse Holo") to the card's
 * stored option value, so bulk-added rows share keys with selector-added ones.
 * Unrecognised text is kept as a custom variant.
 */
export function resolveVariant(card: TcgdexCardFull, text: string): string {
	const t = text.trim();
	if (!t) return defaultVariantForCard(card);
	const options = variantOptions(card);
	const lc = t.toLowerCase();
	const direct = options.find(
		(o) => o.value === lc || o.label.toLowerCase() === lc
	);
	if (direct) return direct.value;
	const d = findDetail(card, t);
	if (d) return detailValue(d);
	return t;
}
