import { MarkdownRenderChild } from "obsidian";
import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import { renderDashboard } from "./DashboardRenderer";

/**
 * An "Update prices" button that runs `run` once at a time, showing
 * "Updating…" while it works. Shared by the dashboard and the gallery.
 */
export function priceButton(
	parent: HTMLElement,
	tooltip: string,
	run: () => Promise<void>
): HTMLButtonElement {
	const btn = parent.createEl("button", { text: "Update prices", cls: "mod-cta" });
	btn.title = tooltip;
	btn.onclick = async () => {
		if (btn.disabled) return;
		btn.disabled = true;
		btn.setText("Updating…");
		try {
			await run();
		} catch (err) {
			console.error("[pokemon-collection] price update failed", err);
		} finally {
			btn.disabled = false;
			btn.setText("Update prices");
		}
	};
	return btn;
}

/**
 * Renders the dashboard inside a note via a ```pokemon-dashboard code block.
 * Extends MarkdownRenderChild so Chart.js instances are destroyed when the
 * block is re-rendered or the note closes.
 */
export class DashboardBlock extends MarkdownRenderChild {
	private plugin: PokemonCollectionPlugin;
	private charts: Chart[] = [];

	constructor(plugin: PokemonCollectionPlugin, containerEl: HTMLElement) {
		super(containerEl);
		this.plugin = plugin;
	}

	async render(): Promise<void> {
		this.destroyCharts();
		const wrap = this.containerEl.createDiv({
			cls: "pokemon-collection-dashboard-block",
		});

		const header = wrap.createDiv({ cls: "pokemon-collection-dash-header" });
		header.createEl("h2", { text: "Pokémon Collection Dashboard" });
		const actions = header.createDiv({ cls: "pokemon-collection-actions" });
		priceButton(actions, "Fetch current prices for every collection note (like \"Update all collection prices\")", async () => {
			await this.plugin.commands.updateAllPrices();
			await this.render();
		});
		const refreshBtn = actions.createEl("button", { text: "Refresh" });
		refreshBtn.title = "Redraw with the prices already in your notes";
		refreshBtn.onclick = () => void this.render();

		const body = wrap.createDiv();
		this.charts = await renderDashboard(this.plugin, body);
	}

	private destroyCharts(): void {
		for (const c of this.charts) c.destroy();
		this.charts = [];
		this.containerEl.empty();
	}

	onunload(): void {
		this.destroyCharts();
	}
}
