import { describe, expect, it } from 'vitest';
import { detectFormat, guessMapping, mapTable, parseCsv, parseTimestamp, toXrayCsv } from '../csv';

const SAMPLE = `case_id,activity,timestamp,resource,case_type
INV-1001,Received,2026-03-02T09:14:00Z,system,invoice
INV-1001,Check,2026-03-02T11:40:00Z,o.koval,invoice
INV-1002,Received,2026-03-03 08:00,system,invoice
INV-1002,,2026-03-03 09:00,system,invoice
INV-1003,Received,not a date,system,invoice
`;

describe('csv import', () => {
  it('guesses the xray-log columns', () => {
    const t = parseCsv(SAMPLE);
    const m = guessMapping(t);
    expect([m.caseId, m.activity, m.timestamp, m.resource]).toEqual([0, 1, 2, 3]);
  });

  it('guesses Jira-like headers and semicolons', () => {
    const t = parseCsv('Issue key;Status;Changed;Assignee\nABC-1;To Do;02.03.2026 09:14;x\n');
    const m = guessMapping(t);
    expect(t.headers).toEqual(['Issue key', 'Status', 'Changed', 'Assignee']);
    expect([m.caseId, m.activity, m.timestamp, m.resource]).toEqual([0, 1, 2, 3]);
  });

  it('maps rows and reports bad ones with their line number', () => {
    const t = parseCsv(SAMPLE);
    const r = mapTable(t, guessMapping(t));
    expect(r.events).toHaveLength(3);
    expect(r.errors).toEqual([
      { line: 5, message: 'Activity is empty' },
      { line: 6, message: 'Cannot read date “not a date”' },
    ]);
    expect(r.events[0]).toMatchObject({ caseId: 'INV-1001', resource: 'system', attrs: { case_type: 'invoice' } });
    expect(new Date(r.events[2]!.timestamp).toISOString()).toBe('2026-03-03T08:00:00.000Z');
  });

  it('reads common date formats', () => {
    expect(parseTimestamp('02.03.2026 09:14', 'dmy')).toBe(Date.UTC(2026, 2, 2, 9, 14));
    expect(parseTimestamp('03/02/2026 9:14 PM', 'mdy')).toBe(Date.UTC(2026, 2, 2, 21, 14));
    expect(parseTimestamp('2026-03-02T09:14:00+02:00', 'iso')).toBe(Date.UTC(2026, 2, 2, 7, 14));
    expect(parseTimestamp('1772442840', 'epoch-s')).toBe(1772442840000);
    expect(detectFormat(['13/02/2026', '01/03/2026'])).toBe('dmy');
    expect(detectFormat(['02/13/2026', '03/01/2026'])).toBe('mdy');
    expect(detectFormat(['1772442840000'])).toBe('epoch-ms');
  });

  it('round-trips through the xray-log format', () => {
    const t = parseCsv(SAMPLE);
    const { events } = mapTable(t, guessMapping(t));
    const again = parseCsv(toXrayCsv(events));
    expect(mapTable(again, guessMapping(again)).events).toEqual(events);
  });

  it('opens 50,000 rows quickly', () => {
    const lines = ['case_id,activity,timestamp'];
    for (let i = 0; i < 50_000; i++) lines.push(`C${i % 5000},Step ${i % 7},2026-01-01T00:${String(i % 60).padStart(2, '0')}:00Z`);
    const start = performance.now();
    const t = parseCsv(lines.join('\n'));
    const r = mapTable(t, guessMapping(t));
    expect(r.events).toHaveLength(50_000);
    expect(performance.now() - start).toBeLessThan(5000);
  });
});

describe('date detection with broken rows', () => {
  it('still detects the format when some values are bad', () => {
    expect(detectFormat(['02.03.2026 09:14', 'bad', '05.03.2026 10:00'])).toBe('dmy');
    expect(detectFormat(['bad', 'worse'])).toBeNull();
  });
});
