import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { SortDirection, SortField } from "../parser/MarkdownParser";

/** Map a header label (lowercased) to a sortable field. */
const FIELD_BY_HEADER: Record<string, SortField> = {
	card: "name",
	set: "setName",
	number: "number",
	variant: "variant",
	lang: "language",
	qty: "quantity",
	price: "price",
};

/** Fields that feel more natural descending on first click. */
const DESC_FIRST: ReadonlySet<SortField> = new Set([
	"price",
	"quantity",
	"number",
]);

/** Remembered sort per note path, so repeat clicks toggle direction. */
const sortState = new Map<string, { field: SortField; dir: SortDirection }>();

/**
 * Makes collection-table headers clickable in Reading view: clicking a column
 * sorts the underlying Markdown section (persisted to the note) and re-renders.
 */
export function registerTableSort(plugin: PokemonCollectionPlugin): void {
	plugin.registerMarkdownPostProcessor(
		(el: HTMLElement, ctx: MarkdownPostProcessorContext) => {
			el.querySelectorAll("table").forEach((table) => {
				enhanceTable(plugin, table, ctx.sourcePath);
			});
		}
	);
}

function enhanceTable(
	plugin: PokemonCollectionPlugin,
	table: HTMLTableElement,
	sourcePath: string
): void {
	const headers = Array.from(
		table.querySelectorAll<HTMLElement>("thead th")
	);
	if (!headers.length) return;

	const labels = headers.map((h) => (h.textContent ?? "").trim().toLowerCase());
	// Only act on our collection table (needs these identifying columns).
	const isCollection =
		labels.includes("card") &&
		labels.includes("variant") &&
		labels.includes("qty") &&
		labels.includes("price");
	if (!isCollection) return;

	const current = sortState.get(sourcePath);

	headers.forEach((th, i) => {
		const field = FIELD_BY_HEADER[labels[i]];
		if (!field) return;

		th.addClass("pokemon-sortable");
		if (current?.field === field) {
			th.createSpan({
				cls: "pokemon-sort-arrow",
				text: current.dir === "desc" ? " ▾" : " ▴",
			});
		}
		th.onClickEvent((ev) => {
			ev.preventDefault();
			void applySort(plugin, sourcePath, field);
		});
	});
}

async function applySort(
	plugin: PokemonCollectionPlugin,
	path: string,
	field: SortField
): Promise<void> {
	try {
		const file = plugin.app.vault.getAbstractFileByPath(path);
		if (!(file instanceof TFile)) return;

		const content = await plugin.app.vault.read(file);
		if (!plugin.markdown.hasSection(content)) return;

		const prev = sortState.get(path);
		const dir: SortDirection =
			prev && prev.field === field
				? prev.dir === "asc"
					? "desc"
					: "asc"
				: DESC_FIRST.has(field)
					? "desc"
					: "asc";

		const sorted = plugin.markdown.sortEntries(
			plugin.markdown.parseEntries(content),
			field,
			dir
		);
		const next = plugin.markdown.replaceSection(content, sorted);
		if (next && next !== content) {
			await plugin.app.vault.modify(file, next);
		}
		sortState.set(path, { field, dir });
	} catch (err) {
		console.error("[pokemon-collection] header sort failed", err);
		new Notice("Could not sort the table.");
	}
}
