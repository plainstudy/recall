// The weekly report (spec §3.10): Markdown a person can read and another model can work
// from, ending in the full progress, which restores the learner on any phone.

import { catalogueOf } from './catalogue.js';
import { addDays, daysBetween, learnerDay, stampText } from './days.js';
import { termById } from './glossary.js';
import { currentLessonId } from './lessons.js';
import { stamped } from './progress.js';

const MAX_PERIOD_DAYS = 28;
const FAILING_WITHIN_DAYS = 14;
const SLUG_MAX = 24;

const isObject = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The learner's part of the file name: spaces as hyphens, then only letters (in any
// script), digits and hyphens, at most 24 characters; `learner` if nothing is left.
export function learnerSlug(name) {
  const kept = String(name ?? '')
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{M}\p{N}-]/gu, '');
  const slug = [...kept].slice(0, SLUG_MAX).join('');
  return slug === '' || /^-+$/.test(slug) ? 'learner' : slug;
}

// <prefix>_Report_<learner>_<YYYY-MM-DD>.md, or Report_<learner>_<YYYY-MM-DD>.md.
export function reportFileName(prefix, name, day) {
  const base = `Report_${learnerSlug(name)}_${day}.md`;
  return prefix ? `${prefix}_${base}` : base;
}

// The days the report covers: since the previous report, at most 28; the first report
// covers everything since the profile was made.
export function reportPeriod(progress, today) {
  const saved = progress.reportsSavedOn.filter((d) => daysBetween(d, today) >= 0).sort();
  if (saved.length === 0) return { from: progress.profile.createdOn, to: today };
  const last = saved[saved.length - 1];
  const earliest = addDays(today, -MAX_PERIOD_DAYS);
  return { from: daysBetween(earliest, last) >= 0 ? last : earliest, to: today };
}

// Progress with this report's marks: today among the report days, and every request not
// yet reported marked as reported today.
export function withReportMarks(progress, today) {
  return {
    ...progress,
    reportsSavedOn: [...new Set([...progress.reportsSavedOn, today])].sort(),
    termRequests: progress.termRequests.map((r) => (r.reportedOn == null ? { ...r, reportedOn: today } : r)),
  };
}

// Text that sits safely on one line and in one table cell.
const cell = (x) => String(x ?? '').replace(/[\r\n]+/g, ' ').replace(/\|/g, '\\|');
const line = (x) => String(x ?? '').replace(/[\r\n]+/g, ' ');

const inPeriod = (day, period) => daysBetween(period.from, day) >= 0 && daysBetween(day, period.to) >= 0;

