import dagre from '@dagrejs/dagre';
import { forwardRef, useMemo } from 'react';
import type { ProcessMap as MapData } from '../core/analyze';
import { formatDuration } from '../core/stats';
import { END, START } from '../core/types';

export interface Highlight {
  node?: string;
  edge?: [string, string];
}

interface Props {
  map: MapData;
  highlight: Highlight | null;
  onSelectNode?: (id: string) => void;
}

const NODE_W = 190;
const NODE_H = 56;
const TERMINAL = 28;

interface Laid {
  width: number;
  height: number;
  nodes: { id: string; x: number; y: number; w: number; h: number }[];
  edges: { from: string; to: string; points: { x: number; y: number }[]; label?: { x: number; y: number } }[];
}

function layout(map: MapData): Laid {
  const g = new dagre.graphlib.Graph({ multigraph: false });
  g.setGraph({ rankdir: 'TB', nodesep: 60, ranksep: 64, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const ids = new Set(map.nodes.map((n) => n.id));
  const hasStart = map.edges.some((e) => e.from === START);
  const hasEnd = map.edges.some((e) => e.to === END);
  if (hasStart) g.setNode(START, { width: TERMINAL, height: TERMINAL });
  if (hasEnd) g.setNode(END, { width: TERMINAL, height: TERMINAL });
  for (const id of ids) g.setNode(id, { width: NODE_W, height: NODE_H });
  for (const e of map.edges) {
    if (e.from === e.to) continue; // self-loops are drawn by hand
    g.setEdge(e.from, e.to, { width: 90, height: 18, labelpos: 'r' });
  }
  dagre.layout(g);
  const graph = g.graph();
  return {
    width: graph.width ?? 400,
    height: graph.height ?? 300,
    nodes: g.nodes().map((id) => {
      const n = g.node(id);
      return { id, x: n.x, y: n.y, w: n.width, h: n.height };
    }),
    edges: g.edges().map((e) => {
      const d = g.edge(e);
      return { from: e.v, to: e.w, points: d.points ?? [], label: d.x !== undefined && d.y !== undefined ? { x: d.x, y: d.y } : undefined };
    }),
  };
}

function path(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  const [first, ...rest] = points;
  if (rest.length === 0) return `M${first!.x},${first!.y}`;
  // Smooth curve through dagre's points.
  let d = `M${first!.x},${first!.y}`;
  for (let i = 0; i < rest.length; i++) {
    const p = rest[i]!;
    const prev = points[i]!;
    const mx = (prev.x + p.x) / 2;
    const my = (prev.y + p.y) / 2;
    d += i === rest.length - 1 ? ` Q${prev.x},${prev.y} ${p.x},${p.y}` : ` Q${prev.x},${prev.y} ${mx},${my}`;
  }
  return d;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * Map waiting time to a colour from calm to hot. Computed as plain rgb() (not CSS color-mix)
 * so an exported SVG looks the same in any viewer. Follows the current theme's tokens.
 */
function heatScale(): (share: number) => string {
  const root = typeof document !== 'undefined' ? getComputedStyle(document.documentElement) : null;
  const cold = hexToRgb(root?.getPropertyValue('--heat-cold') ?? '') ?? [238, 246, 244];
  const hot = hexToRgb(root?.getPropertyValue('--heat-hot') ?? '') ?? [245, 158, 11];
  return (share) => {
    const s = Math.max(0, Math.min(1, share));
    const c = cold.map((v, i) => Math.round(v + (hot[i]! - v) * s));
    return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
  };
}

export const ProcessMap = forwardRef<SVGSVGElement, Props>(function ProcessMap({ map, highlight, onSelectNode }, ref) {
  const laid = useMemo(() => layout(map), [map]);
  const heat = heatScale();
  const byId = new Map(map.nodes.map((n) => [n.id, n]));
  const maxMedian = Math.max(1, ...map.nodes.map((n) => n.time?.medianMs ?? 0));
  const maxCount = Math.max(1, ...map.edges.map((e) => e.count));
  const edgeData = new Map(map.edges.map((e) => [`${e.from}\u001f${e.to}`, e]));
  const pos = new Map(laid.nodes.map((n) => [n.id, n]));
  const isHi = (from: string, to: string) => highlight?.edge?.[0] === from && highlight.edge[1] === to;

  return (
    <svg
      ref={ref}
      className="map"
      viewBox={`0 0 ${laid.width} ${laid.height}`}
      width={laid.width}
      role="img"
      aria-label="Process map"
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--edge)" />
        </marker>
        <marker id="arrow-hi" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="12" markerHeight="12" orient="auto-start-reverse">
          <path d="M0,0 L10,5 L0,10 z" fill="var(--accent)" />
        </marker>
      </defs>

      {laid.edges.map((e) => {
        const data = edgeData.get(`${e.from}\u001f${e.to}`);
        if (!data) return null;
        const hi = isHi(e.from, e.to);
        const w = 1 + 7 * Math.sqrt(data.count / maxCount);
        const mid = e.label ? { x: e.label.x - 45, y: e.label.y } : e.points[Math.floor(e.points.length / 2)];
        const terminal = e.from === START || e.to === END;
        return (
          <g key={`${e.from}->${e.to}`} className={hi ? 'edge hi' : 'edge'}>
            <path d={path(e.points)} fill="none" strokeWidth={w} markerEnd={`url(#${hi ? 'arrow-hi' : 'arrow'})`} />
            {mid && (
              <text x={mid.x + 8} y={mid.y} className="edge-label" dominantBaseline="middle">
                {data.count}
                {!terminal && data.time.medianMs > 0 ? ` · ${formatDuration(data.time.medianMs)}` : ''}
              </text>
            )}
          </g>
        );
      })}

      {map.edges
        .filter((e) => e.from === e.to)
        .map((e) => {
          const p = pos.get(e.from);
          if (!p) return null;
          const x = p.x + p.w / 2;
          const y = p.y;
          return (
            <g key={`loop-${e.from}`} className={isHi(e.from, e.to) ? 'edge hi' : 'edge'}>
              <path d={`M${x},${y - 10} C${x + 40},${y - 30} ${x + 40},${y + 30} ${x},${y + 10}`} fill="none" strokeWidth={1.5} markerEnd="url(#arrow)" />
              <text x={x + 36} y={y} className="edge-label">{e.count}</text>
            </g>
          );
        })}

      {laid.nodes.map((n) => {
        if (n.id === START || n.id === END) {
          return (
            <g key={n.id} className="terminal">
              <circle cx={n.x} cy={n.y} r={TERMINAL / 2} />
              <title>{n.id === START ? 'Start' : 'End'}</title>
            </g>
          );
        }
        const data = byId.get(n.id)!;
        const hi = highlight?.node === n.id || highlight?.edge?.includes(n.id);
        const median = data.time?.medianMs ?? 0;
        return (
          <g
            key={n.id}
            className={hi ? 'node hi' : 'node'}
            transform={`translate(${n.x - n.w / 2},${n.y - n.h / 2})`}
            onClick={() => onSelectNode?.(n.id)}
          >
            <rect width={n.w} height={n.h} rx={10} style={{ fill: heat(median / maxMedian) }} />
            <text x={n.w / 2} y={23} textAnchor="middle" className="node-title">
              {n.id.length > 22 ? `${n.id.slice(0, 21)}…` : n.id}
            </text>
            <text x={n.w / 2} y={42} textAnchor="middle" className="node-sub">
              {data.count}× {median > 0 ? `· median ${formatDuration(median)}` : ''}
            </text>
            <title>
              {n.id}: reached {data.count} times by {data.caseCount} cases
              {data.time ? `. Median ${formatDuration(data.time.medianMs)}, P90 ${formatDuration(data.time.p90Ms)}` : ''}
            </title>
          </g>
        );
      })}
    </svg>
  );
});
