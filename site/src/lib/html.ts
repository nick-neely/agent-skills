const ENTITIES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHTML = (text: string) => text.replace(/[&<>"']/g, (c) => ENTITIES[c] ?? c);

/** Catalog summaries and intros are one line of text with `code` in backticks. */
export const inlineHTML = (text: string) => escapeHTML(text).replace(/`([^`]+)`/g, "<code>$1</code>");

/** The same line as plain text, for meta descriptions and filtering. */
export const plainText = (text: string) => text.replace(/`/g, "");

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
