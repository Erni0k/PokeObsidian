import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry, TcgdexCardFull } from "../types";
import { parseCsv } from "../csv";
import { currencyFromText } from "../currency";
import { cardmarketUrl, slug } from "../cardmarket";
import { normalizeCondition, normalizeGrade, parseCondition } from "../condition";
import { baseType, defaultVariantForCard, resolveVariant, variantOptions } from "../variants";
import { sameNumber } from "./ApiService";
import { buildEntryFromCard } from "../ui/buildEntry";

/** Columns of our own export, in order. */
export const EXPORT_COLUMNS = [
	"id",
	"name",
	"set",
	"setCode",
	"number",
	"variant",
	"lang",
	"qty",
	"price",
	"paid",
	"condition",
	"grade",
	"note",
	"currency",
] as const;

/** Fields a CSV column can be mapped to. */
export type CsvField =
	| (typeof EXPORT_COLUMNS)[number]
	| "gradingCompany"
	| "category"
	| "reverseHolo"
	| "foil"
	| "firstEd";

export const CSV_FIELD_LABELS: Record<CsvField, string> = {
	id: "TCGdex id",
	name: "Card name",
	set: "Set name",
	setCode: "Set code",
	number: "Card number",
	variant: "Variant / printing",
	lang: "Language",
	qty: "Quantity",
	price: "Price",
	paid: "Paid (not stored yet)",
	condition: "Condition",
	grade: "Grade",
	gradingCompany: "Grading company",
	note: "Note (target note path)",
	currency: "Price currency (EUR, USD)",
	category: "Game / category (non-Pokémon rows skipped)",
	reverseHolo: "Reverse holo flag (Y/N)",
	foil: "Foil / holo flag (Y/N)",
	firstEd: "1st edition flag (Y/N)",
};

export const CSV_FIELDS = Object.keys(CSV_FIELD_LABELS) as CsvField[];

export type PresetId = "ours" | "collectr" | "tcgplayer" | "cardmarket" | "custom";

/**
 * Known export formats, recognised by their header names. Header lists come
 * from the apps' published / third-party-documented exports; a trailing `*`
 * matches a prefix (Collectr's "Market Price (As of …)"). Every mapping stays
 * editable in the import modal, so a renamed column is a dropdown away.
 */
interface Preset {
	id: PresetId;
	label: string;
	/** Any one of these header sets (all present) identifies the format. */
	signatures: string[][];
	aliases: Partial<Record<CsvField, string[]>>;
	/** Our own file: keep prices, variants and names exactly (1:1 restore). */
	exact?: boolean;
	/** Default language label when the file has no language column. */
	defaultLang?: string;
	/** Currency of the file's prices when it doesn't say (no column/symbol). */
	currency?: string;
}

export const PRESETS: Preset[] = [
	{
		id: "ours",
		label: "Pokémon Collection export",
		exact: true,
		// Exports made before price sources existed were all Cardmarket.
		currency: "EUR",
		signatures: [["id", "setcode", "variant", "qty", "condition"]],
		aliases: Object.fromEntries(EXPORT_COLUMNS.map((c) => [c, [c]])),
	},
	{
		id: "collectr",
		label: "Collectr",
		defaultLang: "EN",
		currency: "USD",
		signatures: [
			["product name", "variance"],
			["product name", "card condition"],
			["product name", "average cost paid"],
		],
		aliases: {
			category: ["category"],
			name: ["product name"],
			set: ["set"],
			number: ["card number"],
			variant: ["variance"],
			condition: ["card condition"],
			grade: ["grade"],
			gradingCompany: ["grading company"],
			qty: ["quantity"],
			price: ["market price*"],
			paid: ["average cost paid"],
		},
	},
	{
		id: "tcgplayer",
		label: "TCGplayer",
		defaultLang: "EN",
		currency: "USD",
		signatures: [
			["tcgplayer id", "product name"],
			["product line", "product name", "set name"],
		],
		aliases: {
			category: ["product line"],
			name: ["product name", "name"],
			set: ["set name", "set"],
			number: ["number", "card number"],
			variant: ["printing", "finish"],
			condition: ["condition"],
			qty: ["total quantity", "quantity", "add to quantity"],
			price: ["tcg market price", "market price"],
			lang: ["language"],
		},
	},
	{
		id: "cardmarket",
		label: "Cardmarket",
		currency: "EUR",
		signatures: [["idproduct", "amount"], ["idproduct", "count"], ["idproduct", "condition"]],
		aliases: {
			name: ["english name", "enname", "name", "local name"],
			set: ["expansion", "exp. name", "expansion name"],
			setCode: ["setcode", "set code", "exp.", "expansioncode"],
			number: ["collectornumber", "collector number", "number"],
			lang: ["language"],
			condition: ["condition"],
			reverseHolo: ["reverseholo", "isreverseholo", "reverse holo?", "reverse holo"],
			foil: ["foil", "isfoil", "foil?"],
			firstEd: ["firsted", "isfirsted", "first edition?", "first edition"],
			qty: ["amount", "count", "quantity"],
			price: ["price_eur", "price"],
		},
	},
];

