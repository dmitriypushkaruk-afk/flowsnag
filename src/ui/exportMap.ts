/**
 * Export the on-screen process map as a self-contained SVG or PNG.
 * The live map is styled by CSS variables and classes; for a file we copy the computed
 * styles onto each element, add a background, a title and a legend.
 */

const STYLE_PROPS = [
  'fill',
  'stroke',
  'stroke-width',
  'opacity',
  'font-size',
  'font-weight',
  'font-family',
  'paint-order',
  'dominant-baseline',
  'text-anchor',
] as const;

const FOOTER_H = 64;

function inlineStyles(source: Element, target: Element) {
  const cs = getComputedStyle(source);
  const style = STYLE_PROPS.map((p) => `${p}:${cs.getPropertyValue(p)}`).join(';');
  target.setAttribute('style', style);
  const s = source.children;
  const t = target.children;
  for (let i = 0; i < s.length; i++) inlineStyles(s[i]!, t[i]!);
}

export interface ExportInfo {
  title: string;
  subtitle: string;
}

export function buildExportSvg(svg: SVGSVGElement, info: ExportInfo): { markup: string; width: number; height: number } {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  inlineStyles(svg, clone);
  const vb = svg.viewBox.baseVal;
  const pad = 24;
  const width = Math.max(vb.width + pad * 2, 520);
  const headerH = 56;
  const height = vb.height + headerH + FOOTER_H;
  const rootStyle = getComputedStyle(document.documentElement);
  const bg = rootStyle.getPropertyValue('--surface').trim() || '#ffffff';
  const text = rootStyle.getPropertyValue('--text').trim() || '#1c1d1f';
  const muted = rootStyle.getPropertyValue('--muted').trim() || '#62656b';
  const cold = rootStyle.getPropertyValue('--heat-cold').trim();
  const hot = rootStyle.getPropertyValue('--heat-hot').trim();
  const font = getComputedStyle(document.body).fontFamily.replace(/"/g, "'");
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  // Marker paths use CSS variables too.
  clone.querySelectorAll('marker path').forEach((p, i) => {
    const live = svg.querySelectorAll('marker path')[i];
    if (live) p.setAttribute('fill', getComputedStyle(live).fill);
  });
  clone.removeAttribute('width');
  clone.removeAttribute('class');
  clone.setAttribute('x', String((width - vb.width) / 2));
  clone.setAttribute('y', String(headerH));
  clone.setAttribute('width', String(vb.width));
  clone.setAttribute('height', String(vb.height));

  const legendY = headerH + vb.height + 28;
  const markup = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" font-family="${font}">
<rect width="100%" height="100%" fill="${bg}"/>
<text x="${pad}" y="30" font-size="18" font-weight="700" fill="${text}">${esc(info.title)}</text>
<text x="${pad}" y="48" font-size="12" fill="${muted}">${esc(info.subtitle)}</text>
${new XMLSerializer().serializeToString(clone)}
<defs><linearGradient id="heat-legend"><stop offset="0" stop-color="${cold}"/><stop offset="1" stop-color="${hot}"/></linearGradient></defs>
<rect x="${pad}" y="${legendY - 10}" width="60" height="12" rx="3" fill="url(#heat-legend)"/>
<text x="${pad + 68}" y="${legendY}" font-size="11" fill="${muted}">median time in step (short → long) · arrow width = number of cases · label = cases · median time</text>
<text x="${pad}" y="${legendY + 22}" font-size="11" fill="${muted}">Made with FlowSnag · flowsnag.app</text>
</svg>`;
  return { markup, width, height };
}

function download(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
      .slice(0, 60) || 'process'
  );
}

export function exportSvg(svg: SVGSVGElement, info: ExportInfo) {
  const { markup } = buildExportSvg(svg, info);
  download(new Blob([markup], { type: 'image/svg+xml' }), `${slug(info.title)}-map.svg`);
}

export async function exportPng(svg: SVGSVGElement, info: ExportInfo, scale = 2) {
  const { markup, width, height } = buildExportSvg(svg, info);
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }));
  try {
    const img = new Image();
    img.decoding = 'async';
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
    if (!blob) throw new Error('PNG export failed');
    download(blob, `${slug(info.title)}-map.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
