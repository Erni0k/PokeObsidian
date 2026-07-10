import type PokemonCollectionPlugin from "../main";
import type { CardKey, CollectionEntry, Variant } from "../types";
import { cardmarketSearchUrl } from "../cardmarket";

/** Fields a collection table can be sorted by. */
export type SortField =
	| "name"
	| "setName"
	| "number"
	| "variant"
	| "language"
	| "quantity"
	| "price";

export type SortDirection = "asc" | "desc";

/** Human labels for the sortable fields. */
export const SORT_FIELD_LABELS: Record<SortField, string> = {
	name: "Card name",
	setName: "Set",
	number: "Number",
	variant: "Variant",
	language: "Language",
	quantity: "Quantity",
	price: "Price",
};

export const START_MARKER = "<!-- pokemon-collection:start -->";
export const END_MARKER = "<!-- pokemon-collection:end -->";

/**
 * The stable, always-present columns (identity + user-editable fields). An
 * optional leading "Image" column may be added based on settings; parsing is
 * offset-tolerant so tables with or without it both round-trip.
 */
export const BASE_COLUMNS = [
	"Card",
	"Set",
	"Number",
	"Variant",
	"Lang",
	"Qty",
	"Price",
	"ID",
] as const;

const BASE_COL_COUNT = BASE_COLUMNS.length;
/** Max width (px) for in-table thumbnails, so rows stay compact. */
const MAX_TABLE_IMG_WIDTH = 80;

/** Region of a note occupied by a collection section (character offsets). */
export interface SectionRegion {
	/** Offset of the START marker. */
	start: number;
	/** Offset just past the END marker. */
	end: number;
	/** Raw text between (and excluding) the markers. */
	inner: string;
}

/**
 * Reads and writes the Markdown collection table. The table is the source of
 * truth; this module never mutates anything outside the marked section.
 */
export class MarkdownParser {
	private plugin: PokemonCollectionPlugin;

	constructor(plugin: PokemonCollectionPlugin) {
		this.plugin = plugin;
	}

	// --- key + value formatting --------------------------------------------

	keyOf(id: string, variant: Variant): CardKey {
		return `${id}:${variant}`;
	}

	/** Split a `id:variant` key on the FIRST colon (variant may contain colons). */
	splitKey(key: CardKey): { id: string; variant: string } {
		const idx = key.indexOf(":");
		if (idx < 0) return { id: key, variant: "normal" };
		return { id: key.slice(0, idx), variant: key.slice(idx + 1) };
	}

	formatPrice(price: number | undefined): string {
		if (price === undefined || !Number.isFinite(price)) return "";
		return `€${price.toFixed(2)}`;
	}

	parsePrice(text: string): number | undefined {
		const cleaned = text.replace(/[^0-9.,-]/g, "").replace(",", ".");
		if (!cleaned) return undefined;
		const n = Number.parseFloat(cleaned);
		return Number.isFinite(n) ? n : undefined;
	}

	// --- section discovery --------------------------------------------------

	findSection(content: string): SectionRegion | null {
		const start = content.indexOf(START_MARKER);
		if (start < 0) return null;
		const endMarker = content.indexOf(END_MARKER, start + START_MARKER.length);
		if (endMarker < 0) return null;
		const end = endMarker + END_MARKER.length;
		const inner = content.slice(start + START_MARKER.length, endMarker);
		return { start, end, inner };
	}

	hasSection(content: string): boolean {
		return this.findSection(content) !== null;
	}

	// --- parsing ------------------------------------------------------------

	/** Parse all entries from a note's collection section (empty if none). */
	parseEntries(content: string): CollectionEntry[] {
		const section = this.findSection(content);
		if (!section) return [];
		return this.parseRows(section.inner);
	}

	private parseRows(block: string): CollectionEntry[] {
		const entries: CollectionEntry[] = [];
		for (const line of block.split(/\r?\n/)) {
			const entry = this.parseRow(line);
			if (entry) entries.push(entry);
		}
		return entries;
	}

	/**
	 * Parse a single Markdown table line into an entry, or null if the line is
	 * not a data row (blank, header, separator, or malformed). Public so the
	 * "update selected card" command can identify the row under the cursor.
	 */
	parseRow(line: string): CollectionEntry | null {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) return null;
		const cells = this.splitRow(trimmed);
		if (cells.length < BASE_COL_COUNT) return null;
		// Tolerate an optional leading "Image" column (or other extras): the
		// stable columns are always the last BASE_COL_COUNT cells.
		const off = cells.length - BASE_COL_COUNT;

		// Skip header + separator rows.
		if (cells[off]?.toLowerCase() === "card") return null;
		if (/^-{2,}$/.test(cells[off]?.replace(/\s/g, "") ?? "")) return null;

		const nameCell = cells[off];
		const setName = cells[off + 1];
		const number = cells[off + 2];
		const variant = cells[off + 3];
		const language = cells[off + 4];
		const qtyStr = cells[off + 5];
		const priceStr = cells[off + 6];
		const idCell = cells[off + 7];

		const name = this.stripLink(nameCell ?? "");

		let id = idCell?.trim() ?? "";
		let variantResolved = variant?.trim() || "normal";
		// The ID column is authoritative for identity when present.
		if (id.includes(":")) {
			const parsed = this.splitKey(id);
			id = parsed.id;
			variantResolved = parsed.variant;
		}
		if (!id) return null;
		const key = this.keyOf(id, variantResolved);

		const quantity = Math.max(
			0,
			Number.parseInt(qtyStr?.replace(/[^0-9]/g, "") || "0", 10) || 0
		);