function table(head, rows) {
  return [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`)];
}

function sessionsSection(progress, period) {
  const entries = progress.sessionLog.filter((s) => isObject(s) && typeof s.day === 'string' && inPeriod(s.day, period));
  const daily = entries.filter((s) => s.kind === 'daily');
  const days = new Set(daily.map((s) => s.day)).size;
  const { current, longest, freezesRemaining } = progress.streak;
  const counts =
    daily.length === 0
      ? 'No daily sessions in this period.'
      : `${daily.length} daily session${daily.length === 1 ? '' : 's'} on ${days} day${days === 1 ? '' : 's'}.`;
  const out = ['## Sessions', `${counts} Streak ${current}, longest ${longest}, freezes left ${freezesRemaining}.`];
  if (entries.length > 0) {
    out.push(
      '',
      ...table(
        ['Day', 'Length', 'Cards', 'Correct', 'Traps'],
        entries.map((s) => [
          `${s.day}${s.kind === 'redo' ? ' (redo)' : ''}`,
          `${Math.round((s.lengthSec || 0) / 60)} min`,
          s.answered ?? '',
          s.correct ?? '',
          Array.isArray(s.traps) ? `${s.traps[0]} of ${s.traps[1]}` : '',
        ]),
      ),
    );
  }
  return out;
}

function familiesSection(progress, period, glossary) {
  const totals = new Map();
  for (const s of progress.sessionLog) {
    if (!isObject(s) || typeof s.day !== 'string' || !inPeriod(s.day, period) || !isObject(s.families)) continue;
    for (const [family, pair] of Object.entries(s.families)) {
      const t = totals.get(family) || [0, 0];
      totals.set(family, [t[0] + (Number(pair[0]) || 0), t[1] + (Number(pair[1]) || 0)]);
    }
  }
  const names = new Map((isObject(glossary) && Array.isArray(glossary.families) ? glossary.families : []).map((f) => [f.id, f.name]));
  const rows = [...totals]
    .filter(([, [answered]]) => answered > 0)
    .map(([id, [answered, correct]]) => [names.get(id) || id, answered, correct, `${Math.round((correct / answered) * 100)}%`]);
  return ['## Accuracy by family', ...(rows.length > 0 ? table(['Family', 'Answers', 'Correct', 'Accuracy'], rows) : ['No answers in this period.'])];
}

function confusionsSection(progress, glossary) {
  const name = (id) => {
    const term = termById(glossary, id);
    return term ? term.term : id;
  };
  const top = progress.confusions
    .filter((c) => isObject(c) && Array.isArray(c.pair) && c.pair.length === 2)
    .sort((a, b) => (b.count || 0) - (a.count || 0))
    .slice(0, 5);
  return [
    '## Top confusions',
    // Pairs have no direction, so neither column is "the right one".
    ...(top.length > 0 ? table(['Term', 'Confused with', 'Times'], top.map((c) => [name(c.pair[0]), name(c.pair[1]), c.count])) : ['None recorded.']),
  ];
}

function failingSection(progress, catalogue, today) {
  const rows = Object.entries(progress.atoms)
    .filter(
      ([, a]) =>
        (a.box === 1 || a.box === 2) &&
        (a.totalWrong || 0) >= 2 &&
        typeof a.lastSeenOn === 'string' &&
        daysBetween(a.lastSeenOn, today) < FAILING_WITHIN_DAYS,
    )
    .sort((x, y) => (y[1].totalWrong || 0) - (x[1].totalWrong || 0) || x[0].localeCompare(y[0]))
    .slice(0, 10)
    .map(([key, a]) => {
      const where = (a.lastMissedCardId && catalogue.cards.get(a.lastMissedCardId)) || (catalogue.atoms.get(key) || [])[0];
      const lesson = where ? catalogue.lessons.get(where.lessonId).lesson : null;
      return [key, lesson ? `${lesson.title} (${lesson.lessonId})` : '', a.totalWrong, where ? where.card.cardId : ''];
    });
  return ['## Failing atoms', ...(rows.length > 0 ? table(['Atom', 'Lesson', 'Wrong', 'A card that tests it'], rows) : ['None.'])];
}

function requestsSection(progress) {
  const open = progress.termRequests.filter((r) => r.reportedOn == null);
  return ['## Requested terms', ...(open.length > 0 ? open.map((r) => `- "${line(r.text)}", ${r.on}`) : ['None.'])];
}

function positionSection(progress, content, order) {
  const n = order.lessons.length;
  let text;
  if (n === 0) text = 'No lessons installed.';
  else {
    const id = currentLessonId(order, progress.position);
    const at = order.lessons.findIndex((e) => e.lesson.lessonId === id);
    if (id == null) text = content.track ? 'Every lesson in your track is done.' : 'Every installed lesson is done.';
    else if (at < 0) text = `Lesson ${id}, which isn't in the lessons on this phone.`;
    else {
      const lesson = order.lessons[at].lesson;
      const card = Math.min(progress.position.currentCardIndex + 1, lesson.cards.length);
      const where = content.track ? ' in the track' : '';
      text = `Lesson ${at + 1} of ${n}${where}: ${line(lesson.title)} (${lesson.lessonId}), card ${card} of ${lesson.cards.length}.`;
    }
  }
  return ['## Position', text];
}

// A fence longer than any run of backticks inside the block.
function fenceFor(text) {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((m) => m[0].length));
  return '`'.repeat(Math.max(3, longest + 1));
}

// The report for the progress and content on this phone, now. `appName` heads it when no
// bundle is installed. Returns the file name, the text, and the progress with this
// report's marks, which is what the block carries and what the phone keeps once the
// report has been saved.
export function buildReport(progress, content, clock, engineVersion, appName) {
  const today = learnerDay(clock);
  const catalogue = catalogueOf(content);
  const period = reportPeriod(progress, today);
  const marked = stamped(withReportMarks(progress, today), clock, engineVersion);
  const installed = progress.installed;
  const title = installed.title || appName;
  const track = installed.trackId ? `${line(installed.trackTitle)} (${installed.trackId} ${installed.trackVersion})` : 'none';
  const json = JSON.stringify(marked, null, 2);
  const fence = fenceFor(json);
  const text = [
    `# ${line(title)} — weekly report`,
    '',
    `Learner: ${line(progress.profile.name)} · Role: ${progress.profile.role ? line(progress.profile.role) : 'not set'} · Track: ${track}`,
    `Period: ${period.from} to ${period.to} · Saved ${stampText(marked.savedOn)} · Engine ${engineVersion} · Glossary ${installed.glossaryVersion || 'none'}`,
    '',
    ...sessionsSection(progress, period),
    '',
    ...familiesSection(progress, period, content.glossary),
    '',
    ...confusionsSection(progress, content.glossary),
    '',
    ...failingSection(progress, catalogue, today),
    '',
    ...requestsSection(progress),
    '',
    ...positionSection(progress, content, catalogue.order),
    '',
    '## Full progress data',
    'This block restores the learner on any phone: Settings, Import, this file.',
    '',
    `${fence}json progress`,
    json,
    fence,
    '',
  ].join('\n');
  return { fileName: reportFileName(installed.reportPrefix, progress.profile.name, today), text, marked };
}
