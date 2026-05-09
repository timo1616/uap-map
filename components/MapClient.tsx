'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { MapContainer, TileLayer, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import type { Sighting } from '@/lib/scraper';

// Suppress broken-image console error — we never render the default Leaflet marker
// eslint-disable-next-line @typescript-eslint/no-explicit-any
delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({ iconUrl: '', iconRetinaUrl: '', shadowUrl: '' });

// ─── Constants ───────────────────────────────────────────────────────────────

const TILE_URL = 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const TILE_ATTR =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const AGENCIES = ['DoD', 'FBI', 'NASA', 'Other'] as const;
type AgencyKey = (typeof AGENCIES)[number];

const AGENCY_CONFIG: Record<AgencyKey, { color: string }> = {
  DoD:   { color: '#3b82f6' },
  FBI:   { color: '#ef4444' },
  NASA:  { color: '#eab308' },
  Other: { color: '#e2e8f0' },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function classifyAgency(agency: string | null): AgencyKey {
  if (!agency) return 'Other';
  const u = agency.toUpperCase();
  if (u.includes('FBI') || u.includes('FEDERAL BUREAU')) return 'FBI';
  if (u.includes('NASA')) return 'NASA';
  if (
    u.includes('DOD') || u.includes('DEPARTMENT OF DEFENSE') ||
    u.includes('DEPARTMENT OF WAR') || u.includes('WAR') ||
    u.includes('NAVY') || u.includes('ARMY') || u.includes('USAF') ||
    u.includes('AIR FORCE') || u.includes('DIA') || u.includes('NRO') ||
    u.includes('NORAD') || u.includes('DEFENSE') || u.includes('PENTAGON') ||
    u.includes('MILITARY') || u.includes('COAST GUARD')
  ) return 'DoD';
  return 'Other';
}

function parseYear(date: string | null | undefined): number | null {
  if (!date || date === 'N/A') return null;
  const y = new Date(date).getFullYear();
  return isNaN(y) ? null : y;
}

// ─── MapFlyTo ─────────────────────────────────────────────────────────────────

function MapFlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  useEffect(() => {
    if (target) map.flyTo(target, Math.max(map.getZoom(), 5), { animate: true, duration: 1.2 });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, target?.[0], target?.[1]]);
  return null;
}

// ─── ClusterLayer ─────────────────────────────────────────────────────────────

