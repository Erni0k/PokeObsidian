import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import type {
	AggregatedCard,
	CollectionStats,
	ListTotals,
} from "../services/CollectionService";
import { lineChart, pieChart } from "./charts";
import { CardHistoryModal, currencySymbol, formatMove } from "./CardHistory";
import { changeOverDays, changeSincePrevious, PriceMove } from "../priceHistory";

/**
 * Renders the dashboard (statistics + charts) into `root` and returns the
 * created Chart instances so the caller can destroy them on re-render/unload.
 * Shared by the sidebar view and the `pokemon-dashboard` code block.
 */
export async function renderDashboard(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement
): Promise<Chart[]> {
	const charts: Chart[] = [];
	root.empty();
	root.addClass("pokemon-collection-dashboard");

	const all = await plugin.collection.scan();
	// Value and statistics count only cards you own; wishlist and trade
	// lists get their own tiles.
	const cards = all.filter((c) => c.list === "collection");
	const wishlist = plugin.collection.totals(all.filter((c) => c.list === "wishlist"));
	const trade = plugin.collection.totals(all.filter((c) => c.list === "trade"));
	const stats = plugin.collection.computeStats(cards);

	if (all.length === 0) {
		root.createEl("p", {
			cls: "pokemon-collection-hint",
			text:
				'No cards found. Add cards with the "Add card" command, and make sure your collection notes are in the configured folder.',
		});
		return charts;
	}

	const graded = plugin.collection.totals(cards.filter((c) => c.grade));
	renderStats(root, stats, wishlist, trade, graded);
	if (cards.length) renderCharts(plugin, root, cards, charts);
	return charts;
}

function renderStats(
	root: HTMLElement,
	stats: CollectionStats,
	wishlist: ListTotals,
	trade: ListTotals,
	graded: ListTotals
): void {
	const grid = root.createDiv({ cls: "pokemon-collection-stats" });
	const cur = stats.currency === "EUR" ? "€" : "";
	const money = (n: number) => `${cur}${n.toFixed(2)}`;
	const cardsWord = (n: number): string => `${n} card${n === 1 ? "" : "s"}`;

	const items: Array<[string, string]> = [
		["Total cards", String(stats.totalCards)],
		["Unique cards", String(stats.uniqueCards)],
		["Total value", money(stats.totalValue)],
		["Average card value", money(stats.averageValue)],
		[
			"Most expensive",
			stats.mostExpensive
				? `${stats.mostExpensive.name} (${money(
						stats.mostExpensive.unitPrice
					)})`
				: "—",
		],
		[
			"Largest set",
			stats.largestSet
				? `${stats.largestSet.name} (${stats.largestSet.count})`
				: "—",
		],
		["Sets owned", String(stats.setsOwned)],
	];
	if (graded.unique) {
		items.push(["Graded", `${cardsWord(graded.cards)} · ${money(graded.value)}`]);
	}
	if (wishlist.unique) {
		items.push(["Wishlist", `${cardsWord(wishlist.cards)} · cost ${money(wishlist.value)}`]);
	}
	if (trade.unique) {
		items.push(["Trade", `${cardsWord(trade.cards)} · value ${money(trade.value)}`]);
	}

	for (const [label, value] of items) {
		const cell = grid.createDiv({ cls: "pokemon-collection-stat" });
		cell.createEl("div", {
			cls: "pokemon-collection-stat-value",
			text: value,
		});
		cell.createEl("div", {
			cls: "pokemon-collection-stat-label",
			text: label,
		});
	}
}

function renderCharts(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	cards: AggregatedCard[],
	charts: Chart[]
): void {
	// Collection value over time (portfolio snapshots).
	const snapshots = plugin.cache.getSnapshots();
	if (snapshots.length > 0) {
		const canvas = chartBlock(root, "Collection value over time");
		charts.push(
			lineChart(
				canvas,
				snapshots.map((s) => new Date(s.timestamp).toLocaleDateString()),
				snapshots.map((s) => s.totalValue),
				"Total value"
			)
		);
	} else {
		hintBlock(
			root,
			"Collection value over time",
			'Run "Update all collection prices" to record value snapshots.'
		);
	}

	// Most valuable cards: top 10 with image, name, price and source note.
	const top = [...cards]
		.filter((c) => c.unitPrice > 0)
		.sort((a, b) => b.unitPrice - a.unitPrice)
		.slice(0, 10);
	if (top.length) {
		renderTopValuable(plugin, root, top);
	}

	// Biggest movers from the per-card price history.
	renderMovers(plugin, root, cards);

	// Collection by set (quantity).
	const bySet = groupSum(cards, (c) => c.setName);
	if (bySet.labels.length) {
		const canvas = chartBlock(root, "Collection by set");
		charts.push(pieChart(canvas, bySet.labels, bySet.values));
	}

	// Collection by rarity (quantity).
	const byRarity = groupSum(cards, (c) => c.rarity);
	if (byRarity.labels.length) {
		const canvas = chartBlock(root, "Collection by rarity");
		charts.push(pieChart(canvas, byRarity.labels, byRarity.values));
	}

	// Collection by condition (graded cards grouped by grading company).
	const byCondition = groupSum(cards, (c) =>
		c.grade ? `Graded (${c.grade.split(" ")[0]})` : c.condition || "NM"
	);
	if (byCondition.labels.length > 1) {
		const canvas = chartBlock(root, "Collection by condition");
		charts.push(pieChart(canvas, byCondition.labels, byCondition.values));
	}

	// Collection growth (cumulative unique cards by date added).
	const growth = cumulativeGrowth(cards);
	if (growth.labels.length) {
		const canvas = chartBlock(root, "Collection growth");
		charts.push(
			lineChart(canvas, growth.labels, growth.values, "Unique cards")
		);
	}
}