/** Fallback aliases for an unknown file (generic header names). */
const GENERIC: Partial<Record<CsvField, string[]>> = {
	id: ["id", "tcgdex id", "card id"],
	name: ["name", "card name", "card", "product name", "english name"],
	set: ["set", "set name", "expansion", "edition"],
	setCode: ["set code", "setcode", "code"],
	number: ["number", "card number", "collector number", "no", "no."],
	variant: ["variant", "printing", "finish", "variance"],
	lang: ["language", "lang"],
	qty: ["qty", "quantity", "count", "amount"],
	price: ["price", "market price"],
	paid: ["paid", "purchase price", "cost"],
	condition: ["condition", "card condition", "cond"],
	grade: ["grade"],
	gradingCompany: ["grading company"],
	note: ["note"],
	category: ["category", "game", "product line"],
};

/** Column index per field (-1 = not mapped). */
export type Mapping = Record<CsvField, number>;

export interface CsvTable {
	headers: string[];
	rows: string[][];
}

export function readTable(text: string): CsvTable {
	const all = parseCsv(text);
	const headers = (all[0] ?? []).map((h) => h.trim());
	return { headers, rows: all.slice(1) };
}

function headerMatches(header: string, alias: string): boolean {
	const h = header.trim().toLowerCase();
	return alias.endsWith("*") ? h.startsWith(alias.slice(0, -1)) : h === alias;
}

/** Which known format the headers belong to ("custom" when none). */
export function detectPreset(headers: string[]): PresetId {
	const has = (a: string): boolean => headers.some((h) => headerMatches(h, a));
	for (const p of PRESETS) {
		if (p.signatures.some((sig) => sig.every(has))) return p.id;
	}
	return "custom";
}

export function presetById(id: PresetId): Preset | undefined {
	return PRESETS.find((p) => p.id === id);
}

/** Map fields to columns using a preset's aliases (generic ones for "custom"). */
export function autoMapping(headers: string[], presetId: PresetId): Mapping {
	const aliases = presetById(presetId)?.aliases ?? GENERIC;
	const out = Object.fromEntries(CSV_FIELDS.map((f) => [f, -1])) as Mapping;
	const used = new Set<number>();
	for (const field of CSV_FIELDS) {
		for (const alias of aliases[field] ?? []) {
			const i = headers.findIndex((h, idx) => !used.has(idx) && headerMatches(h, alias));
			if (i >= 0) {
				out[field] = i;
				used.add(i);
				break;
			}
		}
	}
	return out;
}

/** One CSV row read through a mapping, cleaned up. */
export interface RowFields {
	line: number;
	id: string;
	name: string;
	set: string;
	setCode: string;
	number: string;
	variantText: string;
	lang: string;
	qty: number;
	price?: number;
	/** Currency of `price`: the file's column, the price's symbol, or the format default. */
	currency?: string;
	condition: string;
	grade: string;
	note: string;
	category: string;
}

