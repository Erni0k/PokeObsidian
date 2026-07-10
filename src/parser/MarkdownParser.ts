import type PokemonCollectionPlugin from "../main";
import type { CardKey, CollectionEntry, Variant } from "../types";
import { cardmarketUrl } from "../cardmarket";

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
 * The visible, user-facing columns. The card's stable identity (`id:variant`)
 * is NOT a column — it is carried in an invisible HTML comment inside the Card
 * cell (`<!--k:id:variant-->`). An optional leading "Image" column may be added
 * based on settings. Parsing is header-driven, so tables with or without the
 * Image column (and legacy tables that still have an ID column) all round-trip.
 */
export const BASE_COLUMNS = [
	"Card",
	"Set",
	"Number",
	"Variant",
	"Lang",
	"Qty",
	"Price",
] as const;

/** Max width (px) for in-table thumbnails, so rows stay compact. */
const MAX_TABLE_IMG_WIDTH = 80;

/** Maps a (lowercased) header label to the entry field it feeds. */
type ColField =
	| "name"
	| "setName"
	| "number"
	| "variant"
	| "language"
	| "quantity"
	| "price"
	| "id"
	| "image";

const HEADER_FIELD: Record<string, ColField> = {
	image: "image",
	card: "name",
	set: "setName",
	number: "number",
	variant: "variant",
	lang: "language",
	qty: "quantity",
	price: "price",
	id: "id",
};

/** Matches the hidden identity comment inside a Card cell. */
const KEY_COMMENT = /<!--\s*k:(.+?)\s*-->/;

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
		const lines = block
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter((l) => l.startsWith("|"));
		if (!lines.length) return [];

		// Locate the header row and build a column-index -> field map from it.
		let colMap: (ColField | null)[] | null = null;
		let headerSeen = false;
		const entries: CollectionEntry[] = [];

		for (const line of lines) {
			const cells = this.splitRow(line);
			const lower = cells.map((c) => c.toLowerCase());

			if (!colMap) {
				if (lower.includes("card")) {
					colMap = lower.map((l) => HEADER_FIELD[l] ?? null);
					headerSeen = true;
				}
				continue;
			}
			// Skip the separator row that follows the header.
			if (cells.every((c) => /^:?-{2,}:?$/.test(c.replace(/\s/g, "")))) {
				continue;
			}
			const entry = this.rowToEntry(cells, colMap);
			if (entry) entries.push(entry);
		}

		return headerSeen ? entries : [];
	}

	/** Build an entry from split cells using the header-derived column map. */
	private rowToEntry(
		cells: string[],
		colMap: (ColField | null)[]
	): CollectionEntry | null {
		const get = (field: ColField): string => {
			const idx = colMap.indexOf(field);
			return idx >= 0 ? (cells[idx] ?? "") : "";
		};

		const rawName = get("name");
		const name = this.stripLink(rawName);

		// Identity: hidden key comment in the Card cell, else a legacy ID column,
		// else fall back to the cache by natural key, else a natural key.
		const variantCol = get("variant").trim() || "normal";
		let id = "";
		let variant = variantCol;

		const commentKey = rawName.match(KEY_COMMENT)?.[1]?.trim();
		const legacyId = get("id").trim();
		const rawKey = commentKey || (legacyId.includes(":") ? legacyId : "");
		if (rawKey) {
			const parsed = this.splitKey(rawKey);
			id = parsed.id;
			variant = parsed.variant;
		} else {
			id = this.resolveIdByNaturalKey(name, get("setName").trim(), variant);
		}

		if (!name && !id) return null;
		const key = id
			? this.keyOf(id, variant)
			: this.naturalKey(name, get("setName").trim(), variant);

		const quantity = Math.max(
			0,
			Number.parseInt(get("quantity").replace(/[^0-9]/g, "") || "0", 10) || 0
		);

		return {
			id,
			name: name.trim(),
			setName: get("setName").trim(),
			number: get("number").trim(),
			variant,
			language: get("language").trim() || this.defaultLang(),
			quantity,
			price: this.parsePrice(get("price")),
			key,
		};
	}

	/**
	 * Extract the identity key from a single table line (used by "update
	 * selected card" for the row under the cursor). Returns null if none.
	 */
	keyFromRow(line: string): string | null {
		const trimmed = line.trim();
		if (!trimmed.startsWith("|")) return null;
		const comment = trimmed.match(KEY_COMMENT);
		if (comment) return comment[1].trim();
		// Legacy: an id:variant cell.
		const cell = this.splitRow(trimmed).find((c) =>
			/^[A-Za-z0-9-]+:.+$/.test(c)
		);
		return cell ?? null;
	}

	/** Look up a card id in the meta cache by its visible natural fields. */
	private resolveIdByNaturalKey(
		name: string,
		setName: string,
		variant: string
	): string {
		const nName = name.trim().toLowerCase();
		const nSet = setName.trim().toLowerCase();
		for (const meta of Object.values(this.plugin.cache.getAllMeta())) {
			if (
				meta.name?.toLowerCase() === nName &&
				meta.setName?.toLowerCase() === nSet
			) {
				return meta.id;
			}
		}
		return "";
	}

	/** A stable key for rows whose TCGdex id could not be recovered. */
	private naturalKey(name: string, setName: string, variant: string): string {
		return `${setName}|${name}:${variant}`;
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

	/** Extract the display text from a Card cell (strips the key comment + link). */
	private stripLink(value: string): string {
		const noComment = value.replace(KEY_COMMENT, "").trim();
		const m = noComment.match(/^\[(.+?)\]\((?:.*?)\)$/);
		return m ? m[1] : noComment;
	}

	/**
	 * Render the Card cell: a Cardmarket link plus a hidden identity comment
	 * (`<!--k:id:variant-->`) that replaces the old visible ID column.
	 */
	private nameCell(e: CollectionEntry): string {
		const name = this.escape(e.name);
		const url =
			this.plugin.cache.getMeta(e.key)?.cardmarketUrl ??
			cardmarketUrl(e.setName, e.name);
		const link = e.name ? `[${name}](${url})` : name;
		return `${link}<!--k:${e.key}-->`;
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
