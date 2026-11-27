/**
 * Remove CommonMark-style inline code spans while preserving prose.
 * A closing delimiter must use exactly the same backtick-run length as
 * its opener; shorter or longer runs inside the span are content.
 */
export function removeInlineCodeSpans(markdown) {
  if (typeof markdown !== "string" || markdown.length === 0) return "";

  const runs = [];
  for (let index = 0; index < markdown.length;) {
    if (markdown[index] !== "`") {
      index += 1;
      continue;
    }
    let end = index + 1;
    while (markdown[end] === "`") end += 1;
    runs.push({ start: index, end, length: end - index });
    index = end;
  }

  const nextSameLengthRun = new Array(runs.length).fill(-1);
  const nearestByLength = new Map();
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    nextSameLengthRun[index] = nearestByLength.get(runs[index].length) ?? -1;
    nearestByLength.set(runs[index].length, index);
  }

  let output = "";
  let cursor = 0;
  for (let index = 0; index < runs.length; index += 1) {
    const opener = runs[index];
    if (opener.start < cursor) continue;
    const closingIndex = nextSameLengthRun[index];
    if (closingIndex < 0) continue;

    output += markdown.slice(cursor, opener.start) + " ";
    cursor = runs[closingIndex].end;
    index = closingIndex;
  }

  return output + markdown.slice(cursor);
}
