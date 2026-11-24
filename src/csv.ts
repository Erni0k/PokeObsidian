/**
 * Minimal RFC 4180 CSV reader/writer: quoted fields, doubled quotes, CR/LF
 * inside quotes, a UTF-8 BOM, and auto-detected delimiter (`,` `;` or tab —
 * Cardmarket tools export with semicolons).
 */

/** Pick the delimiter that splits the header line into the most fields. */
export function detectDelimiter(text: string): string {
	const first = firstLine(text);
	let best = ",";
	let bestCount = -1;
	for (const d of [",", ";", "\t"]) {
		const n = splitLine(first, d).length;
		if (n > bestCount) {
			best = d;
			bestCount = n;
		}
	}
	return best;
}

function firstLine(text: string): string {
	let inQuotes = false;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === '"') inQuotes = !inQuotes;
		else if ((c === "\n" || c === "\r") && !inQuotes) return text.slice(0, i);
	}
	return text;
}

function splitLine(line: string, delimiter: string): string[] {
	return parseCsv(line, delimiter)[0] ?? [];
}

/** Parse CSV text into rows of cells (blank lines dropped). */
export function parseCsv(input: string, delimiter?: string): string[][] {
	const text = input.replace(/^﻿/, "");
	const d = delimiter ?? detectDelimiter(text);
	const rows: string[][] = [];
	let row: string[] = [];
	let cell = "";
	let inQuotes = false;

	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (inQuotes) {
			if (c === '"') {
				if (text[i + 1] === '"') {
					cell += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				cell += c;
			}
			continue;
		}
		if (c === '"' && cell === "") {
			inQuotes = true;
		} else if (c === d) {
			row.push(cell);
			cell = "";
		} else if (c === "\n" || c === "\r") {
			if (c === "\r" && text[i + 1] === "\n") i++;
			row.push(cell);
			cell = "";
			if (row.some((v) => v.trim() !== "")) rows.push(row);
			row = [];
		} else {
			cell += c;
		}
	}
	row.push(cell);
	if (row.some((v) => v.trim() !== "")) rows.push(row);
	return rows;
}

/** Quote a cell when it contains the delimiter, a quote or a line break. */
function quote(value: string, delimiter: string): string {
	if (value.includes(delimiter) || /["\r\n]/.test(value) || /^\s|\s$/.test(value)) {
		return `"${value.replace(/"/g, '""')}"`;
	}
	return value;
}

/** Serialize rows to CSV (CRLF line endings, as Excel expects). */
export function toCsv(rows: string[][], delimiter = ","): string {
	return rows.map((r) => r.map((v) => quote(v, delimiter)).join(delimiter)).join("\r\n") + "\r\n";
}
