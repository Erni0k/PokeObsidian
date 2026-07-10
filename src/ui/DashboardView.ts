import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Chart } from "chart.js/auto";
import type PokemonCollectionPlugin from "../main";
import { renderDashboard } from "./DashboardRenderer";

export const DASHBOARD_VIEW_TYPE = "pokemon-collection-dashboard";

/** Right-panel dashboard: statistics + Chart.js visualisations. */
export class DashboardView extends ItemView {
	private plugin: PokemonCollectionPlugin;
	private charts: Chart[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: PokemonCollectionPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return DASHBOARD_VIEW_TYPE;
	}

	getDisplayText(): string {
		return "Pokémon Collection Dashboard";
	}

	getIcon(): string {
		return "layout-dashboard";
	}

	async onOpen(): Promise<void> {
		await this.refresh();
		// Refresh when this view regains focus.
		this.registerEvent(
			this.app.workspace.on("active-leaf-change", (leaf) => {
				if (leaf === this.leaf) void this.refresh();
			})
		);
	}

	async onClose(): Promise<void> {
		this.destroyCharts();
	}

	private destroyCharts(): void {
		for (const c of this.charts) c.destroy();
		this.charts = [];
	}

	async refresh(): Promise<void> {
		this.destroyCharts();
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();

		const header = root.createDiv({ cls: "pokemon-collection-dash-header" });
		header.createEl("h2", { text: "Pokémon Collection Dashboard" });
		const refreshBtn = header.createEl("button", { text: "Refresh" });
		refreshBtn.onclick = () => void this.refresh();

		const body = root.createDiv();
		this.charts = await renderDashboard(this.plugin, body);
	}
}
