// The summary at the end of a session or a redo: its lines, the weekly report line when a
// report is due, and the way back to the start screen.
import { el, textBlock } from './dom.js';

// heading: what finished. title: the lesson redone, if any. lines: the summary's lines.
// report: null, or { line, onSave } when a weekly report is due. notice: what was just
// done, such as a report saved.
export function summaryScreen({ kind, heading, title = null, lines, report = null, notice = null, onDone }) {
  return el(
    'section',
    { class: 'screen summary-screen', 'data-kind': kind },
    el('p', { class: 'card-place', text: heading }),
    title ? textBlock('h1', 'lesson-heading', title) : null,
    notice ? el('p', { class: 'notice', role: 'status', text: notice }) : null,
    el(
      'div',
      { class: 'summary-lines' },
      lines.map((line) => el('p', { class: 'summary-line', text: line })),
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