/** Top-10 most valuable cards as a visual list (image + name + price + note). */
function renderTopValuable(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	top: AggregatedCard[]
): void {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: "Most valuable cards" });
	const list = block.createDiv({ cls: "pokemon-collection-top-list" });
	const cur = plugin.price.currency === "EUR" ? "€" : "";

	for (const c of top) {
		const row = list.createDiv({ cls: "pokemon-collection-top-row" });

		const info = cardIdentity(plugin, row, c);
		noteLinks(plugin, info, c);

		row.createDiv({
			cls: "pokemon-collection-top-price",
			text: `${cur}${c.unitPrice.toFixed(2)}`,
		});
	}
}

/** Thumbnail + "Name · variant"; both open the card's price chart. */
function cardIdentity(
	plugin: PokemonCollectionPlugin,
	row: HTMLElement,
	c: AggregatedCard
): HTMLElement {
	const open = (): void => new CardHistoryModal(plugin, c.printingKey).open();
	const url = plugin.api.imageUrl(c.image, "low");
	if (url) {
		const img = row.createEl("img", { cls: "pokemon-collection-top-img is-clickable" });
		img.src = url;
		img.onclick = open;
	}
	const info = row.createDiv({ cls: "pokemon-collection-top-info" });
	const name = info.createEl("a", {
		cls: "pokemon-collection-top-name",
		text: [c.name, c.variant, stateLabel(c)].filter(Boolean).join(" · "),
		attr: { title: "Show price history" },
	});
	name.onclick = (ev) => {
		ev.preventDefault();
		open();
	};
	return info;
}

/** "PSA 10" for graded, "LP" for non-NM raw cards, "" for NM. */
function stateLabel(c: AggregatedCard): string {
	if (c.grade) return c.grade;
	return c.condition && c.condition !== "NM" ? c.condition : "";
}

/** "in Note A, Note B" links to the notes a card appears in. */
function noteLinks(
	plugin: PokemonCollectionPlugin,
	info: HTMLElement,
	c: AggregatedCard
): void {
	const notes = info.createDiv({ cls: "pokemon-collection-top-notes" });
	notes.createSpan({ text: "in " });
	c.notePaths.forEach((path, i) => {
		if (i > 0) notes.createSpan({ text: ", " });
		const link = notes.createEl("a", {
			text: path.replace(/\.md$/, "").split("/").pop() ?? path,
			cls: "pokemon-collection-note-link",
		});
		link.onclick = (ev) => {
			ev.preventDefault();
			void plugin.app.workspace.openLinkText(path, "", false);
		};
	});
}

type MoverPeriod = "last" | "30d";
type MoverSort = "eur" | "pct";
const MOVERS_SHOWN = 5;

/**
 * "Biggest movers": top gainers and losers among owned cards, since the
 * previous recorded price or over 30 days, ranked by € or %.
 */
