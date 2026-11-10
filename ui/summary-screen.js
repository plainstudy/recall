// The summary at the end of a session or a redo (spec §7): what finished, its lines, the
// one moment, in which the reviews that moved up a box shift once, the weekly report line
// when a report is due, and Done.
import { el, textBlock } from './dom.js';

const MOMENT_MARKS = 12; // at most, however many reviews moved up

// heading: what finished. title: the lesson redone, if any. lines: the summary's lines.
// movedUp: { count, after }, the reviews that moved up a box and the line that says so, or
// null. report: null, or { line, onSave } when a weekly report is due. notice: what was
// just done, such as a report saved.
export function summaryScreen({ kind, heading, title = null, lines, movedUp = null, report = null, notice = null, onDone }) {
  const moment =
    movedUp && movedUp.count > 0
      ? el('div', { class: 'moved-up', 'aria-hidden': 'true' }, Array.from({ length: Math.min(movedUp.count, MOMENT_MARKS) }, () => el('span', { class: 'moved-up-mark' })))
      : null;
  return el(
    'section',
    { class: 'screen summary-screen', 'data-kind': kind },
    el('h1', { class: 'screen-title', text: heading }),
    title ? textBlock('p', 'lead lesson-heading', title) : null,
    notice ? el('p', { class: 'notice notice-done', role: 'status', text: notice }) : null,
    el(
      'div',
      { class: 'summary-lines' },
      lines.map((line, i) => [el('p', { class: 'summary-line', text: line }), movedUp && i === movedUp.after ? moment : null]),
    ),
    report
      ? el(
          'div',
          { class: 'summary-report' },
          el('p', { class: 'report-due', text: report.line }),
          el('button', { type: 'button', class: 'secondary', text: 'Save report now', onclick: report.onSave }),
        )
      : null,
    el('div', { class: 'action-bar push' }, el('button', { type: 'button', class: 'primary', text: 'Done', onclick: onDone })),
  );
}
