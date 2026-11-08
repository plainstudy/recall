// Fixture loading for unit tests: every call returns a fresh copy, so a test can change
// it in code without touching another test's.
import { readFileSync } from 'node:fs';

export const fixtureText = (name) => readFileSync(new URL(`../fixtures/${name}`, import.meta.url), 'utf8');
export const fixture = (name) => JSON.parse(fixtureText(name));

// What is installed, in the shape the engine's checks take.
export const nothingInstalled = () => ({ bundle: null, glossary: null, track: null, packs: {} });

export function installedWith({ bundle = null, glossary = null, track = null, packs = [] } = {}) {
  return { bundle, glossary, track, packs: Object.fromEntries(packs.map((p) => [p.packId, p])) };
}

export const ctxFor = (installed, engineVersion = '0.2.0') => ({ engineVersion, installed });
