#!/usr/bin/env tsx

import Anthropic from '@anthropic-ai/sdk';
import * as fs from 'fs/promises';
import * as path from 'path';
import { parse } from 'csv-parse/sync';

const CSV_URL = 'https://www.war.gov/Portals/1/Interactive/2026/UFO/uap-csv.csv';
const OUTPUT_PATH = path.join(process.cwd(), 'data', 'sightings.json');
const API_DELAY_MS = 1200;

const BROWSER_HEADERS: Record<string, string> = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Accept-Encoding': 'gzip, deflate, br',
  'Referer': 'https://www.war.gov/',
  'Sec-Ch-Ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
  'Sec-Fetch-Dest': 'document',
  'Sec-Fetch-Mode': 'navigate',
  'Sec-Fetch-Site': 'same-origin',
};

export interface Sighting {
  title: string | null;
  date: string | null;
  location_name: string | null;
  lat: number | null;
  lng: number | null;
  country: string | null;
  agency: string | null;
  object_description: string | null;
  sensor_type: string | null;
  witness_count: number | null;
  duration_minutes: number | null;
  summary_one_line: string | null;
  confidence_score: number | null;
  source_url: string;
}

type RawRow = Record<string, string>;

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms));
}

// Normalize a column key to lowercase with no separators for fuzzy matching
function norm(s: string): string {
  return s.toLowerCase().replace(/[\s_\-().]/g, '');
}

// Find a value in a row by trying multiple candidate column name spellings
function col(row: RawRow, ...candidates: string[]): string | null {
  const rowKeys = Object.keys(row);
  for (const c of candidates) {
    const key = rowKeys.find(k => norm(k) === norm(c));
    const val = key ? row[key]?.trim() : undefined;
    if (val) return val;
  }
  return null;
}

function toNum(v: string | null): number | null {
  if (!v) return null;
  const n = parseFloat(v);
  return isNaN(n) ? null : n;
}

// Produce a human-readable blob of all row fields for Claude context
function rowToText(row: RawRow): string {
  return Object.entries(row)
    .filter(([, v]) => v?.trim())
    .map(([k, v]) => `${k}: ${v.trim()}`)
    .join('\n');
}

// Map raw CSV columns to Sighting fields using fuzzy column matching.
// Returns null for any field not found — those become enrichment candidates.
function mapRowToPartial(row: RawRow): Omit<Sighting, 'source_url'> {
  return {
    title:              col(row, 'title', 'name', 'incident', 'case'),
    date:               col(row, 'date', 'eventdate', 'incidentdate', 'occurreddate', 'dateofincident'),
    location_name:      col(row, 'locationname', 'location', 'city', 'place', 'site'),
    lat:                toNum(col(row, 'lat', 'latitude')),
    lng:                toNum(col(row, 'lng', 'lon', 'longitude')),
    country:            col(row, 'country', 'nation'),
    agency:             col(row, 'agency', 'reportingagency', 'organization', 'source', 'org'),
    object_description: col(row, 'objectdescription', 'description', 'shape', 'uapshape', 'objectshape'),
    sensor_type:        col(row, 'sensortype', 'sensor', 'detectionmethod', 'method'),
    witness_count:      toNum(col(row, 'witnesscount', 'witnesses', 'numwitnesses', 'numberofwitnesses')),
    duration_minutes:   toNum(col(row, 'durationminutes', 'duration', 'durationmins')),
    summary_one_line:   col(row, 'summaryoneline', 'summary', 'narrative', 'notes', 'remarks'),
    confidence_score:   toNum(col(row, 'confidencescore', 'confidence', 'credibility')),
  };
}

// Fields Claude should fill in when missing
const ENRICHMENT_FIELDS: Array<keyof Omit<Sighting, 'source_url'>> = [
  'summary_one_line',
  'object_description',
  'lat',
  'lng',
  'confidence_score',
];

function needsEnrichment(partial: Omit<Sighting, 'source_url'>): boolean {
  return ENRICHMENT_FIELDS.some(f => partial[f] === null || partial[f] === undefined);
}

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

