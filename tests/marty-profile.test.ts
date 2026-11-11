import { describe, expect, it } from 'vitest';
import { martyBostonInstructions, MARTY_BOSTON_PROFILE_VERSION, MARTY_BOSTON_CONSENT_VERSION } from '../src/voice/martySullivanBoston';
import { comedyScenarios } from '../src/voice/comedyScenarios';

describe('Marty Sullivan Boston profile', () => {
  it('uses a separately versioned Boston identity', () => {
    expect(MARTY_BOSTON_PROFILE_VERSION).toBe('marty-boston-v1.0.0');
    expect(MARTY_BOSTON_CONSENT_VERSION).toBeTruthy();
    expect(martyBostonInstructions).toContain('South Boston');
    expect(martyBostonInstructions).toContain('New York source remains preserved separately');
    expect(martyBostonInstructions).toContain('Do not perform a cartoon accent');
  });

  it('contains 33 human-audition scenarios including three Boston-local prompts', () => {
    expect(comedyScenarios).toHaveLength(33);
    expect(comedyScenarios.filter(s => s.category === 'Boston local')).toHaveLength(3);
    expect(new Set(comedyScenarios.map(s => s.id)).size).toBe(33);
  });
});
