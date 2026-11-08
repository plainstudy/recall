// Recognising an imported file. A JSON file is known by its top-level keys, in this
// order, since a bundle holds packs and a track inside it: bundleId, packId,
// glossaryVersion, trackId, testSetId. A Markdown file with a `json progress` block is a
// weekly report. Anything else can't be imported.

export const MAX_IMPORT_BYTES = 10 * 1024 * 1024;

export const FORMAT_MESSAGES = {
  tooLarge: 'This file is too large to import.',
  notImportable: "This file isn't something the app can import.",
  reportWithoutBlock: "This report has no progress data at its end, so it can't restore anything.",
  testSet: 'This is a model test set. Test sets come with a later version of the app.',
};

const KEYS = [
  ['bundleId', 'bundle'],
  ['packId', 'pack'],
  ['glossaryVersion', 'glossary'],
  ['trackId', 'track'],
  ['testSetId', 'testSet'],
];

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The text of the last fenced block whose info string is `json progress`, or null. A
// block closes with a fence of the same character, at least as long as the one that
// opened it; a block left open runs to the end of the file.
export function findProgressBlock(text) {
  const lines = String(text).split(/\r?\n/);
  let found = null;
  for (let i = 0; i < lines.length; i++) {
    const open = /^ {0,3}(`{3,}|~{3,})\s*(.*?)\s*$/.exec(lines[i]);
    if (!open) continue;
    const fence = open[1];
    const close = new RegExp(`^ {0,3}${fence[0] === '`' ? '`' : '~'}{${fence.length},}\\s*$`);
    let end = i + 1;
    while (end < lines.length && !close.test(lines[end])) end++;
    if (/^json\s+progress$/i.test(open[2])) found = lines.slice(i + 1, end).join('\n');
    i = end;
  }
  return found;
}

// A report's heading line, as the engine writes it.
const REPORT_HEADING = /^# .*weekly report\s*$/m;

// { kind, data } for a file the app knows, or { kind: null, message }. A report's data is
// the text of its progress block, still to be parsed and checked.
export function recognise(text) {
  const source = String(text).replace(/^﻿/, '');
  let data;
  try {
    data = JSON.parse(source);
  } catch {
    const block = findProgressBlock(source);
    if (block !== null) return { kind: 'report', data: block };
    const message = REPORT_HEADING.test(source) ? FORMAT_MESSAGES.reportWithoutBlock : FORMAT_MESSAGES.notImportable;
    return { kind: null, message };
  }
  if (!isObject(data)) return { kind: null, message: FORMAT_MESSAGES.notImportable };
  for (const [key, kind] of KEYS) {
    if (!Object.hasOwn(data, key)) continue;
    if (kind === 'testSet') return { kind: null, message: FORMAT_MESSAGES.testSet };
    return { kind, data };
  }
  return { kind: null, message: FORMAT_MESSAGES.notImportable };
}