async function enrichWithClaude(
  partial: Omit<Sighting, 'source_url'>,
  rawText: string,
): Promise<Omit<Sighting, 'source_url'>> {
  const missing = ENRICHMENT_FIELDS.filter(f => partial[f] === null || partial[f] === undefined);

  const locationIsNA =
    !partial.location_name || partial.location_name.trim().toUpperCase() === 'N/A';

  const prompt = `You are analyzing a declassified US government UAP (Unidentified Aerial Phenomenon) sighting record.

Existing structured data extracted from the CSV:
${JSON.stringify(partial, null, 2)}

Full raw record text:
${rawText}

Please provide values for ONLY these missing fields: ${missing.join(', ')}

Field definitions:
- summary_one_line: one concise sentence describing the sighting
- object_description: physical description of the observed object (shape, color, behavior)
- lat: decimal latitude (see location rules below)
- lng: decimal longitude (see location rules below)
- confidence_score: 0.0–1.0, how anomalous and well-evidenced this sighting is (higher = more credible/anomalous)

Location rules for lat/lng:
${locationIsNA
  ? `- The structured location field is "N/A". Carefully read the full raw record text and extract any place name mentioned (city, base, region, body of water, state abbreviation, etc.). For example, if the text says "Oak Ridge, TN" use those coordinates. If you find a location, also set location_name to that inferred place name.
- If no location can be inferred from the text at all, return null for lat, lng, and location_name.`
  : `- Use the location_name field to determine coordinates with your geographic knowledge.
- Only return null for lat/lng if the location is genuinely ambiguous or unknown.`}

Return ONLY a valid JSON object containing exactly the missing fields listed above (plus location_name if you inferred it from text). No explanation, no markdown.`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    messages: [{ role: 'user', content: prompt }],
  });

  const block = message.content[0];
  if (block.type !== 'text') return partial;

  const raw = block.text.replace(/^```(?:json)?\n?/i, '').replace(/\n?```$/, '').trim();
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return partial;

  const enriched = JSON.parse(jsonMatch[0]) as Partial<Omit<Sighting, 'source_url'>>;

  // Merge enriched values back. Also allow location_name to be overwritten when
  // Claude inferred a real place name from text to replace an "N/A" value.
  const result = { ...partial };
  const fieldsToMerge = Array.from(
    new Set([...missing, 'location_name' as keyof Omit<Sighting, 'source_url'>]),
  );
  for (const field of fieldsToMerge) {
    const val = (enriched as Record<string, unknown>)[field];
    if (val !== null && val !== undefined) {
      (result as Record<string, unknown>)[field] = val;
    }
  }
  return result;
}

async function main() {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY environment variable is not set.');
  }

  await fs.mkdir(path.dirname(OUTPUT_PATH), { recursive: true });

  // ── 1. Fetch the CSV ──────────────────────────────────────────────────────
  console.log(`Fetching CSV from ${CSV_URL} ...`);
  const res = await fetch(CSV_URL, { headers: BROWSER_HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching CSV`);
  const csvText = await res.text();
  console.log(`Downloaded ${(csvText.length / 1024).toFixed(1)} KB`);

  // ── 2. Parse CSV ──────────────────────────────────────────────────────────
  const rows: RawRow[] = parse(csvText, {
    columns: true,       // first row is header
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
  });
  console.log(`Parsed ${rows.length} rows, ${Object.keys(rows[0] ?? {}).length} columns`);

  // ── 3. Inspect — log columns + first 3 rows ───────────────────────────────
  console.log('\n── Columns ──');
  console.log(Object.keys(rows[0] ?? {}).join(' | '));
  console.log('\n── First 3 rows ──');
  rows.slice(0, 3).forEach((r, i) => {
    console.log(`\nRow ${i + 1}:`);
    Object.entries(r).forEach(([k, v]) => console.log(`  ${k}: ${v}`));
  });
  console.log('');

  // ── 4 & 5. Map + enrich ───────────────────────────────────────────────────
  const sightings: Sighting[] = [];
  let enrichedCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    console.log(`[${i + 1}/${rows.length}] ${col(row, 'title', 'name', 'incident') ?? `Row ${i + 1}`}`);

    try {
      let partial = mapRowToPartial(row);

      if (needsEnrichment(partial)) {
        const rawText = rowToText(row);
        console.log(`  Enriching via Claude (missing: ${ENRICHMENT_FIELDS.filter(f => partial[f] === null).join(', ')})...`);
        partial = await enrichWithClaude(partial, rawText);
        enrichedCount++;

        if (i < rows.length - 1) await sleep(API_DELAY_MS);
      } else {
        console.log('  All fields present — skipping Claude.');
      }

      const sourceUrl = col(row, 'url', 'sourceurl', 'link', 'documenturl') ?? CSV_URL;
      sightings.push({ ...partial, source_url: sourceUrl });
    } catch (err) {
      console.error(`  Error: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Persist partial results after every row
    await fs.writeFile(OUTPUT_PATH, JSON.stringify(sightings, null, 2));
  }

  // ── 6. Final write ────────────────────────────────────────────────────────
  await fs.writeFile(OUTPUT_PATH, JSON.stringify(sightings, null, 2));
  console.log(`\nDone. ${sightings.length} sightings written to ${OUTPUT_PATH}`);
  console.log(`Claude enrichment used for ${enrichedCount} / ${rows.length} rows.`);
}

main().catch(err => {
  console.error('\nFatal error:', err);
  process.exit(1);
});
