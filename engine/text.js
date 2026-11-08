// Content text is plain text. The one exception is a span between backticks, which is
// shown in the mono face. A backtick without a partner stays an ordinary character.

export function textSpans(text) {
  const s = typeof text === 'string' ? text : '';
  const out = [];
  const push = (t, mono) => {
    if (!t) return;
    const last = out[out.length - 1];
    if (last && last.mono === mono) last.text += t;
    else out.push({ text: t, mono });
  };
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('`', i);
    const close = open === -1 ? -1 : s.indexOf('`', open + 1);
    if (close === -1) {
      push(s.slice(i), false);
      break;
    }
    push(s.slice(i, open), false);
    push(s.slice(open + 1, close), true);
    i = close + 1;
  }
  return out;
}

// The text as the learner reads it, without the backticks.
export function plainText(text) {
  return textSpans(text)
    .map((span) => span.text)
    .join('');
}
