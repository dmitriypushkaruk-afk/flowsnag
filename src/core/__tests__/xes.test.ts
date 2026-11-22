import { describe, expect, it } from 'vitest';
import { looksLikeXes, parseXes } from '../xes';

const XES = `<?xml version="1.0" encoding="UTF-8"?>
<log xes.version="1.0" xmlns="http://www.xes-standard.org/">
  <extension name="Concept" prefix="concept" uri="http://www.xes-standard.org/concept.xesext"/>
  <global scope="event"><string key="concept:name" value="__INVALID__"/></global>
  <classifier name="Activity" keys="concept:name"/>
  <trace>
    <string key="concept:name" value="case 1"/>
    <string key="channel" value="Web &amp; App"/>
    <list key="tags"><values><string key="t" value="ignored"/></values></list>
    <event>
      <string key="concept:name" value="Submit &lt;form&gt;"/>
      <string key="lifecycle:transition" value="start"/>
      <date key="time:timestamp" value="2026-01-01T09:00:00.000+01:00"/>
    </event>
    <event>
      <string key="concept:name" value="Submit &lt;form&gt;"/>
      <string key="lifecycle:transition" value="complete"/>
      <string key="org:resource" value="clerk"/>
      <date key="time:timestamp" value="2026-01-01T09:30:00.000+01:00"/>
    </event>
    <event>
      <string key="concept:name" value="Approve"/>
      <string key="lifecycle:transition" value="complete"/>
      <date key="time:timestamp" value="2026-01-02T10:00:00Z"/>
    </event>
  </trace>
  <trace>
    <event>
      <string key="concept:name" value="Approve"/>
      <string key="lifecycle:transition" value="complete"/>
    </event>
  </trace>
</log>`;

describe('xes import', () => {
  it('recognises XES', () => {
    expect(looksLikeXes(XES)).toBe(true);
    expect(looksLikeXes('case_id,activity,timestamp')).toBe(false);
  });

  it('reads traces, events and trace attributes', () => {
    const r = parseXes(XES);
    expect(r.traces).toBe(2);
    expect(r.skipped).toBe(1); // event without timestamp
    expect(r.events).toEqual([
      { caseId: 'case 1', activity: 'Submit <form>', timestamp: Date.UTC(2026, 0, 1, 8, 30), resource: 'clerk', attrs: { channel: 'Web & App' } },
      { caseId: 'case 1', activity: 'Approve', timestamp: Date.UTC(2026, 0, 2, 10), attrs: { channel: 'Web & App' } },
    ]);
  });

  it('keeps all events when there is no lifecycle', () => {
    const r = parseXes(`<log><trace><string key="concept:name" value="x"/>
      <event><string key="concept:name" value="A"/><date key="time:timestamp" value="2026-01-01T00:00:00Z"/></event>
      <event><string key="concept:name" value="B"/><date key="time:timestamp" value="2026-01-01T01:00:00Z"/></event>
    </trace></log>`);
    expect(r.events.map((e) => e.activity)).toEqual(['A', 'B']);
  });
});
