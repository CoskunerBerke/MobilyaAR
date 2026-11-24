import * as THREE from 'three';
import type { SolarSeason, SunConfig } from './types';

export interface SolarComputation {
  elevationDeg: number;
  azimuthDeg: number;
  isNight: boolean;
  /** Direction vector pointing FROM room origin TO sun (unit length) */
  sunDirWorld: THREE.Vector3;
  /** Light position in world space (e.g. radius 18m from room center) */
  sunPosition: THREE.Vector3;
  sunColor: THREE.Color;
  skyColor: THREE.Color;
  groundColor: THREE.Color;
  effectiveSunIntensity: number;
  effectiveHemiIntensity: number;
  backgroundHex: number;
  formattedTime: string;
  compassLabel: string;
}

const SEASON_DECLINATION_DEG: Record<SolarSeason, number> = {
  summer: 23.44,
  equinox: 0,
  winter: -23.44,
};

export function formatSolarHour(hour: number): string {
  const clamped = Math.max(0, Math.min(23.99, hour));
  const h = Math.floor(clamped);
  const m = Math.round((clamped - h) * 60);
  const fh = m === 60 ? (h + 1) % 24 : h;
  const fm = m === 60 ? 0 : m;
  return `${String(fh).padStart(2, '0')}:${String(fm).padStart(2, '0')}`;
}

export function bearingToCompassLabel(deg: number): string {
  const n = ((deg % 360) + 360) % 360;
  const dirs = [
    'Kuzey (K)',
    'Kuzeydoğu (KD)',
    'Doğu (D)',
    'Güneydoğu (GD)',
    'Güney (G)',
    'Güneybatı (GB)',
    'Batı (B)',
    'Kuzeybatı (KB)',
  ];
  return dirs[Math.round(n / 45) % 8];
}

export function bearingToShortCode(deg: number): string {
  const n = ((deg % 360) + 360) % 360;
  const dirs = ['K', 'KD', 'D', 'GD', 'G', 'GB', 'B', 'KB'];
  return dirs[Math.round(n / 45) % 8];
}

/**
 * Computes physical solar elevation & azimuth for Turkey latitude (41°N)
 * and maps it to room-local 3D coordinates based on the room's compass bearing.
 */
export function computeSolarLighting(sun: SunConfig, latitudeDeg = 41.0): SolarComputation {
  const deg2rad = Math.PI / 180;
  const rad2deg = 180 / Math.PI;

  const lat = latitudeDeg * deg2rad;
  const dec = SEASON_DECLINATION_DEG[sun.season] * deg2rad;
  const hourAngleDeg = (sun.hour - 12.0) * 15.0;
  const ha = hourAngleDeg * deg2rad;

  const sinEl = Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha);
  const clampedSinEl = Math.max(-1, Math.min(1, sinEl));
  const elevationRad = Math.asin(clampedSinEl);
  const elevationDeg = elevationRad * rad2deg;

  const cosEl = Math.max(1e-5, Math.cos(elevationRad));
  const cosAzRaw = (Math.sin(dec) - Math.sin(lat) * Math.sin(elevationRad)) / (Math.cos(lat) * cosEl);
  const cosAz = Math.max(-1, Math.min(1, cosAzRaw));
  let azimuthDeg = Math.acos(cosAz) * rad2deg;
  if (hourAngleDeg > 0) {
    azimuthDeg = 360 - azimuthDeg;
  }

  // Relative azimuth in room space: room -Z wall faces sun.northAngleDeg
  const relAzRad = (azimuthDeg - sun.northAngleDeg) * deg2rad;
  const safeElRad = Math.max(0.06, elevationRad);
  const rHoriz = Math.cos(safeElRad);

  const sunDirWorld = new THREE.Vector3(
    Math.sin(relAzRad) * rHoriz,
    Math.sin(safeElRad),
    -Math.cos(relAzRad) * rHoriz
  ).normalize();

  const sunPosition = sunDirWorld.clone().multiplyScalar(18);

  const isNight = elevationDeg <= 2.5;
  const dayFactor = Math.max(0, Math.min(1, (elevationDeg - 2) / 28));
  const goldenFactor = Math.max(0, Math.min(1, 1 - Math.abs(elevationDeg - 12) / 16));

  // Color temperature interpolation: night blue -> golden hour warm amber -> crisp midday sun
  const sunColor = new THREE.Color();
  if (isNight) {
    sunColor.setHex(0x8ba8d6);
  } else {
    const golden = new THREE.Color(0xffbe7a);
    const noon = new THREE.Color(0xfffaf0);
    sunColor.copy(golden).lerp(noon, Math.pow(dayFactor, 0.7));
  }

  const skyColor = new THREE.Color();
  const groundColor = new THREE.Color();
  let backgroundHex = 0xe8e4dc;

  if (isNight) {
    skyColor.setHex(0x3a4a66);
    groundColor.setHex(0x2d2926);
    backgroundHex = 0x1c2029;
  } else if (goldenFactor > 0.45 && elevationDeg < 22) {
    skyColor.setHex(0xffe9cf);
    groundColor.setHex(0xbca995);
    backgroundHex = 0xe5d9c8;
  } else {
    skyColor.setHex(0xf8fbff);
    groundColor.setHex(0xc9c2b6);
    backgroundHex = 0xe8e5de;
  }

  const effectiveSunIntensity = isNight
    ? 0.14
    : sun.sunIntensity * (0.35 + 0.65 * Math.pow(dayFactor, 0.55));

  const effectiveHemiIntensity = isNight ? 0.36 : 0.72 + 0.32 * dayFactor;

  return {
    elevationDeg,
    azimuthDeg,
    isNight,
    sunDirWorld,
    sunPosition,
    sunColor,
    skyColor,
    groundColor,
    effectiveSunIntensity,
    effectiveHemiIntensity,
    backgroundHex,
    formattedTime: formatSolarHour(sun.hour),
    compassLabel: bearingToCompassLabel(sun.northAngleDeg),
  };
}
