import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cleanChange, readAnswers, writeAnswer } from '../../server/answers';
import { handleApi } from '../../server/api';

const file = () => join(mkdtempSync(join(tmpdir(), 'answers-')), 'settings.json');

describe('answers to the questions', () => {
  it('accepts yes, no and taking back – nothing else', () => {
    expect(cleanChange({ id: 'gap-Wechselrichter-1', answer: 'yes' })).toEqual({
      id: 'gap-Wechselrichter-1',
      answer: 'yes',
    });
    expect(cleanChange({ id: 'x', answer: null })).toEqual({ id: 'x', answer: null });
    expect(cleanChange({ id: 'x', answer: 'maybe' })).toBeNull();
    expect(cleanChange({ id: '', answer: 'yes' })).toBeNull();
    expect(cleanChange({ id: 'a\nb', answer: 'yes' })).toBeNull();
    expect(cleanChange({ id: 'x'.repeat(161), answer: 'yes' })).toBeNull();
  });

  it('writes next to the tabs without touching them, and takes answers back', () => {
    const path = file();
    writeFileSync(path, JSON.stringify({ tabs: { hidden: ['week'], order: [] } }));
    writeAnswer(path, { id: 'q1', answer: 'yes' }, 1000);
    writeAnswer(path, { id: 'q2', answer: 'no' }, 2000);
    expect(readAnswers(path)).toEqual({ q1: { a: 'yes', at: 1000 }, q2: { a: 'no', at: 2000 } });
    writeAnswer(path, { id: 'q1', answer: null });
    expect(Object.keys(readAnswers(path))).toEqual(['q2']);
    expect(JSON.parse(readFileSync(path, 'utf8')).tabs).toEqual({ hidden: ['week'], order: [] });
    expect((statSync(path).mode & 0o777).toString(8)).toBe('600');
  });

  it('keeps only the newest 500', () => {
    const path = file();
    for (let i = 0; i < 503; i++) writeAnswer(path, { id: `q${i}`, answer: 'yes' }, i);
    const a = readAnswers(path);
    expect(Object.keys(a)).toHaveLength(500);
    expect(a.q0).toBeUndefined();
    expect(a.q502).toBeDefined();
  });
});

describe('/api/answers', () => {
  const same = {
    origin: 'http://h:1',
    host: 'h:1',
    fetchSite: 'same-origin',
    contentType: 'application/json',
  };
  const deps = (writable = true) => {
    const path = file();
    return {
      mode: 'demo' as const,
      now: Date.now,
      log: () => {},
      answers: {
        writable,
        read: () => readAnswers(path),
        write: (c: Parameters<typeof writeAnswer>[1]) => writeAnswer(path, c),
      },
    };
  };
  const url = new URL('http://h:1/api/answers');

  it('saves from the page itself only', async () => {
    const d = deps();
    const body = JSON.stringify({ id: 'q1', answer: 'no' });
    expect((await handleApi('POST', url, d, { ...same, body })).status).toBe(200);
    expect(d.answers.read().q1?.a).toBe('no');
    expect((await handleApi('POST', url, d, { ...same, origin: 'http://evil', body })).status).toBe(
      403,
    );
    expect((await handleApi('POST', url, d, { ...same, body: '{"id":1}' })).status).toBe(400);
    const got = await handleApi('GET', url, d);
    expect((got.body as { writable: boolean }).writable).toBe(true);
  });

  it('refuses writes when switched off', async () => {
    const body = JSON.stringify({ id: 'q1', answer: 'yes' });
    expect((await handleApi('POST', url, deps(false), { ...same, body })).status).toBe(403);
  });
});
