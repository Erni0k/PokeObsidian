import { Plugin, WorkspaceLeaf } from "obsidian";
import {
	DEFAULT_SETTINGS,
	PokemonCollectionSettings,
	PokemonCollectionSettingTab,
} from "./settings";
import { ApiService } from "./services/ApiService";
import { CacheService } from "./services/CacheService";
import { PriceService } from "./services/PriceService";
import { CollectionService } from "./services/CollectionService";
import { MarkdownParser } from "./parser/MarkdownParser";
import { CommandController } from "./commands";
import { DASHBOARD_VIEW_TYPE, DashboardView } from "./ui/DashboardView";

export default class PokemonCollectionPlugin extends Plugin {
	settings!: PokemonCollectionSettings;

	cache!: CacheService;
	api!: ApiService;
	price!: PriceService;
	collection!: CollectionService;
	markdown!: MarkdownParser;

	commands!: CommandController;
	private autoUpdateHandle: number | null = null;

	async onload(): Promise<void> {
		await this.loadSettings();

		// Services (order matters: cache is a dependency of the others).
		this.cache = new CacheService(this);
		await this.cache.load();
		this.api = new ApiService(this);
		this.price = new PriceService(this);
		this.markdown = new MarkdownParser(this);
		this.collection = new CollectionService(this);

		// Commands.
		this.commands = new CommandController(this);
		this.commands.register();

		// Dashboard view.
		this.registerView(
			DASHBOARD_VIEW_TYPE,
			(leaf) => new DashboardView(leaf, this)
		);
		this.addRibbonIcon("layout-dashboard", "Pokémon Collection Dashboard", () =>
			this.activateDashboard()
		);
		this.addCommand({
			id: "open-dashboard",
			name: "Open Pokémon Collection Dashboard",
			callback: () => this.activateDashboard(),
		});

		this.addSettingTab(new PokemonCollectionSettingTab(this.app, this));

		this.restartAutoUpdate();
	}

	onunload(): void {
		if (this.autoUpdateHandle !== null) {
			window.clearInterval(this.autoUpdateHandle);
			this.autoUpdateHandle = null;
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}

	/** Open (or reveal) the dashboard in the right sidebar. */
	async activateDashboard(): Promise<void> {
		const { workspace } = this.app;
		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(DASHBOARD_VIEW_TYPE);
		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getRightLeaf(false);
			await leaf?.setViewState({
				type: DASHBOARD_VIEW_TYPE,
				active: true,
			});
		}
		if (leaf) workspace.revealLeaf(leaf);
	}

	/** (Re)start the optional auto price-update interval based on settings. */
	restartAutoUpdate(): void {
		if (this.autoUpdateHandle !== null) {
			window.clearInterval(this.autoUpdateHandle);
			this.autoUpdateHandle = null;
		}
		const minutes = this.settings.autoUpdateIntervalMinutes;
		if (minutes > 0) {
			this.autoUpdateHandle = window.setInterval(
				() => void this.commands.updateAllPrices(),
				minutes * 60 * 1000
			);
			this.registerInterval(this.autoUpdateHandle);
		}
	}
}
