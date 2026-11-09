// Ids for the learner, the phone and each session record: UUID version 4, lowercase, made
// from the random source passed in.

const hex = (byte) => byte.toString(16).padStart(2, '0');

export function newId(random) {
  const bytes = Array.from({ length: 16 }, () => random.below(256));
  bytes[6] = (bytes[6] & 0x0f) | 0x40; // version 4
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // the standard variant
  const text = bytes.map(hex).join('');
  return `${text.slice(0, 8)}-${text.slice(8, 12)}-${text.slice(12, 16)}-${text.slice(16, 20)}-${text.slice(20)}`;
}

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const isId = (x) => typeof x === 'string' && ID.test(x);