function renderMovers(
	plugin: PokemonCollectionPlugin,
	root: HTMLElement,
	cards: AggregatedCard[]
): void {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	const head = block.createDiv({ cls: "pokemon-movers-head" });
	head.createEl("h3", { text: "Biggest movers" });
	const controls = head.createDiv({ cls: "pokemon-movers-controls" });
	const body = block.createDiv();
	let period: MoverPeriod = "last";
	let sort: MoverSort = "eur";

	const draw = (): void => {
		body.empty();
		const moves: { card: AggregatedCard; move: PriceMove }[] = [];
		for (const card of cards) {
			// Graded cards have manual prices only; history is the raw market.
			if (card.grade) continue;
			const points = plugin.cache.getCardHistory(card.printingKey);
			const move =
				period === "last" ? changeSincePrevious(points) : changeOverDays(points, 30);
			if (move && move.abs !== 0) moves.push({ card, move });
		}
		if (!moves.length) {
			body.createEl("p", {
				cls: "pokemon-collection-hint",
				text:
					period === "last"
						? 'No price changes recorded yet. Each card\'s price is tracked when you run "Update all collection prices".'
						: "No price changes in the last 30 days.",
			});
			return;
		}
		const score = (m: PriceMove): number => (sort === "eur" ? m.abs : m.pct);
		const up = moves
			.filter((m) => m.move.abs > 0)
			.sort((a, b) => score(b.move) - score(a.move))
			.slice(0, MOVERS_SHOWN);
		const down = moves
			.filter((m) => m.move.abs < 0)
			.sort((a, b) => score(a.move) - score(b.move))
			.slice(0, MOVERS_SHOWN);

		const cols = body.createDiv({ cls: "pokemon-movers-cols" });
		moverColumn(plugin, cols, "Gainers", up);
		moverColumn(plugin, cols, "Losers", down);
	};

	const segmented = <T extends string>(
		options: [T, string][],
		get: () => T,
		set: (v: T) => void
	): void => {
		const group = controls.createDiv({ cls: "pokemon-set-toggle" });
		const buttons = options.map(([value, label]) => {
			const b = group.createEl("button", { text: label });
			b.onclick = () => {
				set(value);
				sync();
				draw();
			};
			return b;
		});
		const sync = (): void =>
			buttons.forEach((x, i) => x.toggleClass("mod-cta", options[i][0] === get()));
		sync();
	};
	segmented<MoverPeriod>(
		[
			["last", "Last change"],
			["30d", "30 days"],
		],
		() => period,
		(v) => (period = v)
	);
	segmented<MoverSort>(
		[
			["eur", "€"],
			["pct", "%"],
		],
		() => sort,
		(v) => (sort = v)
	);
	draw();
}

function moverColumn(
	plugin: PokemonCollectionPlugin,
	parent: HTMLElement,
	title: string,
	items: { card: AggregatedCard; move: PriceMove }[]
): void {
	const col = parent.createDiv({ cls: "pokemon-movers-col" });
	col.createEl("h4", { text: title });
	if (!items.length) {
		col.createEl("p", { cls: "pokemon-collection-hint", text: "None." });
		return;
	}
	const cur = currencySymbol(plugin);
	const list = col.createDiv({ cls: "pokemon-collection-top-list" });
	for (const { card, move } of items) {
		const row = list.createDiv({ cls: "pokemon-collection-top-row" });
		const info = cardIdentity(plugin, row, card);
		noteLinks(plugin, info, card);
		const price = row.createDiv({ cls: "pokemon-movers-price" });
		price.createDiv({
			cls: "pokemon-collection-top-price",
			text: `${cur}${move.to.toFixed(2)}`,
		});
		price.createDiv({
			cls: `pokemon-move ${move.abs > 0 ? "pokemon-move-up" : "pokemon-move-down"}`,
			text: formatMove(move, cur),
			attr: {
				title: `from ${cur}${move.from.toFixed(2)} on ${new Date(move.since).toLocaleDateString()}`,
			},
		});
	}
}

function chartBlock(root: HTMLElement, title: string): HTMLCanvasElement {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: title });
	const wrap = block.createDiv({ cls: "pokemon-collection-chart-canvas" });
	return wrap.createEl("canvas");
}

function hintBlock(root: HTMLElement, title: string, text: string): void {
	const block = root.createDiv({ cls: "pokemon-collection-chart" });
	block.createEl("h3", { text: title });
	block.createEl("p", { cls: "pokemon-collection-hint", text });
}

function groupSum(
	cards: AggregatedCard[],
	keyFn: (c: AggregatedCard) => string
): { labels: string[]; values: number[] } {
	const map = new Map<string, number>();
	for (const c of cards) {
		const k = keyFn(c) || "Unknown";
		map.set(k, (map.get(k) ?? 0) + c.quantity);
	}
	const sorted = [...map.entries()].sort((a, b) => b[1] - a[1]);
	return {
		labels: sorted.map((e) => e[0]),
		values: sorted.map((e) => e[1]),
	};
}

function cumulativeGrowth(cards: AggregatedCard[]): {
	labels: string[];
	values: number[];
} {
	const dated = cards
		.filter((c) => c.dateAdded)
		.map((c) => new Date(c.dateAdded as string))
		.sort((a, b) => a.getTime() - b.getTime());
	const labels: string[] = [];
	const values: number[] = [];
	let running = 0;
	for (const d of dated) {
		running += 1;
		labels.push(d.toLocaleDateString());
		values.push(running);
	}
	return { labels, values };
}
