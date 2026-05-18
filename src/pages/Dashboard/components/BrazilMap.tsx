/**
 * BrazilMap — choropleth dos 27 estados brasileiros via SVG inline.
 *
 * Carrega /brazil-states.geojson uma vez, projeta coordenadas com escala
 * linear (Brasil é estreito o suficiente pra Mercator linear funcionar),
 * e pinta cada estado por intensidade do valor da métrica selecionada.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

type UF = string;
type Coord = [number, number];

interface GeoFeature {
  type:       'Feature';
  geometry:   { type: 'Polygon'; coordinates: Coord[][] }
            | { type: 'MultiPolygon'; coordinates: Coord[][][] };
  properties: { name: string; sigla: UF };
}

interface GeoJSON {
  type:     'FeatureCollection';
  features: GeoFeature[];
}

interface Props {
  /** Valor de cada UF; UFs ausentes viram 0 */
  data: Record<UF, number>;
  /** Formatador do valor pro tooltip (ex: n => n.toLocaleString('pt-BR')) */
  formatValue?: (n: number) => string;
  /** Label da métrica pro tooltip (ex: "leads") */
  metricLabel?: string;
}

// Brasil bounds (depois do round pra 1 casa decimal no geojson)
const LON_MIN = -74;
const LON_MAX = -28;
const LAT_MIN = -34;
const LAT_MAX = 6;
const VIEW_W  = 600;
const VIEW_H  = 520;

const project = ([lon, lat]: Coord): Coord => [
  ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * VIEW_W,
  ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * VIEW_H,
];

const ringToPath = (ring: Coord[]) =>
  ring.map((c, i) => {
    const [x, y] = project(c);
    return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`;
  }).join('') + 'Z';

function featureToPath(feat: GeoFeature): string {
  if (feat.geometry.type === 'Polygon') {
    return feat.geometry.coordinates.map(ringToPath).join('');
  }
  return feat.geometry.coordinates
    .flatMap(poly => poly.map(ringToPath))
    .join('');
}

// Cor: interpola de bg escuro (low) pra roxo→laranja (high)
function colorScale(value: number, max: number): string {
  if (max === 0 || value === 0) return '#1f1426'; // bg neutro
  const t = Math.min(value / max, 1);
  // Gradient #2a1635 → #7a3f8f → #e87060
  // Quebra em t=0.5
  if (t < 0.5) {
    const k = t * 2;
    return mix('#2a1635', '#7a3f8f', k);
  } else {
    const k = (t - 0.5) * 2;
    return mix('#7a3f8f', '#e87060', k);
  }
}

function mix(a: string, b: string, t: number): string {
  const ah = parseInt(a.slice(1), 16);
  const bh = parseInt(b.slice(1), 16);
  const ar = (ah >> 16) & 0xff, ag = (ah >> 8) & 0xff, ab = ah & 0xff;
  const br = (bh >> 16) & 0xff, bg = (bh >> 8) & 0xff, bb = bh & 0xff;
  const r = Math.round(ar + (br - ar) * t);
  const g = Math.round(ag + (bg - ag) * t);
  const bl = Math.round(ab + (bb - ab) * t);
  return `#${((r << 16) | (g << 8) | bl).toString(16).padStart(6, '0')}`;
}

export function BrazilMap({ data, formatValue, metricLabel }: Props) {
  const [geo, setGeo] = useState<GeoJSON | null>(null);
  const [hover, setHover] = useState<{ uf: UF; name: string; x: number; y: number } | null>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch('/brazil-states.geojson')
      .then(r => r.json())
      .then((g: GeoJSON) => setGeo(g))
      .catch(() => setGeo(null));
  }, []);

  // Pre-computa paths + max value
  const { paths, max } = useMemo(() => {
    if (!geo) return { paths: [], max: 0 };
    const max = Math.max(0, ...Object.values(data));
    const paths = geo.features.map(f => ({
      uf:   f.properties.sigla,
      name: f.properties.name,
      d:    featureToPath(f),
    }));
    return { paths, max };
  }, [geo, data]);

  const fmt = formatValue || ((n: number) => n.toLocaleString('pt-BR'));

  if (!geo) {
    return (
      <div className="h-96 flex items-center justify-center text-[#d4baeb]/40 text-sm">
        Carregando mapa...
      </div>
    );
  }

  return (
    <div ref={wrapRef} className="relative">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="w-full h-auto"
        style={{ maxHeight: '480px' }}
      >
        {paths.map(p => {
          const value = data[p.uf] || 0;
          const fill  = colorScale(value, max);
          const isHover = hover?.uf === p.uf;
          return (
            <path
              key={p.uf}
              d={p.d}
              fill={fill}
              stroke={isHover ? '#fff' : '#0a0410'}
              strokeWidth={isHover ? 1.2 : 0.5}
              style={{ cursor: 'pointer', transition: 'stroke 0.1s' }}
              onMouseEnter={(e) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (!rect) return;
                setHover({
                  uf:   p.uf,
                  name: p.name,
                  x:    e.clientX - rect.left,
                  y:    e.clientY - rect.top,
                });
              }}
              onMouseMove={(e) => {
                const rect = wrapRef.current?.getBoundingClientRect();
                if (!rect) return;
                setHover(h => h && h.uf === p.uf
                  ? { ...h, x: e.clientX - rect.left, y: e.clientY - rect.top }
                  : h);
              }}
              onMouseLeave={() => setHover(null)}
            />
          );
        })}
      </svg>

      {/* Tooltip */}
      {hover && (
        <div
          className="absolute pointer-events-none z-10 px-2.5 py-1.5 rounded-md bg-black/90 backdrop-blur-sm border border-white/10 text-xs whitespace-nowrap"
          style={{
            left:      hover.x + 12,
            top:       hover.y + 12,
            transform: hover.x > 400 ? 'translateX(-110%)' : undefined,
          }}
        >
          <p className="text-white font-bold">{hover.name} <span className="text-[#c5a3d4]/60 font-normal">({hover.uf})</span></p>
          <p className="text-[#c5a3d4]">
            <span className="tabular-nums font-bold text-white">{fmt(data[hover.uf] || 0)}</span>
            {metricLabel && <span className="text-[#d4baeb]/60"> {metricLabel}</span>}
          </p>
        </div>
      )}

      {/* Legenda de escala */}
      <div className="mt-3 flex items-center gap-3 text-[10px] text-[#c5a3d4]/50">
        <span>0</span>
        <div
          className="flex-1 h-2 rounded"
          style={{
            background: 'linear-gradient(90deg, #1f1426 0%, #2a1635 5%, #7a3f8f 50%, #e87060 100%)',
          }}
        />
        <span className="tabular-nums">{fmt(max)}</span>
      </div>
    </div>
  );
}
