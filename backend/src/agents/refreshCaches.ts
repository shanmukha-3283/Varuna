// backend/src/agents/refreshCaches.ts — Laptop B assisted cache refresh.
// Run the morning of the demo (or whenever the IMD bulletin changes) to
// re-stamp the pre-fetched caches with fresh, validated values.
//
// Two modes:
//   1. --check (default with no update flags): live wind cross-check for
//      Visakhapatnam via the open-meteo forecast API (no key). Compares the
//      live model wind against the cached IMD value and reports drift.
//      Clearly labeled as a MODEL CROSS-CHECK — it never overwrites the
//      authoritative IMD cache on its own.
//   2. Manual update: pass the values you read from the latest IMD CWC
//      Visakhapatnam coastal bulletin / fisherman warning, e.g.
//        npx tsx src/agents/refreshCaches.ts --wave 1.5 --wind 32 --warning NIL
//      The script validates with the agents' zod schemas and writes
//      atomically (tmp + rename), stamping fetchedAt=now. --dry-run prints
//      the would-be files without writing. Any validation/network failure
//      leaves the existing caches untouched.
//
// Supported flags:
//   --check | --wave <m> --wind <kmh> --warning <text|NIL> --wave-max <m>
//   --sst <C> --chl <mg/m3> --advisory <YYYY-MM-DD> --valid <YYYY-MM-DD>
//   --dry-run
// Run: npx tsx src/agents/refreshCaches.ts [--check] [...]   (from backend/)
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { MarineCacheSchema } from "./marineData.ts";
import { WeatherCacheSchema } from "./weatherRisk.ts";

const VIZAG = { lat: 17.69, lon: 83.22 };
const DIRS = dirname(fileURLToPath(import.meta.url));
const PFZ_PATH = join(DIRS, "..", "data", "incois_pfz.json");
const WX_PATH = join(DIRS, "..", "data", "imd_weather.json");

function usage(): void {
  console.log(
    "Usage:\n" +
      "  npx tsx src/agents/refreshCaches.ts --check\n" +
      "  npx tsx src/agents/refreshCaches.ts --wave 1.5 --wind 32 --warning NIL [--wave-max 3 --sst 28.6 --chl 1.1 --advisory 2026-09-06 --valid 2026-09-07] [--dry-run]",
  );
}

function getFlag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

function numOrNull(v: string | null): number | null {
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function liveWindCheck(cachedKmh: number): Promise<void> {
  console.log("Live wind cross-check (open-meteo model — cross-check only, never authoritative):");
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), 20_000);
  try {
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${VIZAG.lat}&longitude=${VIZAG.lon}&current=wind_speed_10m&timezone=Asia%2FKolkata`,
      { signal: ctl.signal },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { current?: { wind_speed_10m?: number; time?: string } };
    const live = body.current?.wind_speed_10m;
    if (typeof live !== "number") throw new Error("unexpected response shape");
    const drift = Math.abs(live - cachedKmh);
    console.log(`  live model wind: ${live} km/h @ ${body.current?.time ?? "?"}`);
    console.log(`  cached IMD wind: ${cachedKmh} km/h (drift ${drift.toFixed(1)} km/h)`);
    console.log(
      drift > 15
        ? "  -> drift is large: read the latest IMD bulletin and run a manual update."
        : "  -> drift is small: cache still representative.",
    );
  } catch (err) {
    console.log(`  live check unavailable (${err instanceof Error ? err.message : err}) — cache left untouched.`);
  } finally {
    clearTimeout(t);
  }
}

function atomicWriteJson(path: string, value: unknown): void {
  const text = JSON.stringify(value, null, 2) + "\n";
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, text, "utf-8");
  renameSync(tmp, path);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    usage();
    return;
  }

  const pfzRaw = JSON.parse(readFileSync(PFZ_PATH, "utf-8")) as Record<string, unknown>;
  const wxRaw = JSON.parse(readFileSync(WX_PATH, "utf-8")) as Record<string, unknown>;
  const cachedWind = (wxRaw.windSpeedKmh as number) ?? 0;

  // Manual update values (null = keep cached).
  const wave = numOrNull(getFlag(args, "--wave"));
  const wind = numOrNull(getFlag(args, "--wind"));
  const warning = getFlag(args, "--warning");
  const waveMax = numOrNull(getFlag(args, "--wave-max"));
  const sst = numOrNull(getFlag(args, "--sst"));
  const chl = numOrNull(getFlag(args, "--chl"));
  const advisory = getFlag(args, "--advisory");
  const valid = getFlag(args, "--valid");
  const dryRun = args.includes("--dry-run");
  const hasUpdates =
    wave !== null || wind !== null || warning !== null || waveMax !== null ||
    sst !== null || chl !== null || advisory !== null || valid !== null;

  if (!hasUpdates || args.includes("--check")) {
    await liveWindCheck(cachedWind);
  }
  if (!hasUpdates) {
    console.log("\nNo update flags given — caches untouched. To apply values from the latest IMD bulletin:");
    usage();
    console.log("\nAuthoritative sources: mausam.imd.gov.in/visakhapatnam/mcdata/coastal_bulletin.pdf, Fisherman_warning.pdf");
    return;
  }

  const now = new Date().toISOString();
  const wxNext = {
    ...wxRaw,
    waveHeightM: wave ?? wxRaw.waveHeightM,
    windSpeedKmh: wind ?? wxRaw.windSpeedKmh,
    waveHeightMaxM: waveMax ?? wxRaw.waveHeightMaxM,
    alerts: warning !== null && warning !== "NIL" ? [warning] : [],
    bulletin: {
      ...(wxRaw.bulletin as Record<string, unknown>),
      ...(warning !== null ? { warning } : {}),
    },
    fetchedAt: now,
  };
  const pfzNext = {
    ...pfzRaw,
    sstCelsius: sst ?? pfzRaw.sstCelsius,
    chlorophyll: chl ?? pfzRaw.chlorophyll,
    advisoryDate: advisory ?? pfzRaw.advisoryDate,
    validUpto: valid ?? pfzRaw.validUpto,
    fetchedAt: now,
  };

  // Validate BEFORE touching disk — a bad value must never corrupt the cache.
  const wxParsed = WeatherCacheSchema.safeParse(wxNext);
  const pfzParsed = MarineCacheSchema.safeParse(pfzNext);
  if (!wxParsed.success) {
    console.error("Refusing to write: weather values invalid:", wxParsed.error.issues);
    process.exit(1);
  }
  if (!pfzParsed.success) {
    console.error("Refusing to write: marine values invalid:", pfzParsed.error.issues);
    process.exit(1);
  }

  if (dryRun) {
    console.log("--dry-run: caches NOT written. Would-be fetchedAt:", now);
    console.log("weather:", JSON.stringify({ waveHeightM: wxNext.waveHeightM, windSpeedKmh: wxNext.windSpeedKmh, alerts: wxNext.alerts }));
    console.log("marine:", JSON.stringify({ sstCelsius: pfzNext.sstCelsius, chlorophyll: pfzNext.chlorophyll, advisoryDate: pfzNext.advisoryDate, validUpto: pfzNext.validUpto }));
    return;
  }

  atomicWriteJson(WX_PATH, wxParsed.data);
  atomicWriteJson(PFZ_PATH, pfzParsed.data);
  console.log(`Caches refreshed (fetchedAt=${now}). Run preflight to confirm: npx tsx src/agents/preflight.ts`);
}

main().catch((err) => {
  console.error("Refresh failed — caches untouched:", err);
  process.exit(1);
});