		return {
			id,
			name: name.trim(),
			setName: setName?.trim() ?? "",
			number: number?.trim() ?? "",
			variant: variantResolved,
			language: language?.trim() || this.defaultLang(),
			quantity,
			price: this.parsePrice(priceStr ?? ""),
			key,
		};
	}

	/** Split a Markdown table row into trimmed cell values (handles `\|`). */
	private splitRow(row: string): string[] {
		const parts = row.split(/(?<!\\)\|/);
		// Drop the empty leading/trailing cells produced by the outer pipes.
		if (parts.length && parts[0].trim() === "") parts.shift();
		if (parts.length && parts[parts.length - 1].trim() === "") parts.pop();
		return parts.map((c) => c.replace(/\\\|/g, "|").trim());
	}

	// --- rendering ----------------------------------------------------------

	private escape(value: string): string {
		return value.replace(/\|/g, "\\|");
	}

	/** Extract the display text from a `[text](url)` link, else return as-is. */
	private stripLink(value: string): string {
		const m = value.trim().match(/^\[(.+?)\]\((?:.*?)\)$/);
		return m ? m[1] : value.trim();
	}

	/** Render the card name as a Markdown link to Cardmarket. */
	private nameCell(e: CollectionEntry): string {
		const name = this.escape(e.name);
		if (!e.name) return name;
		const url =
			this.plugin.cache.getMeta(e.key)?.cardmarketUrl ??
			cardmarketSearchUrl(e.name);
		return `[${name}](${url})`;
	}

	/** Whether the optional leading Image column is enabled. */
	private imageColumnEnabled(): boolean {
		return this.plugin.settings.imageColumn;
	}

	/** Column headers, optionally prefixed with "Image". */
	private columns(): string[] {
		return this.imageColumnEnabled()
			? ["Image", ...BASE_COLUMNS]
			: [...BASE_COLUMNS];
	}

	/**
	 * A sized, table-safe thumbnail. We use an HTML <img> with an explicit
	 * width: it renders reliably in Obsidian tables (unlike the escaped-pipe
	 * Markdown width syntax) and contains no pipe, so it never splits the cell
	 * or our own row parser.
	 */
	private imageCell(e: CollectionEntry): string {
		const base = this.plugin.cache.getMeta(e.key)?.image;
		const url = this.plugin.api.imageUrl(base, "low");
		if (!url) return "";
		const width = Math.min(this.plugin.settings.imageSize, MAX_TABLE_IMG_WIDTH);
		const alt = e.name.replace(/["|]/g, " ");
		return `<img src="${url}" width="${width}" alt="${alt}">`;
	}

	private renderRow(e: CollectionEntry): string {
		const baseCells = [
			this.nameCell(e),
			this.escape(e.setName),
			this.escape(e.number),
			this.escape(String(e.variant)),
			this.escape(e.language),
			String(e.quantity),
			this.formatPrice(e.price),
			this.escape(e.key),
		];
		const cells = this.imageColumnEnabled()
			? [this.imageCell(e), ...baseCells]
			: baseCells;
		return `| ${cells.join(" | ")} |`;
	}

	/** Full section text (markers + table) for the given entries. */
	renderSection(entries: CollectionEntry[]): string {
		const cols = this.columns();
		const header = `| ${cols.join(" | ")} |`;
		const sep = `| ${cols.map(() => "---").join(" | ")} |`;
		const rows = entries.map((e) => this.renderRow(e));
		const table = [header, sep, ...rows].join("\n");
		return `${START_MARKER}\n${table}\n${END_MARKER}`;
	}

	// --- mutation helpers ---------------------------------------------------

	/** Return a new array of entries sorted by `field` in `dir` order. */
	sortEntries(
		entries: CollectionEntry[],
		field: SortField,
		dir: SortDirection
	): CollectionEntry[] {
		const factor = dir === "desc" ? -1 : 1;
		const sorted = entries.slice().sort((a, b) => {
			let r: number;
			switch (field) {
				case "quantity":
					r = a.quantity - b.quantity;
					break;
				case "price":
					r = (a.price ?? 0) - (b.price ?? 0);
					break;
				case "number":
					// Numeric-aware compare so "9" < "10" and "SV107" sorts sanely.
					r = a.number.localeCompare(b.number, undefined, {
						numeric: true,
						sensitivity: "base",
					});
					break;
				default:
					r = String(a[field]).localeCompare(String(b[field]), undefined, {
						sensitivity: "base",
					});
			}
			return r * factor;
		});
		return sorted;
	}

	/**
	 * Merge `entry` into the list: if a row with the same key exists, add
	 * `addQty` to its quantity (and refresh its price if provided); otherwise
	 * append. Returns a new array.
	 */
	upsert(
		entries: CollectionEntry[],
		entry: CollectionEntry,
		addQty: number
	): CollectionEntry[] {
		const next = entries.slice();
		const idx = next.findIndex((e) => e.key === entry.key);
		if (idx >= 0) {
			const existing = next[idx];
			next[idx] = {
				...existing,
				quantity: existing.quantity + addQty,
				price: entry.price ?? existing.price,
			};
		} else {
			next.push({ ...entry, quantity: addQty });
		}
		return next;
	}

	/**
	 * Replace the collection section in `content` with a table for `entries`.
	 * Requires an existing section; returns null if none is present so the
	 * caller can decide where to insert a fresh one.
	 */
	replaceSection(
		content: string,
		entries: CollectionEntry[]
	): string | null {
		const section = this.findSection(content);
		if (!section) return null;
		const rendered = this.renderSection(entries);
		return content.slice(0, section.start) + rendered + content.slice(section.end);
	}

	private defaultLang(): string {
		return (this.plugin.settings.preferredLanguage || "en").toUpperCase();
	}
}
