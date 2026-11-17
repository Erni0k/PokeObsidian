import { Modal, Setting } from "obsidian";
import type PokemonCollectionPlugin from "../main";
import type { CollectionEntry } from "../types";
import { CardmarketProvider } from "../services/PriceService";
import { buildEntryFromCard, defaultVariantForCard } from "./buildEntry";

export interface BulkItem {
	entry: CollectionEntry;
	qty: number;
}

export type BulkResolvedCallback = (items: BulkItem[]) => void | Promise<void>;

/**
 * Bulk importer: paste one card per line as `CODE NUMBER [xQTY] [variant]`
 * (e.g. `DRI 062 x2 reverse`). Each line is resolved against TCGdex; resolved
 * cards are inserted together and unresolved lines are reported.
 */
export class BulkAddModal extends Modal {
	private plugin: PokemonCollectionPlugin;
	private onResolved: BulkResolvedCallback;
	private text = "";
	private provider = new CardmarketProvider();

	constructor(plugin: PokemonCollectionPlugin, onResolved: BulkResolvedCallback) {
		super(plugin.app);
		this.plugin = plugin;
		this.onResolved = onResolved;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("pokemon-collection-modal");
		contentEl.createEl("h2", { text: "Bulk add cards" });
		contentEl.createEl("p", {
			cls: "pokemon-collection-hint",
			text: "One card per line: CODE NUMBER [xQTY] [variant]. e.g. DRI 062 x2 reverse",
		});

		const ta = contentEl.createEl("textarea", {
			cls: "pokemon-collection-bulk",
		});
		ta.rows = 8;
		ta.placeholder = "DRI 062 x2 reverse\nsv10-021\nPAF 091 holo";
		ta.addEventListener("input", () => (this.text = ta.value));

		const status = contentEl.createDiv({ cls: "pokemon-collection-hint" });

		new Setting(contentEl)
			.addButton((b) =>
				b
					.setButtonText("Add all")
					.setCta()
					.onClick(() => void this.process(status))
			)
			.addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private async process(status: HTMLElement): Promise<void> {
		const lang = this.plugin.settings.preferredLanguage || "en";
		const lines = this.text
			.split(/\r?\n/)
			.map((l) => l.trim())
			.filter(Boolean);
		if (!lines.length) return;

		const items: BulkItem[] = [];
		const failures: string[] = [];

		for (let i = 0; i < lines.length; i++) {
			status.setText(`Resolving ${i + 1}/${lines.length}…`);
			const parsed = this.parseLine(lines[i]);
			if (!parsed) {
				failures.push(`${lines[i]} — can't parse`);
				continue;
			}
			try {
				const item = await this.resolve(parsed, lang);
				if (item) items.push(item);
				else failures.push(`${lines[i]} — not found`);
			} catch {
				failures.push(`${lines[i]} — error`);
			}
		}

		if (items.length) await this.onResolved(items);

		status.empty();
		status.createEl("div", {
			text: `Added ${items.reduce((n, it) => n + it.qty, 0)} card(s) across ${
				items.length
			} line(s).`,
		});
		if (failures.length) {
			status.createEl("div", {
				text: `${failures.length} line(s) failed:`,
				cls: "pokemon-collection-error",
			});
			const ul = status.createEl("ul");
			for (const f of failures) ul.createEl("li", { text: f });
		}
	}

	/** Parse `CODE NUMBER [xQTY] [variant]` (also `CODE-NUMBER`). */
	private parseLine(
		line: string
	): { code: string; num: string; qty?: number; variant?: string } | null {
		const m = line.match(
			/^(\S+?)[-\s]+([A-Za-z]{0,3}\d{1,4}[A-Za-z]?)\b(.*)$/
		);
		if (!m) return null;
		const rest = m[3].trim();
		const qm = rest.match(/\bx(\d+)\b/i);
		const variant = rest.replace(/\bx\d+\b/i, "").trim();
		return {
			code: m[1],
			num: m[2],
			qty: qm ? Number.parseInt(qm[1], 10) : undefined,
			variant: variant || undefined,
		};
	}

	private async resolve(
		p: { code: string; num: string; qty?: number; variant?: string },
		lang: string
	): Promise<BulkItem | null> {
		const res = await this.plugin.api.findCardByCodeNumber(
			p.code,
			p.num,
			lang,
			true
		);
		if (!res.brief) return null;
		const card = await this.plugin.api.getCard(res.brief.id, lang);
		if (!card) return null;

		const variant = p.variant || defaultVariantForCard(card);
		const qty = p.qty && p.qty > 0 ? p.qty : this.plugin.settings.defaultQuantity;
		const price = this.provider.priceFor(card, variant);
		const entry = await buildEntryFromCard(
			this.plugin,
			card,
			variant,
			lang,
			qty,
			price
		);
		return { entry, qty };
	}
}
