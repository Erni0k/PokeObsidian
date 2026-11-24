/**
 * Card condition (raw cards) and professional grade (slabbed cards).
 * Both are part of a row's identity: `id:variant:cond[:grade]`.
 */

export const CONDITIONS = ["NM", "LP", "MP", "HP", "DMG"] as const;
export type Condition = (typeof CONDITIONS)[number];
export const DEFAULT_CONDITION: Condition = "NM";

export const CONDITION_LABELS: Record<Condition, string> = {
	NM: "Near Mint",
	LP: "Lightly Played",
	MP: "Moderately Played",
	HP: "Heavily Played",
	DMG: "Damaged",
};

/** Default price multipliers vs. the Cardmarket (near-mint) price. */
export const DEFAULT_CONDITION_MULTIPLIERS: Record<Condition, number> = {
	NM: 1,
	LP: 0.85,
	MP: 0.7,
	HP: 0.5,
	DMG: 0.3,
};

/** Synonyms, incl. Cardmarket's scale (MT/NM/EX/GD/LP/PL/PO), mapped to ours. */
const ALIASES: Record<string, Condition> = {
	nm: "NM",
	"near mint": "NM",
	m: "NM",
	mt: "NM",
	mint: "NM",
	lp: "LP",
	"lightly played": "LP",
	"light played": "LP",
	ex: "LP",
	excellent: "LP",
	mp: "MP",
	"moderately played": "MP",
	gd: "MP",
	good: "MP",
	hp: "HP",
	"heavily played": "HP",
	pl: "HP",
	played: "HP",
	dmg: "DMG",
	damaged: "DMG",
	po: "DMG",
	poor: "DMG",
};

/** A known condition for `text`, or undefined if it isn't one. */
export function parseCondition(text: string | undefined): Condition | undefined {
	if (!text) return undefined;
	return ALIASES[text.trim().toLowerCase().replace(/\s+/g, " ")];
}

/** Condition for `text`, falling back to NM for blank/unknown values. */
export function normalizeCondition(text: string | undefined): Condition {
	return parseCondition(text) ?? DEFAULT_CONDITION;
}

/**
 * Canonical grade text: "psa10" → "PSA 10", "cgc 9,5" → "CGC 9.5",
 * "BGS 9.5 black label" → "BGS 9.5 black label". Blank → "". Colons and
 * pipes are removed so the grade is safe in the key and the table.
 */
export function normalizeGrade(text: string | undefined): string {
	const t = (text ?? "").replace(/[:|]/g, " ").replace(/\s+/g, " ").trim();
	if (!t) return "";
	const m = t.match(/^([A-Za-z]+)\s*(\d{1,2}(?:[.,]\d)?)\s*(.*)$/);
	if (!m) return t;
	const [, company, num, rest] = m;
	return [company.toUpperCase(), num.replace(",", "."), rest].filter(Boolean).join(" ");
}

/** Sort rank: NM best (0) … DMG worst. Unknown sorts last. */
export function conditionRank(cond: string): number {
	const i = (CONDITIONS as readonly string[]).indexOf(cond);
	return i < 0 ? CONDITIONS.length : i;
}

/** Numeric grade for sorting ("PSA 10" → 10); ungraded → -1. */
export function gradeScore(grade: string | undefined): number {
	if (!grade) return -1;
	const m = grade.match(/(\d{1,2}(?:\.\d)?)/);
	return m ? Number.parseFloat(m[1]) : 0;
}

/**
 * Find condition / grade tokens in free text (bulk lines): "NM", "lp",
 * "PSA10", "CGC 9.5". Returns them plus the text with the tokens removed.
 */
export function extractConditionGrade(text: string): {
	condition?: Condition;
	grade?: string;
	rest: string;
} {
	let rest = ` ${text} `;
	let grade: string | undefined;
	const gm = rest.match(
		/\s(PSA|CGC|BGS|SGC|TAG|ACE|AGS|PCA|BECKETT|GMA|MNT)\s?(\d{1,2}(?:[.,]\d)?)(?=\s)/i
	);
	if (gm) {
		grade = normalizeGrade(`${gm[1]} ${gm[2]}`);
		rest = rest.slice(0, gm.index) + " " + rest.slice((gm.index ?? 0) + gm[0].length);
	}
	let condition: Condition | undefined;
	const cm = rest.match(/\s(NM|LP|MP|HP|DMG)(?=\s)/i);
	if (cm) {
		condition = parseCondition(cm[1]);
		rest = rest.slice(0, cm.index) + " " + rest.slice((cm.index ?? 0) + cm[0].length);
	}
	return { condition, grade, rest: rest.replace(/\s+/g, " ").trim() };
}
