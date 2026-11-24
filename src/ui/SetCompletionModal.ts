import { Modal, Notice, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import { SUPPORTED_LANGUAGES } from "../settings";
import type { SetIndexEntry } from "../services/SetIndexService";
import { SetSuggest } from "./SetSuggest";

export interface SetChoice {
	setId: string;
	lang: string;
	name: string;
	code?: string;
}

/** Asks which set to track (autocomplete by name or code) and in which language. */
export class SetCompletionModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onChoose: (choice: SetChoice) => void;
	private lang: string;
	private text = "";
	private picked: SetIndexEntry | undefined;
	private suggest?: SetSuggest;

	constructor(plugin: PokemonCollectionPlugin, onChoose: (choice: SetChoice) => void) {
		super(plugin.app);
		this.plugin = plugin;
		this.onChoose = onChoose;
		this.lang = plugin.settings.preferredLanguage || "en";
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h3", { text: "Show set completion" });

		new Setting(contentEl)
			.setName("Set")
			.setDesc("Set name or code, e.g. Destined Rivals or DRI.")
			.addText((t) => {
				t.setPlaceholder("DRI").onChange((v) => {
					this.text = v;
					this.picked = undefined;
				});
				this.suggest = new SetSuggest(
					this.plugin,
					t.inputEl,
					() => this.lang,
					(entry) => {
						this.picked = entry;
						this.text = entry.name;
					}
				);
				t.inputEl.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.isComposing) {
						e.preventDefault();
						// Let a highlighted suggestion be picked first.
						window.setTimeout(() => void this.submit(), 0);
					}
				});
				window.setTimeout(() => t.inputEl.focus(), 0);
			});

		new Setting(contentEl).setName("Language").addDropdown((dd) => {
			for (const l of SUPPORTED_LANGUAGES) dd.addOption(l, l.toUpperCase());
			dd.setValue(this.lang).onChange((v) => {
				this.lang = v;
				this.picked = undefined;
				void this.suggest?.preload(v);
			});
		});

		new Setting(contentEl).addButton((b) =>
			b
				.setButtonText("Open")
				.setCta()
				.onClick(() => void this.submit())
		);
	}

	private async submit(): Promise<void> {
		let entry = this.picked;
		if (!entry) {
			const q = this.text.trim();
			if (!q) {
				new Notice("Pick a set first.");
				return;
			}
			const id = await this.plugin.setCompletion.resolveSetId(q, this.lang);
			const sets = this.plugin.setIndex.allSets(this.lang);
			entry =
				sets.find((s) => s.id === id) ??
				sets.find((s) => s.name.toLowerCase() === q.toLowerCase());
			if (!entry && id) entry = { id, name: q };
		}
		if (!entry) {
			new Notice(`Unknown set “${this.text.trim()}”.`);
			return;
		}
		this.close();
		this.onChoose({
			setId: entry.id,
			lang: this.lang,
			name: entry.name,
			code: entry.abbreviation,
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
