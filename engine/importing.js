// Planning an import (spec §9.5, §9.6): given a recognised file and what is on the phone,
// either the refusal, or what will change, the content after it, and the stores to write.
// Nothing here writes anything; the page applies a plan in one transaction.
//
// `content` is what is installed: { bundle, glossary, track, packs }, where `bundle` is the
// bundle's details without its parts, and `packs` maps each packId to its pack.

import { longDate, stampDay, instantOf } from './days.js';
import { changesText, glossaryChanges } from './glossary.js';
import { positionAfterUpdate } from './lessons.js';
import { checkProgress, installedFrom, PROGRESS_MESSAGES, stamped } from './progress.js';
import { checkFile, newerInstalled, problemText } from './validate.js';
import { compareVersions } from './versions.js';

export const emptyContent = () => ({ bundle: null, glossary: null, track: null, packs: {} });

// The store keys content lives under.
export const CONTENT_KEYS = { bundle: 'bundle', glossary: 'glossary', track: 'track', pack: (packId) => `pack:${packId}` };

const packName = (pack) => pack.title || pack.packId;

// The bundle's own details, kept without its parts.
function bundleDetails(bundle) {
  const { glossary, packs, track, ...details } = bundle;
  return details;
}

function packLine(pack, installed) {
  if (!installed) return `${packName(pack)} ${pack.packVersion}, new`;
  if (compareVersions(pack.packVersion, installed.packVersion) === 0) return `${packName(pack)} unchanged`;
  return `${packName(pack)} ${installed.packVersion} → ${pack.packVersion}`;
}

function glossaryLine(glossary, installed) {
  if (!installed) return `${glossary.glossaryVersion}, new, with ${glossary.terms.length} terms`;
  if (compareVersions(glossary.glossaryVersion, installed.glossaryVersion) === 0) return 'unchanged';
  return `${installed.glossaryVersion} → ${glossary.glossaryVersion}, ${changesText(glossaryChanges(installed, glossary))}`;
}

function trackLine(track, installed) {
  if (!installed) return `${track.title} ${track.trackVersion}, new`;
  if (installed.trackId !== track.trackId) return `${track.title} ${track.trackVersion}, in place of ${installed.title} ${installed.trackVersion}`;
  if (compareVersions(track.trackVersion, installed.trackVersion) === 0) return 'unchanged';
  return `${track.title} ${installed.trackVersion} → ${track.trackVersion}`;
}

const warningLines = (warnings) => warnings.map((w) => problemText(w));

// A refusal: the first problem, and how many more there are.
function refusal(problems) {
  return { ok: false, message: problemText(problems[0]), more: problems.length - 1, problems };
}

// Plans the import of a recognised file: { kind, data } from formats.recognise.
//   ctx: { content, progress, engineVersion }
// Returns { ok: false, message, more, problems } or, for content,
//   { ok: true, kind, lines, warnings, done, nextContent, writes: { put: [[key, value]], remove: [key] } }
// and, for a report,
//   { ok: true, kind: 'report', lines, done, fromReport }.
export function planImport(file, ctx) {
  if (file.kind === 'report') return planRestore(file.data, ctx);
  const { content, engineVersion } = ctx;
  const result = checkFile(file.kind, file.data, { engineVersion, installed: content });
  if (!result.ok) return refusal(result.problems);
  const plan = { pack: planPack, glossary: planGlossary, track: planTrack, bundle: planBundle }[file.kind](file.data, content);
  return { ok: true, kind: file.kind, warnings: warningLines(result.warnings), ...plan };
}

function planPack(pack, content) {
  const before = content.packs[pack.packId] || null;
  const line = `Pack ${packLine(pack, before)}.`;
  return {
    lines: before ? [line, 'Your progress stays.'] : [line],
    done: `Pack ${packName(pack)} ${pack.packVersion} installed.`,
    nextContent: { ...content, packs: { ...content.packs, [pack.packId]: pack } },
    writes: { put: [[CONTENT_KEYS.pack(pack.packId), pack]], remove: [] },
  };
}

function planGlossary(glossary, content) {
  return {
    lines: [`Glossary ${glossaryLine(glossary, content.glossary)}.`, ...(content.glossary ? ['Your progress stays.'] : [])],
    done: `Glossary ${glossary.glossaryVersion} installed.`,
    nextContent: { ...content, glossary },
    writes: { put: [[CONTENT_KEYS.glossary, glossary]], remove: [] },
  };
}

function planTrack(track, content) {
  return {
    lines: [`Track ${trackLine(track, content.track)}.`],
    done: `Track ${track.title} ${track.trackVersion} installed.`,
    nextContent: { ...content, track },
    writes: { put: [[CONTENT_KEYS.track, track]], remove: [] },
  };
}

