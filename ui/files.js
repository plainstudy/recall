// Files in and out: picking a file to import, and saving the weekly report through the
// phone's share sheet where the browser accepts the file, or as a download otherwise.
import { FORMAT_MESSAGES, MAX_IMPORT_BYTES } from '../engine/formats.js';
import { el } from './dom.js';

// One hidden file input with no type filter, so the phone's picker lists every file.
export function filePicker() {
  const input = el('input', { type: 'file', class: 'file-input', hidden: true, tabindex: '-1', 'aria-hidden': 'true' });
  document.body.append(input);
  let onFile = null;
  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    input.value = '';
    if (file && onFile) onFile(file);
  });
  return {
    choose(callback) {
      onFile = callback;
      input.click();
    },
  };
}

// A picked file's text: { ok: true, text } or { ok: false, message }.
export async function readPicked(file) {
  if (file.size > MAX_IMPORT_BYTES) return { ok: false, message: FORMAT_MESSAGES.tooLarge };
  try {
    return { ok: true, text: await file.text() };
  } catch {
    return { ok: false, message: FORMAT_MESSAGES.notImportable };
  }
}

function download(file) {
  const url = URL.createObjectURL(file);
  const link = el('a', { href: url, download: file.name, hidden: true });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

// Saves a file: 'shared', 'downloaded', or 'cancelled' when the learner closed the share
// sheet. Must be called straight from a tap, which the share sheet needs.
export async function saveFile(file) {
  let canShare = false;
  try {
    canShare = typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
  } catch {
    canShare = false;
  }
  if (canShare) {
    try {
      await navigator.share({ files: [file] });
      return 'shared';
    } catch (error) {
      if (error && error.name === 'AbortError') return 'cancelled';
    }
  }
  download(file);
  return 'downloaded';
}
