// One card on the screen, top to bottom: its place in the lesson, its content, the
// answers, the verdict and explanation once checked, and the bar with the one button.
// The answers sit directly above the bar, so the nearest are always under the thumb.
import { explanationFor, scoreAnswer, verdictFor } from '../engine/scoring.js';
import { mountChoice } from './answer-choice.js';
import { mountCloze } from './answer-cloze.js';
import { mountHotspot } from './answer-hotspot.js';
import { mountMatch } from './answer-match.js';
import { mountOrder } from './answer-order.js';
import { el, icon, richText, textBlock } from './dom.js';
import { figureView } from './figure.js';

const MOUNT = {
  mcq: mountChoice,
  desk: mountChoice,
  multi: mountChoice,
  variant: mountChoice,
  cloze: mountCloze,
  match: mountMatch,
  order: mountOrder,
  hotspot: mountHotspot,
};

const CANNOT_SHOW = "This card can't be shown.";

// After Check: scroll down as far as the explanation goes, but never past the verdict.
function bringIntoView(result) {
  const top = result.getBoundingClientRect().top + window.scrollY;
  const bottom = document.documentElement.scrollHeight - window.innerHeight;
  window.scrollTo(0, Math.max(window.scrollY, Math.min(bottom, top - 16)));
}

// card: read by the engine. lists: this presentation's orders. onAnswered({ correct, trap,
// answer, score }) runs once, at Check, with the answer as given and how it scored.
// onContinue runs when the learner moves on. onEnd, when given, puts End session at the top.
export function cardScreen({ card, lists, place, onAnswered, onContinue, onEnd = null }) {
  const body = el('div', { class: 'card-body' });
  const answers = el('div', { class: 'card-answers push' });
  const result = el('div', { class: 'card-result', 'aria-live': 'polite' });
  const action = el('button', { type: 'button', class: 'primary' });
  const screen = el(
    'section',
    {
      class: 'screen card-screen',
      'data-card-type': card.type || 'unknown',
      'data-card-id': card.cardId == null ? '' : String(card.cardId),
    },
    el(
      'div',
      { class: 'card-top' },
      el('p', { class: 'card-place', text: place }),
      onEnd ? el('button', { type: 'button', class: 'secondary end-session', text: 'End session', onclick: onEnd }) : null,
    ),
    body,
    answers,
    result,
    el('div', { class: 'action-bar' }, action),
  );

  const showContinue = () => {
    action.textContent = 'Continue';
    action.disabled = false;
    action.onclick = onContinue;
  };

  const cannotShow = (message) => {
    body.replaceChildren(el('p', { class: 'notice', text: message }));
    answers.replaceChildren();
    showContinue();
  };

  if (card.unshowable) {
    cannotShow(card.unshowable);
    return screen;
  }

  try {
    if (card.type === 'teach') {
      body.append(textBlock('p', 'prompt', card.prompt));
      const figure = card.resolvedFigure ? figureView(card.resolvedFigure) : null;
      if (figure) body.append(figure.node);
      if (figure && figure.hasMore()) {
        action.textContent = 'Show next';
        action.onclick = () => {
          figure.showNext();
          if (!figure.hasMore()) showContinue();
        };
      } else {
        showContinue();
      }
      return screen;
    }

    if (card.type === 'variant' && card.term) body.append(textBlock('p', 'card-term', card.term));
    if (card.type !== 'cloze') body.append(textBlock('p', 'prompt', card.prompt));
    if (card.type === 'desk' && card.artifact && typeof card.artifact.text === 'string') {
      body.append(el('div', { class: 'artifact', 'data-kind': String(card.artifact.kind || '') }, richText(card.artifact.text)));
    }

    let renderer = null;
    const update = () => {
      action.disabled = !renderer || renderer.answer() === null;
    };
    renderer = MOUNT[card.type](card, lists, { body, answers, changed: update });
    action.textContent = 'Check';
    update();
    action.onclick = () => {
      const answer = renderer.answer();
      if (!answer) return;
      const score = scoreAnswer(card, answer);
      const key = renderer.reveal(score);
      result.append(
        el(
          'p',
          { class: `verdict ${score.correct ? 'verdict-right' : 'verdict-wrong'}` },
          icon(score.correct ? 'right' : 'wrong'),
          el('span', { text: verdictFor(card, score.correct) }),
        ),
      );
      if (key) result.append(key);
      for (const part of explanationFor(card, answer, score.correct)) result.append(textBlock('p', 'explanation', part));
      showContinue();
      onAnswered({ correct: score.correct, trap: card.trap === true, answer, score });
      bringIntoView(result);
    };
  } catch {
    cannotShow(CANNOT_SHOW);
  }
  return screen;
}