function ClusterLayer({
  displayed,
  setSelected,
}: {
  displayed: Sighting[];
  setSelected: (s: Sighting | null) => void;
}) {
  const map = useMap();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cluster: any = (L as any).markerClusterGroup({
      showCoverageOnHover: false,
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      animate: true,
      chunkedLoading: true,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      iconCreateFunction: (c: any) => {
        const count = c.getChildCount() as number;
        const size = count > 100 ? 52 : count > 30 ? 44 : 36;
        const fs = size < 40 ? 11 : 13;
        return L.divIcon({
          html: `<div class="uap-cluster" style="width:${size}px;height:${size}px;font-size:${fs}px">${count}</div>`,
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    displayed.forEach(s => {
      const { color } = AGENCY_CONFIG[classifyAgency(s.agency)];
      const marker = L.circleMarker([s.lat!, s.lng!], {
        radius: 6,
        fillColor: color,
        color: color,
        weight: 2,
        opacity: 0.9,
        fillOpacity: 0.75,
      });
      marker.on('click', (e: L.LeafletMouseEvent) => {
        L.DomEvent.stopPropagation(e);
        setSelected(s);
      });
      cluster.addLayer(marker);
    });

    map.addLayer(cluster);
    return () => { map.removeLayer(cluster); };
  }, [map, displayed, setSelected]);

  return null;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function MapClickHandler({ onMapClick }: { onMapClick: () => void }) {
  useMapEvents({ click: onMapClick });
  return null;
}

function RangeSlider({
  min, max, value, onChange, disabled,
}: {
  min: number; max: number; value: [number, number];
  onChange: (v: [number, number]) => void; disabled: boolean;
}) {
  const [lo, hi] = value;
  const span = max - min || 1;
  const pLo = ((lo - min) / span) * 100;
  const pHi = ((hi - min) / span) * 100;

  return (
    <div className="uap-slider">
      <div className="uap-slider__track">
        <div
          className="uap-slider__fill"
          style={{ left: `${pLo}%`, right: `${100 - pHi}%`, opacity: disabled ? 0.15 : 1 }}
        />
      </div>
      <input
        type="range" min={min} max={max} value={lo} disabled={disabled}
        className="uap-slider__input"
        onChange={e => onChange([Math.min(Number(e.target.value), hi - 1), hi])}
      />
      <input
        type="range" min={min} max={max} value={hi} disabled={disabled}
        className="uap-slider__input"
        onChange={e => onChange([lo, Math.max(Number(e.target.value), lo + 1)])}
      />
    </div>
  );
}

function Field({ label, value, highlight }: {
  label: string; value?: string | null; highlight?: boolean;
}) {
  return (
    <div className="uap-field">
      <span className="uap-field__label">{label}</span>
      <span className={`uap-field__value${highlight ? ' uap-field__value--highlight' : ''}`}>
        {value || '—'}
      </span>
    </div>
  );
}

function Sidebar({ sighting, onClose }: {
  sighting: Sighting | null; onClose: () => void;
}) {
  const agencyKey = sighting ? classifyAgency(sighting.agency) : null;
  const agencyColor = agencyKey ? AGENCY_CONFIG[agencyKey].color : undefined;

  return (
    <aside className={`uap-sidebar${sighting ? ' uap-sidebar--open' : ''}`}>
      {sighting && (
        <>
          <div className="uap-sidebar__header">
            <span className="uap-sidebar__stamp">DECLASSIFIED // UAP RECORD</span>
            <button className="uap-sidebar__close" onClick={onClose} aria-label="Close panel">
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                <path d="M1 1L11 11M11 1L1 11" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </button>
          </div>

          <div className="uap-sidebar__content">
            <h2 className="uap-sidebar__title">{sighting.title ?? '[UNTITLED INCIDENT]'}</h2>

            <div className="uap-field-grid">
              <Field label="DATE" value={sighting.date !== 'N/A' ? sighting.date : null} />
              <Field label="AGENCY" value={sighting.agency} highlight />
              <Field label="LOCATION" value={sighting.location_name !== 'N/A' ? sighting.location_name : null} />
              <Field label="COUNTRY" value={sighting.country} />
              <Field label="SENSOR TYPE" value={sighting.sensor_type} />
              <Field label="WITNESSES" value={sighting.witness_count?.toString()} />
              <Field
                label="DURATION"
                value={sighting.duration_minutes != null ? `${sighting.duration_minutes} MIN` : null}
              />
              <Field
                label="ANOMALY SCORE"
                value={sighting.confidence_score != null
                  ? `${(sighting.confidence_score * 100).toFixed(0)}%`
                  : null}
                highlight
              />
            </div>

            {sighting.object_description && (
              <div className="uap-sidebar__section">
                <div className="uap-sidebar__section-label">OBJECT DESCRIPTION</div>
                <p className="uap-sidebar__text">{sighting.object_description}</p>
              </div>
            )}

            {sighting.summary_one_line && (
              <div className="uap-sidebar__section">
                <div className="uap-sidebar__section-label">SUMMARY</div>
                <p className="uap-sidebar__text uap-sidebar__text--summary">
                  {sighting.summary_one_line}
                </p>
              </div>
            )}

            {sighting.source_url && (
              <a
                href={sighting.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="uap-source-link"
                style={{ '--agency-color': agencyColor } as React.CSSProperties}
              >
                VIEW SOURCE DOCUMENT →
              </a>
            )}
          </div>
        </>
      )}
    </aside>
  );
}

function MostAnomalous({
  sightings,
  onSelect,
}: {
  sightings: Sighting[];
  onSelect: (s: Sighting) => void;
}) {
  const [open, setOpen] = useState(false);

  const top5 = useMemo(() =>
    [...sightings]
      .filter(s => s.confidence_score != null && s.lat != null)
      .sort((a, b) => (b.confidence_score ?? 0) - (a.confidence_score ?? 0))
      .slice(0, 5),
    [sightings],
  );

  return (
    <div className="uap-anomalous">
      {open && (
        <div className="uap-anomalous__panel">
          <div className="uap-anomalous__panel-header">
            <span>TOP ANOMALOUS INCIDENTS</span>
            <button className="uap-anomalous__panel-close" onClick={() => setOpen(false)}>×</button>
          </div>
          {top5.map((s, i) => (
            <button
              key={i}
              className="uap-anomalous__entry"
              onClick={() => { onSelect(s); setOpen(false); }}
            >
              <div className="uap-anomalous__entry-rank">{String(i + 1).padStart(2, '0')}</div>
              <div className="uap-anomalous__entry-body">
                <div className="uap-anomalous__entry-title">{s.title ?? '[UNTITLED]'}</div>
                <div className="uap-anomalous__entry-meta">
                  {[
                    s.location_name && s.location_name !== 'N/A' ? s.location_name : null,
                    s.agency,
                    s.date && s.date !== 'N/A' ? s.date : null,
                  ].filter(Boolean).join(' · ')}
                </div>
                {s.summary_one_line && (
                  <div className="uap-anomalous__entry-summary">{s.summary_one_line}</div>
                )}
              </div>
              <div className="uap-anomalous__entry-score">
                {((s.confidence_score ?? 0) * 100).toFixed(0)}%
              </div>
            </button>
          ))}
        </div>
      )}
      <button
        className={`uap-anomalous__btn${open ? ' uap-anomalous__btn--active' : ''}`}
        onClick={() => setOpen(v => !v)}
        title="Most anomalous incidents"
      >
        ⚠ MOST ANOMALOUS
      </button>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MapClient({ sightings }: { sightings: Sighting[] }) {
  const [selected, setSelected] = useState<Sighting | null>(null);
  const [flyTarget, setFlyTarget] = useState<[number, number] | null>(null);
  const [enabledAgencies, setEnabledAgencies] = useState<Set<AgencyKey>>(new Set(AGENCIES));
  const [showAll, setShowAll] = useState(true);

  const { minYear, maxYear } = useMemo(() => {
    const years = sightings
      .map(s => parseYear(s.date))
      .filter((y): y is number => y !== null);
    if (!years.length) return { minYear: 1947, maxYear: new Date().getFullYear() };
    return { minYear: Math.min(...years), maxYear: Math.max(...years) };
  }, [sightings]);

  const [yearRange, setYearRange] = useState<[number, number]>([1947, 2025]);
  useEffect(() => { setYearRange([minYear, maxYear]); }, [minYear, maxYear]);

  const withCoords = useMemo(
    () => sightings.filter(s => s.lat != null && s.lng != null),
    [sightings],
  );

  const displayed = useMemo(() => {
    return withCoords.filter(s => {
      if (!enabledAgencies.has(classifyAgency(s.agency))) return false;
      if (!showAll) {
        const y = parseYear(s.date);
        if (y !== null && (y < yearRange[0] || y > yearRange[1])) return false;
      }
      return true;
    });
  }, [withCoords, enabledAgencies, showAll, yearRange]);

  const handleSelect = useCallback((s: Sighting | null) => {
    setSelected(s);
    if (s?.lat != null && s?.lng != null) setFlyTarget([s.lat, s.lng]);
    const url = s?.title
      ? `?id=${encodeURIComponent(s.title)}`
      : window.location.pathname;
    window.history.replaceState({}, '', url);
  }, []);

  // On mount, restore selected sighting from ?id= URL param
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get('id');
    if (!id) return;
    const match = sightings.find(s => s.title === decodeURIComponent(id));
    if (match) {
      setSelected(match);
      if (match.lat != null && match.lng != null) setFlyTarget([match.lat, match.lng]);
    }
  }, [sightings]);

  const toggleAgency = useCallback((a: AgencyKey) => {
    setEnabledAgencies(prev => {
      const next = new Set(prev);
      if (next.has(a)) {
        if (next.size === 1) return prev;
        next.delete(a);
      } else {
        next.add(a);
      }
      return next;
    });
  }, []);

  const handleMapClick = useCallback(() => {
    setSelected(null);
    window.history.replaceState({}, '', window.location.pathname);
  }, []);

  return (
    <div className="uap-shell">

      {/* ── Top bar ── */}
      <header className="uap-topbar">
        <div className="uap-counter">
          <span className="uap-counter__num">{displayed.length}</span>
          <span className="uap-counter__sep"> / </span>
          <span className="uap-counter__total">{withCoords.length}</span>
          <span className="uap-counter__label"> WITH COORDINATES</span>
          <span className="uap-badge">NEW FILES DROP SOON</span>
        </div>

        <nav className="uap-filters" aria-label="Filter by agency">
          {AGENCIES.map(a => (
            <button
              key={a}
              className={`uap-filter-btn${enabledAgencies.has(a) ? ' uap-filter-btn--active' : ''}`}
              style={{ '--agency-color': AGENCY_CONFIG[a].color } as React.CSSProperties}
              onClick={() => toggleAgency(a)}
              aria-pressed={enabledAgencies.has(a)}
            >
              <span className="uap-filter-btn__dot" style={{ background: AGENCY_CONFIG[a].color }} />
              {a}
            </button>
          ))}
        </nav>
      </header>

      {/* ── Map + Sidebar + Most Anomalous ── */}
      <div className="uap-map-area" style={{ height: 'calc(100dvh - 100px)' }}>
        <MapContainer
          center={[30, -10]}
          zoom={2}
          style={{ width: '100%', height: 'calc(100dvh - 100px)' }}
          zoomControl={true}
          attributionControl={true}
        >
          <TileLayer
            url={TILE_URL}
            attribution={TILE_ATTR}
            maxZoom={19}
            subdomains="abcd"
          />
          <MapClickHandler onMapClick={handleMapClick} />
          <ClusterLayer displayed={displayed} setSelected={handleSelect} />
          <MapFlyTo target={flyTarget} />
        </MapContainer>

        <Sidebar sighting={selected} onClose={() => handleSelect(null)} />
        <MostAnomalous sightings={sightings} onSelect={handleSelect} />
      </div>

      {/* ── Timeline ── */}
      <footer className="uap-timeline">
        <div className="uap-timeline__inner">
          <button
            className={`uap-all-btn${showAll ? ' uap-all-btn--active' : ''}`}
            onClick={() => setShowAll(v => !v)}
          >
            ALL DATES
          </button>

          <div className="uap-timeline__range">
            <span className="uap-timeline__year">{showAll ? minYear : yearRange[0]}</span>
            <RangeSlider
              min={minYear}
              max={maxYear}
              value={yearRange}
              onChange={setYearRange}
              disabled={showAll}
            />
            <span className="uap-timeline__year">{showAll ? maxYear : yearRange[1]}</span>
          </div>
        </div>

        <p className="uap-donate">
          Support this project · SOL: FPQHHJ8Q8aC5V6XL5WD9gtoL4WAyhLMByWxSEsEw1Lbn
        </p>
      </footer>

    </div>
  );
}
