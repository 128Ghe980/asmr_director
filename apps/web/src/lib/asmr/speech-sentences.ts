/** Preserve the exact script while exposing complete spoken sentences. Commas
 * remain inside a sentence, so an ordinary compound sentence stays coherent.
 * A decimal point or a dot inside a name is not a sentence ending.
 */
export function splitSpeechSentences(text: string): string[] {
  const pieces: string[] = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const decimalPoint = character === "." && /\d/u.test(text[index - 1] ?? "") && /\d/u.test(text[index + 1] ?? "");
    const abbreviation = character === "." && /(?:\b(?:Mr|Mrs|Ms|Dr|Prof|Sr|Jr|St|vs|e\.g|i\.e)|\b[A-Z])\.$/u.test(text.slice(start, index + 1));
    const boundary = /[。！？!?；;\r\n]/u.test(character)
      || (character === "." && !decimalPoint && !abbreviation && !/[\p{L}\p{N}]/u.test(text[index + 1] ?? ""));
    if (!boundary) continue;
    let end = index + 1;
    while (end < text.length && /[。！？.!?；;\s”’"'」』】）)]/u.test(text[end])) end += 1;
    if (/[\p{L}\p{N}]/u.test(text.slice(start, end))) {
      pieces.push(text.slice(start, end));
      start = end;
    }
    index = end - 1;
  }
  if (start < text.length) {
    const tail = text.slice(start);
    if (/[\p{L}\p{N}]/u.test(tail) || !pieces.length) pieces.push(tail);
    else pieces[pieces.length - 1] += tail;
  }
  return pieces.length ? pieces : [text];
}
