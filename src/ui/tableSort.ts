import { MarkdownPostProcessorContext, Notice, TFile } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { SortDirection, SortField } from "../parser/MarkdownParser";
import { isStale, timeAgo } from "../currency";

/** Map a header label (lowercased) to a sortable field. */
const FIELD_BY_HEADER: Record<string, SortField> = {
	card: "name",
	set: "setName",
	number: "number",
	variant: "variant",
	lang: "language",
	cond: "condition",
	condition: "condition",
	grade: "grade",
	qty: "quantity",
	price: "price",
};

/** Fields that feel more natural descending on first click. */
const DESC_FIRST: ReadonlySet<SortField> = new Set([
	"price",
	"quantity",
	"number",
	"grade",
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

	void annotatePrices(plugin, table, sourcePath, labels);
}

/**
 * Price-cell tooltips in Reading view: "Cardmarket price · updated 3 days
 * ago". Stale prices (older than the setting) and prices in another currency
 * than the active source are highlighted. Rows are matched to the note's
 * parsed entries by position, checked against the card name.
 */
async function annotatePrices(
	plugin: PokemonCollectionPlugin,
	table: HTMLTableElement,
	sourcePath: string,
	labels: string[]
): Promise<void> {
	const priceIdx = labels.indexOf("price");
	const cardIdx = labels.indexOf("card");
	const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
	if (priceIdx < 0 || !(file instanceof TFile)) return;
	const entries = plugin.markdown.parseEntries(await plugin.app.vault.cachedRead(file));
	const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("tbody tr"));
	const days = plugin.settings.stalePriceDays;
	const cur = plugin.price.currency;

	rows.forEach((row, i) => {
		const e = entries[i];
		const cell = row.cells[priceIdx];
		if (!e || !cell || e.price === undefined) return;
		const shown = (row.cells[cardIdx]?.textContent ?? "").trim();
		if (shown && e.name && shown !== e.name) return; // table and note out of sync
		const parts: string[] = [];
		let flag = false;
		if (e.grade) {
			parts.push(`Manual price (graded ${e.grade})`);
		} else {
			const updated = plugin.cache.getMeta(plugin.markdown.printingKey(e))?.lastPriceUpdate;
			parts.push(`${plugin.price.sourceLabel} price`, updated ? `updated ${timeAgo(updated)}` : "never updated");
			if (isStale(updated, days)) flag = true;
		}
		if ((e.currency ?? cur) !== cur) {
			parts.push(`in ${e.currency} — run "Update all collection prices" to re-price in ${cur}`);
			flag = true;
		}
		cell.title = parts.join(" · ");
		cell.toggleClass("pokemon-price-stale", flag);
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

		const md = plugin.markdown;
		const sortText = (text: string): string =>
			md.replaceSection(text, md.sortEntries(md.parseEntries(text), field, dir)) ?? text;
		if (sortText(content) !== content) {
			await plugin.app.vault.process(file, sortText);
		}
		sortState.set(path, { field, dir });
	} catch (err) {
		console.error("[pokemon-collection] header sort failed", err);
		new Notice("Could not sort the table.");
	}
}