const LANG_NAMES: Record<string, string> = {
	english: "EN",
	french: "FR",
	german: "DE",
	spanish: "ES",
	italian: "IT",
	portuguese: "PT",
	"brazilian portuguese": "PT-BR",
	dutch: "NL",
	polish: "PL",
	russian: "RU",
	japanese: "JA",
	korean: "KO",
	"simplified chinese": "ZH-CN",
	"s-chinese": "ZH-CN",
	"traditional chinese": "ZH-TW",
	"t-chinese": "ZH-TW",
	chinese: "ZH-TW",
	indonesian: "ID",
	thai: "TH",
	jp: "JA",
};
/** Cardmarket's numeric language ids. */
const CM_LANG_IDS: Record<string, string> = {
	"1": "EN",
	"2": "FR",
	"3": "DE",
	"4": "ES",
	"5": "IT",
	"6": "ZH-CN",
	"7": "JA",
	"8": "PT",
	"9": "RU",
	"10": "KO",
	"11": "ZH-TW",
};

function langLabel(raw: string, fallback: string): string {
	const t = raw.trim();
	if (!t) return fallback;
	const lc = t.toLowerCase();
	return LANG_NAMES[lc] ?? CM_LANG_IDS[lc] ?? t.toUpperCase();
}

const yes = (v: string): boolean => /^(y|yes|true|1|x|✓)$/i.test(v.trim());