function planBundle(bundle, content) {
  const details = bundleDetails(bundle);
  const put = [[CONTENT_KEYS.bundle, details]];
  const next = { ...content, bundle: details, packs: { ...content.packs } };
  const parts = [];

  // A part older than the one installed is not installed: the newer one stays.
  const keptGlossary = newerInstalled('glossary', bundle.glossary, content);
  const sameGlossary = content.glossary && compareVersions(bundle.glossary.glossaryVersion, content.glossary.glossaryVersion) === 0;
  if (keptGlossary) {
    parts.push(`glossary ${keptGlossary.glossaryVersion} kept, newer than the bundle's ${bundle.glossary.glossaryVersion}`);
  } else {
    parts.push(`glossary ${glossaryLine(bundle.glossary, content.glossary)}`);
    if (!sameGlossary) {
      next.glossary = bundle.glossary;
      put.push([CONTENT_KEYS.glossary, bundle.glossary]);
    }
  }
  for (const pack of bundle.packs) {
    const before = content.packs[pack.packId] || null;
    const kept = newerInstalled('pack', pack, content);
    if (kept) {
      parts.push(`pack ${packName(kept)} ${kept.packVersion} kept, newer than the bundle's ${pack.packVersion}`);
      continue;
    }
    parts.push(`pack ${packLine(pack, before)}`);
    if (!before || compareVersions(pack.packVersion, before.packVersion) !== 0) {
      next.packs[pack.packId] = pack;
      put.push([CONTENT_KEYS.pack(pack.packId), pack]);
    }
  }
  const keptTrack = newerInstalled('track', bundle.track, content);
  const sameTrack =
    content.track && content.track.trackId === bundle.track.trackId && compareVersions(bundle.track.trackVersion, content.track.trackVersion) === 0;
  if (keptTrack) {
    parts.push(`track ${keptTrack.title} ${keptTrack.trackVersion} kept, newer than the bundle's ${bundle.track.trackVersion}`);
  } else {
    parts.push(`track ${trackLine(bundle.track, content.track)}`);
    if (!sameTrack) {
      next.track = bundle.track;
      put.push([CONTENT_KEYS.track, bundle.track]);
    }
  }

  const lines = [`Bundle ${bundle.title} ${bundle.bundleVersion}: ${parts.join('; ')}.`];
  if (content.bundle && content.bundle.bundleId !== bundle.bundleId) {
    lines.push(`This replaces the bundle ${content.bundle.title}, and your track with its own. Your progress stays.`);
  } else if (content.bundle) {
    lines.push('Your progress stays.');
  }
  return { lines, done: `Bundle ${bundle.title} ${bundle.bundleVersion} installed.`, nextContent: next, writes: { put, remove: [] } };
}

// Removing a pack: the content after it and the store key to delete. Progress stays.
export function planRemove(packId, content) {
  const pack = content.packs[packId];
  const packs = { ...content.packs };
  delete packs[packId];
  return {
    lines: [`Remove the pack ${packName(pack)}? Your progress stays, and importing the pack again brings it back.`],
    done: `Pack ${packName(pack)} removed. Your progress stays.`,
    nextContent: { ...content, packs },
    writes: { put: [], remove: [CONTENT_KEYS.pack(packId)] },
  };
}

// Progress after content changes: `installed` describes the new content, the position
// follows §5.7's rule, and nothing else moves, atoms included.
export function progressAfter(progress, nextContent, clock, engineVersion) {
  return stamped(
    { ...progress, installed: installedFrom(nextContent), position: positionAfterUpdate(progress.position, nextContent) },
    clock,
    engineVersion,
  );
}

function planRestore(blockText, { progress }) {
  let fromReport;
  try {
    fromReport = JSON.parse(blockText);
  } catch {
    return refusal([{ item: '', message: PROGRESS_MESSAGES.mismatch }]);
  }
  const check = checkProgress(fromReport);
  if (!check.ok) return refusal([{ item: '', message: check.message }]);
  const name = fromReport.profile.name;
  const lines = [`Restore ${name}'s progress from ${longDate(stampDay(fromReport.savedOn))}? This replaces the progress on this phone.`];
  const phoneNewer = progress && instantOf(progress.savedOn) > instantOf(fromReport.savedOn) && progress.sessionLog.length > 0;
  if (phoneNewer) lines.push(`The progress on this phone is newer, from ${longDate(stampDay(progress.savedOn))}.`);
  return { ok: true, kind: 'report', lines, warnings: [], done: `${name}'s progress is restored.`, fromReport };
}