/** "021/182" → "021", "#21" → "21", "TG01/TG30" → "TG01". */
export function cleanNumber(raw: string): string {
	const t = raw.trim().replace(/^#/, "");
	const m = t.match(/^([A-Za-z]*\d+[A-Za-z]?)\s*\/\s*[A-Za-z]*\d+$/);
	return (m ? m[1] : t).trim();
}

/**
 * TCGplayer-style product names carry the number: "Charizard ex - 199/165".
 * Returns the bare name and that number.
 */
export function splitProductName(raw: string): { name: string; number?: string } {
	const t = raw.trim();
	const m = t.match(/^(.*?)\s+-\s+([A-Za-z]*\d+[A-Za-z]?)(?:\s*\/\s*[A-Za-z]*\d+)?\s*$/);
	if (m) return { name: m[1].trim(), number: m[2] };
	return { name: t };
}

/**
 * "Near Mint Holofoil" (TCGplayer) → condition NM + printing "Holofoil";
 * plain codes / names → condition only.
 */
export function splitConditionText(raw: string): { condition?: string; printing: string } {
	const t = raw.trim();
	const direct = parseCondition(t);
	if (direct) return { condition: direct, printing: "" };
	const m = t.match(
		/^(near mint|lightly played|light played|moderately played|heavily played|damaged|mint|excellent|good|played|poor)\b\s*(.*)$/i
	);
	if (m) return { condition: parseCondition(m[1]), printing: m[2].trim() };
	return { printing: "" };
}

/** Read one row through the mapping. */
export function readRow(
	cells: string[],
	line: number,
	map: Mapping,
	presetId: PresetId,
	defaultLang: string
): RowFields {
	const get = (f: CsvField): string => (map[f] >= 0 ? (cells[map[f]] ?? "").trim() : "");
	const preset = presetById(presetId);
	const exact = !!preset?.exact;

	let name = get("name");
	let number = cleanNumber(get("number"));
	if (!exact) {
		const split = splitProductName(name);
		name = split.name;
		if (!number && split.number) number = split.number;
	}

	// Condition, and a printing hidden in TCGplayer condition text.
	const cond = splitConditionText(get("condition"));
	let variantText = get("variant");
	if (!exact) {
		const flags: string[] = [];
		if (yes(get("firstEd"))) flags.push("1st edition");
		if (yes(get("reverseHolo"))) flags.push("reverse");
		else if (yes(get("foil"))) flags.push("holo");
		if (!variantText && flags.length) variantText = flags.join(" ");
		if (!variantText && cond.printing) variantText = cond.printing;
		if (/^(normal|non-?foil|regular|unlimited)$/i.test(variantText)) variantText = "normal";
	}

	// Grade: "PSA 10", or company + number in two columns; "Ungraded" = none.
	let grade = get("grade");
	if (/^(ungraded|raw|none|n\/a|-|0)$/i.test(grade)) grade = "";
	const company = get("gradingCompany");
	if (grade && company && /^\d/.test(grade)) grade = `${company} ${grade}`;

	const qtyRaw = get("qty").replace(/[^0-9]/g, "");
	const qty = qtyRaw ? Number.parseInt(qtyRaw, 10) : 1;

	return {
		line,
		id: get("id"),
		name,
		set: get("set"),
		setCode: get("setCode"),
		number,
		variantText,
		lang: langLabel(get("lang"), preset?.defaultLang ?? defaultLang),
		qty: Number.isFinite(qty) && qty > 0 ? qty : 1,
		price: parseMoney(get("price")),
		currency:
			get("currency").toUpperCase() ||
			currencyFromText(get("price")) ||
			preset?.currency,
		condition: normalizeCondition(cond.condition),
		grade: normalizeGrade(grade),
		note: get("note"),
		category: get("category"),
	};
}

/** "$1,240.00", "1.240,00 €", "12.5" → number; blank/text → undefined. */
export function parseMoney(raw: string): number | undefined {
	let t = raw.replace(/[^\d.,-]/g, "");
	if (!t) return undefined;
	if (t.includes(",") && t.includes(".")) {
		// Whichever comes last is the decimal separator.
		t = t.lastIndexOf(",") > t.lastIndexOf(".") ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
	} else if (t.includes(",")) {
		t = /,\d{1,2}$/.test(t) ? t.replace(",", ".") : t.replace(/,/g, "");
	}
	const n = Number.parseFloat(t);
	return Number.isFinite(n) ? n : undefined;
}

export type ResolveMethod = "id" | "manual-id" | "set+number" | "name+set";

export interface ResolvedRow {
	fields: RowFields;
	method: ResolveMethod;
	card?: TcgdexCardFull;
	/** TCGdex language used for the lookup. */
	lang: string;
}

export interface UnresolvedRow {
	fields: RowFields;
	reason: string;
}

export interface SkippedRow {
	line: number;
	reason: string;
}

export interface ResolveResult {
	resolved: ResolvedRow[];
	unresolved: UnresolvedRow[];
	skipped: SkippedRow[];
}

/**
 * Reads a CSV through a mapping and resolves each row to a TCGdex card:
 * by id, then set code (or set name) + number, then name + set. Building the
 * table entries (which writes the meta cache) happens only on import.
 */
export class CsvImportService {
	private plugin: PokemonCollectionPlugin;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
	}

	async resolveAll(
		table: CsvTable,
		map: Mapping,
		presetId: PresetId,
		onProgress?: (done: number, total: number) => void
	): Promise<ResolveResult> {
		const defaultLang = (this.plugin.settings.preferredLanguage || "en").toUpperCase();
		const result: ResolveResult = { resolved: [], unresolved: [], skipped: [] };
		const rows = table.rows.map((cells, i) => readRow(cells, i + 2, map, presetId, defaultLang));

		// Set names need the English set list (Collectr/TCGplayer have no codes).
		try {
			await this.plugin.api.getSets("en");
		} catch {
			/* offline: stale index */
		}

		let done = 0;
		let next = 0;
		const out: (ResolvedRow | UnresolvedRow | SkippedRow)[] = new Array(rows.length);
		const worker = async (): Promise<void> => {
			while (next < rows.length) {
				const i = next++;
				out[i] = await this.resolveRow(rows[i], presetId);
				onProgress?.(++done, rows.length);
			}
		};
		await Promise.all(Array.from({ length: Math.min(4, rows.length) }, worker));

		for (const r of out) {
			if ("method" in r) result.resolved.push(r);
			else if ("fields" in r) result.unresolved.push(r);
			else result.skipped.push(r);
		}
		return result;
	}

	private async resolveRow(
		f: RowFields,
		presetId: PresetId
	): Promise<ResolvedRow | UnresolvedRow | SkippedRow> {
		if (f.category && !/pok[eé]mon/i.test(f.category)) {
			return { line: f.line, reason: `not a Pokémon card (${f.category})` };
		}
		if (!f.id && !f.name && !(f.setCode && f.number)) {
			return { line: f.line, reason: "empty row (no id, name or set + number)" };
		}
		// Ids are per language (Japanese "SV10-021"); English for app exports.
		const lang = presetById(presetId)?.exact ? f.lang.toLowerCase() || "en" : "en";
		const api = this.plugin.api;

		try {
			// 1. TCGdex id (our own export). Hand-made cards keep their id.
			if (f.id) {
				if (f.id.startsWith("manual-")) return { fields: f, method: "manual-id", lang };
				const card = await api.getCard(f.id, lang);
				if (card) return { fields: f, method: "id", card, lang };
			}

			// 2. Set code + number, or a set name mapped to its id + number.
			if (f.number && (f.setCode || f.set)) {
				let cards = f.setCode
					? (await api.findCardByCodeNumber(f.setCode, f.number, lang, true)).cards
					: [];
				if (!cards.length && f.set) {
					const setId = this.findSetId(f.set);
					if (setId) cards = (await api.findCardsInSet(setId, f.number, lang)).cards;
				}
				const brief = pickByName(cards, f.name);
				if (brief) {
					const card = await api.getCard(brief.id, lang);
					if (card) return { fields: f, method: "set+number", card, lang };
				}
			}

			// 3. Name (+ set when known).
			if (f.name) {
				const setId = f.set ? this.findSetId(f.set) : undefined;
				let briefs = await api.searchCards({ name: f.name, set: setId }, lang);
				if (f.number) briefs = briefs.filter((b) => sameNumber(b.localId, f.number));
				const exact = briefs.filter((b) => b.name.toLowerCase() === f.name.toLowerCase());
				const pool = exact.length ? exact : briefs;
				if (pool.length === 1) {
					const card = await api.getCard(pool[0].id, lang);
					if (card) return { fields: f, method: "name+set", card, lang };
				}
				if (pool.length > 1) {
					return {
						fields: f,
						reason: `ambiguous: ${pool.length} cards named “${f.name}”${f.set ? "" : " (no set)"}`,
					};
				}
			}
		} catch (err) {
			console.error("[pokemon-collection] CSV row failed", f.line, err);
			return { fields: f, reason: "network error" };
		}

		const where = [f.set || f.setCode, f.number && `#${f.number}`].filter(Boolean).join(" ");
		return {
			fields: f,
			reason: f.set && !this.findSetId(f.set) && !f.setCode
				? `unknown set “${f.set}”`
				: `no TCGdex card found${where ? ` for ${where}` : ""}`,
		};
	}

	/**
	 * Set id for an English set name, tolerant of app prefixes and
	 * punctuation: "SV10: Destined Rivals", "Scarlet & Violet—Destined Rivals".
	 */
	findSetId(setName: string): string | undefined {
		const sets = this.plugin.setIndex.allSets("en");
		const norm = (s: string): string =>
			s
				.toLowerCase()
				.replace(/&/g, " and ")
				.replace(/[^a-z0-9]+/g, " ")
				.trim();
		const target = norm(setName);
		const bare = norm(setName.replace(/^[^:]*:\s*/, ""));
		const code = setName.match(/^\s*([A-Za-z0-9.]+)\s*:/)?.[1]?.toLowerCase();

		const exact = sets.find((s) => norm(s.name) === target || norm(s.name) === bare);
		if (exact) return exact.id;
		if (code) {
			const byCode = sets.find(
				(s) => s.id.toLowerCase() === code || s.abbreviation?.toLowerCase() === code
			);
			if (byCode) return byCode.id;
		}
		// Longest set name contained in the given one ("… Destined Rivals").
		const contained = sets
			.filter((s) => norm(s.name).length > 3 && ` ${target} `.includes(` ${norm(s.name)} `))
			.sort((a, b) => b.name.length - a.name.length)[0];
		return contained?.id;
	}

	// --- building entries (on import) -----------------------------------

	/** Table entry for a resolved row (writes the meta cache). */
	async entryFor(r: ResolvedRow, presetId: PresetId): Promise<CollectionEntry> {
		const f = r.fields;
		const md = this.plugin.markdown;
		const exact = !!presetById(presetId)?.exact;

		if (r.method === "manual-id" || !r.card) return this.manualEntry(f, presetId, f.id || undefined);

		const card = r.card;
		const variant = exact && f.variantText ? f.variantText : appVariant(card, f.variantText);
		// Own export: keep its price; other apps: the active price source.
		const price = exact
			? f.price
			: this.plugin.price.rowPrice(this.plugin.price.priceFor(card, variant), f.condition, f.grade);
		const built = await buildEntryFromCard(
			this.plugin,
			card,
			variant,
			r.lang,
			f.qty,
			price,
			f.lang,
			{ condition: f.condition, grade: f.grade }
		);
		if (!exact) return built;
		// 1:1 restore: the table's own visible values win over TCGdex's.
		return {
			...built,
			name: f.name || built.name,
			setName: f.set || built.setName,
			number: f.number || built.number,
			language: f.lang || built.language,
			price: f.price,
			currency: f.price !== undefined ? f.currency : undefined,
			key: md.keyOf(card.id, variant, f.condition, f.grade),
		};
	}

	/**
	 * A hand-made card (like "Add card manually") for an unresolved row.
	 * `keepId` keeps the row's own id (1:1 restore). The CSV price keeps its
	 * own currency (USD for Collectr/TCGplayer, EUR for Cardmarket), so it is
	 * never mixed with prices in the other currency.
	 */
	async manualEntry(f: RowFields, _presetId: PresetId, keepId?: string): Promise<CollectionEntry> {
		const md = this.plugin.markdown;
		const currency = f.currency ?? this.plugin.price.currency;
		const variant = (f.variantText || "normal").replace(/[|:]/g, " ").trim() || "normal";
		const id = keepId ?? `manual-${slug(f.set)}-${slug(f.name)}-${slug(f.number) || "x"}`;
		const printing = md.printingKey({ id, variant });
		const prev = this.plugin.cache.getMeta(printing);
		if (!prev) {
			const now = new Date().toISOString();
			await this.plugin.cache.putMeta(printing, {
				id,
				name: f.name,
				setName: f.set,
				setCode: f.setCode,
				marketPrice: f.grade ? undefined : f.price,
				currency,
				cardmarketUrl: cardmarketUrl(f.set, f.name),
				dateAdded: now,
			});
		}
		return {
			id,
			name: f.name,
			setName: f.set,
			number: f.number,
			variant,
			language: f.lang,
			condition: f.condition,
			grade: f.grade || undefined,
			quantity: f.qty,
			price: f.price,
			currency: f.price !== undefined ? currency : undefined,
			key: md.keyOf(id, variant, f.condition, f.grade),
		};
	}
}

/**
 * Variant from an app's printing name. Apps call the standard printing of
 * a rare "Holofoil" even when TCGdex lists it as the card's only (normal)
 * printing, so a name the card doesn't have falls back to its default
 * printing — except reverse holo, which must exist to be chosen.
 */
function appVariant(card: TcgdexCardFull, text: string): string {
	const v = resolveVariant(card, text);
	const options = variantOptions(card);
	if (options.some((o) => o.value === v)) return v;
	if (baseType(text) === "reverse") return v; // keep as custom: not a known printing
	return defaultVariantForCard(card);
}

/** The brief whose name matches best (exact, then contained), else the only one. */
function pickByName<T extends { name: string }>(cards: T[], name: string): T | undefined {
	if (cards.length <= 1 || !name) return cards[0];
	const lc = name.toLowerCase();
	return (
		cards.find((c) => c.name.toLowerCase() === lc) ??
		cards.find((c) => c.name.toLowerCase().includes(lc) || lc.includes(c.name.toLowerCase())) ??
		cards[0]
	);
}
