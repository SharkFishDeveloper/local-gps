"use client";

import { JSX, useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import LocationSearchBox from "./LocationSearchBox";
import { SearchResult } from "@/hooks/useLocationSearch";
import VALHALLA_BACKENDAPI from "@/util/valhalla-backendurl";
import { BikeIcon, CarIcon, WalkIcon } from "./icons";
import createPinElement from "./pin";
import { decodePolyline6 } from "@/util/geo";

type Point = { lat: number; lon: number; label: string };
type PickTarget = "from" | "to" | null;
type TravelMode = "auto" | "bicycle" | "pedestrian";
type LonLat = [number, number];
type Fix = { lon: number; lat: number; bearing: number };
type Maneuver = { type: number; instruction: string; atDistanceM: number };
type CurrentManeuver = { type: number; instruction: string; remainingM: number };

const API_BASE = VALHALLA_BACKENDAPI;
const ROUTE_SOURCE_ID = "route-source";
const ROUTE_LAYER_ID = "route-layer";
const FROM_PIN_COLOR = "#22c55e";
const TO_PIN_COLOR = "#ef4444";
const ROUTE_LINE_COLOR = "#3b82f6";
const NAV_ZOOM = 17;
const NAV_PITCH = 50;
const LOOKAHEAD_M = 25;

const MODE_META: Record<TravelMode, { label: string; Icon: (p: { className?: string }) => JSX.Element }> = {
  auto: { label: "Car", Icon: CarIcon },
  bicycle: { label: "Bike", Icon: BikeIcon },
  pedestrian: { label: "Foot", Icon: WalkIcon },
};

// ---- turn icon / instruction helpers ----------------------------------

type IconKind =
  | "straight"
  | "left"
  | "right"
  | "slight-left"
  | "slight-right"
  | "sharp-left"
  | "sharp-right"
  | "uturn"
  | "roundabout"
  | "arrive";

// Valhalla maneuver "type" codes -> simplified icon kind.
// https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
const MANEUVER_ICON: Record<number, IconKind> = {
  0: "straight",
  1: "straight",
  7: "straight",
  8: "straight",
  17: "straight",
  22: "straight",
  25: "straight",
  9: "slight-right",
  18: "slight-right",
  20: "slight-right",
  23: "slight-right",
  16: "slight-left",
  19: "slight-left",
  21: "slight-left",
  24: "slight-left",
  2: "right",
  10: "right",
  3: "left",
  15: "left",
  11: "sharp-right",
  14: "sharp-left",
  12: "uturn",
  13: "uturn",
  26: "roundabout",
  27: "roundabout",
  4: "arrive",
  5: "arrive",
  6: "arrive",
};

function getIconKind(type: number): IconKind {
  return MANEUVER_ICON[type] ?? "straight";
}

const ARROW_ROTATION: Partial<Record<IconKind, number>> = {
  straight: 0,
  "slight-right": 35,
  right: 90,
  "sharp-right": 135,
  "slight-left": -35,
  left: -90,
  "sharp-left": -135,
};

function TurnIcon({ kind, className }: { kind: IconKind; className?: string }) {
  if (kind === "arrive") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <path d="M6 21V4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M6 4l11 3.5L6 11" fill="currentColor" stroke="currentColor" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "roundabout") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <circle cx="12" cy="13" r="7" stroke="currentColor" strokeWidth="2.2" />
        <path d="M12 3v6l3.5-2.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (kind === "uturn") {
    return (
      <svg viewBox="0 0 24 24" className={className} fill="none">
        <path d="M16 20V10a5 5 0 0 0-10 0v3" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        <path d="M3 13l3 4 3-4" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  const deg = ARROW_ROTATION[kind] ?? 0;
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" style={{ transform: `rotate(${deg}deg)` }}>
      <path
        d="M12 20V5M12 5l-5.5 5.5M12 5l5.5 5.5"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function formatDistance(m: number): string {
  if (m < 30) return "now";
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(1)} km`;
}

// ---- geo helpers -----------------------------------------------------

const toRad = (d: number) => (d * Math.PI) / 180;

function distanceMeters(lon1: number, lat1: number, lon2: number, lat2: number) {
  const R = 6371000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function bearingBetween(lon1: number, lat1: number, lon2: number, lat2: number) {
  const φ1 = toRad(lat1);
  const φ2 = toRad(lat2);
  const Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function nearestIndexOnRoute(lon: number, lat: number, route: LonLat[]): number {
  let nearestIdx = 0;
  let nearestDist = Infinity;
  for (let i = 0; i < route.length; i++) {
    const d = distanceMeters(lon, lat, route[i][0], route[i][1]);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  }
  return nearestIdx;
}

// Cumulative distance (meters) walked along the route up to each point.
// Lets us turn "nearest point index" into "meters traveled" and compare
// that against where each maneuver begins.
function computeCumulativeDistances(route: LonLat[]): number[] {
  const cum: number[] = [0];
  for (let i = 1; i < route.length; i++) {
    cum.push(cum[i - 1] + distanceMeters(route[i - 1][0], route[i - 1][1], route[i][0], route[i][1]));
  }
  return cum;
}

// Heading toward the point ~LOOKAHEAD_M meters ahead on the route, so the
// upcoming road segment renders straight up on screen once the map bearing
// matches it.
function headingAlongRoute(lon: number, lat: number, route: LonLat[]): number | null {
  if (route.length < 2) return null;

  const nearestIdx = nearestIndexOnRoute(lon, lat, route);

  let target = route[route.length - 1];
  for (let i = nearestIdx; i < route.length; i++) {
    if (distanceMeters(lon, lat, route[i][0], route[i][1]) >= LOOKAHEAD_M) {
      target = route[i];
      break;
    }
  }

  return bearingBetween(lon, lat, target[0], target[1]);
}

function createPuckElement(): HTMLDivElement {
  const el = document.createElement("div");
  el.style.width = "18px";
  el.style.height = "18px";
  el.style.borderRadius = "50%";
  el.style.background = "#3b82f6";
  el.style.border = "3px solid white";
  el.style.boxShadow = "0 0 0 2px rgba(59,130,246,0.4), 0 2px 6px rgba(0,0,0,0.35)";
  return el;
}

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fromMarkerRef = useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = useRef<maplibregl.Marker | null>(null);
  const navMarkerRef = useRef<maplibregl.Marker | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const routeCoordsRef = useRef<LonLat[]>([]);
  const cumDistRef = useRef<number[]>([]);
  const maneuversRef = useRef<Maneuver[]>([]);
  const lastFixRef = useRef<Fix | null>(null);
  const followRef = useRef(true);

  const [mapReady, setMapReady] = useState(false);
  const [from, setFrom] = useState<Point | null>(null);
  const [to, setTo] = useState<Point | null>(null);
  const [picking, setPicking] = useState<PickTarget>(null);
  const [routeSummary, setRouteSummary] = useState<{ distanceKm: number; durationMin: number } | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [mode, setMode] = useState<TravelMode>("auto");
  const [navigating, setNavigating] = useState(false);
  const [locating, setLocating] = useState(false);
  const [followMode, setFollowModeState] = useState(true);
  const [currentManeuver, setCurrentManeuver] = useState<CurrentManeuver | null>(null);

  const setFollowMode = (v: boolean) => {
    followRef.current = v;
    setFollowModeState(v);
  };

  // Init map
  useEffect(() => {
    if (!mapContainer.current) return;
    let map: maplibregl.Map | null = null;

    const initMap = async () => {
      const style = await fetch("map-styles/osm-liberty/style.json").then((r) => r.json());
      const location = style.sources.openmaptiles.url.split("/").pop();
      const tileJson = await fetch(`http://localhost:3001/${location}`).then((r) => r.json());

      let center: [number, number];
      let zoom = 11;
      if (tileJson.center) {
        center = [tileJson.center[0], tileJson.center[1]];
        if (tileJson.center.length >= 3) zoom = tileJson.center[2];
      } else {
        const [minLon, minLat, maxLon, maxLat] = tileJson.bounds;
        center = [(minLon + maxLon) / 2, (minLat + maxLat) / 2];
      }

      map = new maplibregl.Map({
        container: mapContainer.current!,
        style: "map-styles/osm-liberty/style.json",
        center,
        zoom,
      });

      map.on("load", () => {
        map!.addSource(ROUTE_SOURCE_ID, {
          type: "geojson",
          data: { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } },
        });
        map!.addLayer({
          id: ROUTE_LAYER_ID,
          type: "line",
          source: ROUTE_SOURCE_ID,
          layout: { "line-join": "round", "line-cap": "round" },
          paint: { "line-color": ROUTE_LINE_COLOR, "line-width": 5, "line-opacity": 0.85 },
        });
        setMapReady(true);
      });

      mapRef.current = map;
    };

    initMap();

    return () => {
      map?.remove();
      mapRef.current = null;
    };
  }, []);

  // Pick location on map click
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !picking) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const point: Point = {
        lat: e.lngLat.lat,
        lon: e.lngLat.lng,
        label: `${e.lngLat.lat.toFixed(5)}, ${e.lngLat.lng.toFixed(5)}`,
      };
      if (picking === "from") setFrom(point);
      else setTo(point);
      setPicking(null);
    };

    map.getCanvas().style.cursor = "crosshair";
    map.once("click", handleClick);

    return () => {
      map.off("click", handleClick);
      map.getCanvas().style.cursor = "";
    };
  }, [picking]);

  // From marker + fly to it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !from) return;

    fromMarkerRef.current?.remove();
    fromMarkerRef.current = new maplibregl.Marker({ element: createPinElement(FROM_PIN_COLOR), anchor: "bottom" })
      .setLngLat([from.lon, from.lat])
      .addTo(map);

    map.flyTo({ center: [from.lon, from.lat], zoom: 15, duration: 2000 });
  }, [from]);

  // To marker + fly to it
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !to) return;

    toMarkerRef.current?.remove();
    toMarkerRef.current = new maplibregl.Marker({ element: createPinElement(TO_PIN_COLOR), anchor: "bottom" })
      .setLngLat([to.lon, to.lat])
      .addTo(map);

    map.flyTo({ center: [to.lon, to.lat], zoom: 15, duration: 2000 });
  }, [to]);

  // Fetch and draw the route whenever both points are set
  useEffect(() => {
    if (!mapReady || !from || !to) return;
    let cancelled = false;

    const fetchRoute = async () => {
      setRouteLoading(true);
      setRouteError(null);

      try {
        const res = await fetch(`${API_BASE}/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: [
              navigating && lastFixRef.current
                ? {
                    lat: lastFixRef.current.lat,
                    lon: lastFixRef.current.lon,
                  }
                : {
                    lat: from.lat,
                    lon: from.lon,
                  },
              { lat: to.lat, lon: to.lon },
            ],
            costing: mode,
            units: "kilometers",
          }),
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => null);
          throw new Error(errBody?.detail || `Request failed with status ${res.status}`);
        }

        const data = await res.json();
        const legs = data?.trip?.legs;
        if (!legs || legs.length === 0) throw new Error("No route found between these points.");
        if (cancelled) return;

        const coordinates: LonLat[] = legs.flatMap((leg: { shape: string }) => decodePolyline6(leg.shape));
        routeCoordsRef.current = coordinates;
        cumDistRef.current = computeCumulativeDistances(coordinates);

        // Only 2 waypoints are ever requested (from -> to), so there's
        // always exactly one leg and shape indices line up directly with
        // the coordinates array above.
        const rawManeuvers = legs[0]?.maneuvers ?? [];
        maneuversRef.current = rawManeuvers.map(
          (m: { type: number; instruction: string; begin_shape_index: number }) => ({
            type: m.type,
            instruction: m.instruction,
            atDistanceM: cumDistRef.current[m.begin_shape_index] ?? 0,
          })
        );
        setCurrentManeuver(null);

        const source = mapRef.current?.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates } });

        if (data?.trip?.summary) {
          setRouteSummary({ distanceKm: data.trip.summary.length, durationMin: data.trip.summary.time / 60 });
        }

        const bounds = coordinates.reduce(
          (b: maplibregl.LngLatBounds, coord: LonLat) => b.extend(coord),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
        );
        mapRef.current?.fitBounds(bounds, { padding: 80, maxZoom: 16, duration: 1500 });
      } catch (err) {
        if (!cancelled) setRouteError(err instanceof Error ? err.message : "Failed to fetch route.");
      } finally {
        if (!cancelled) setRouteLoading(false);
      }
    };

    fetchRoute();

    return () => {
      cancelled = true;
    };
  }, [mapReady, from, to, mode, navigating]);

  // Turn-by-turn follow: puck pinned near the bottom, map rotated so the
  // road ahead points straight up. User can drag/zoom freely, which drops
  // follow mode until they tap "Recenter".
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !navigating) return;

    setFollowMode(true);

    const onUserInteract = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent) setFollowMode(false);
    };
    map.on("dragstart", onUserInteract);
    map.on("zoomstart", onUserInteract);

    const applyFix = (lon: number, lat: number) => {
      const heading = headingAlongRoute(lon, lat, routeCoordsRef.current) ?? lastFixRef.current?.bearing ?? 0;
      lastFixRef.current = { lon, lat, bearing: heading };

      // Figure out which upcoming maneuver we're approaching and how far
      // away it is, by converting our position into "distance traveled
      // along the route" and comparing it to where each maneuver begins.
      const nearestIdx = nearestIndexOnRoute(lon, lat, routeCoordsRef.current);
      const traveled = cumDistRef.current[nearestIdx] ?? 0;
      const next = maneuversRef.current.find((m) => m.atDistanceM > traveled + 3);
      setCurrentManeuver(
        next ? { type: next.type, instruction: next.instruction, remainingM: Math.max(0, next.atDistanceM - traveled) } : null
      );

      if (!navMarkerRef.current) {
        navMarkerRef.current = new maplibregl.Marker({ element: createPuckElement(), anchor: "center" })
          .setLngLat([lon, lat])
          .addTo(map);
      } else {
        navMarkerRef.current.setLngLat([lon, lat]);
      }

      if (followRef.current) {
        map.easeTo({
          center: [lon, lat],
          bearing: heading,
          pitch: NAV_PITCH,
          zoom: NAV_ZOOM,
          padding: { top: map.getContainer().clientHeight * 0.55, bottom: 0, left: 0, right: 0 },
          duration: 800,
        });
      }
    };

    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => applyFix(pos.coords.longitude, pos.coords.latitude),
      (err) => setRouteError(err.message || "Unable to track location."),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );

    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      map.off("dragstart", onUserInteract);
      map.off("zoomstart", onUserInteract);
      navMarkerRef.current?.remove();
      navMarkerRef.current = null;
      setCurrentManeuver(null);
      map.easeTo({ bearing: 0, pitch: 0, padding: { top: 0, bottom: 0, left: 0, right: 0 }, duration: 500 });
    };
  }, [navigating]);

  const handleFromSelect = (r: SearchResult) => setFrom({ lat: r.lat, lon: r.lon, label: r.name });
  const handleToSelect = (r: SearchResult) => setTo({ lat: r.lat, lon: r.lon, label: r.name });

  const handleUseMyLocation = () => {
    setPicking(null);
    setRouteError(null);
    if (!("geolocation" in navigator)) {
      setRouteError("Geolocation is not supported by this browser.");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        setNavigating(false);
        setFrom({ lat: pos.coords.latitude, lon: pos.coords.longitude, label: "My Location" });
      },
      (err) => {
        setLocating(false);
        setRouteError(err.message || "Unable to get your location.");
      },
      { enableHighAccuracy: true, timeout: 15000 }
    );
  };

  const handleStartNavigation = async () => {
    if (!to) return;

    if (!("geolocation" in navigator)) {
      setRouteError("Geolocation is not supported by your browser.");
      return;
    }

    // Helper to actually request the position
    const requestGPS = () => {
      setLocating(true);
      setRouteError(null);

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLocating(false);
          fromMarkerRef.current?.remove();
          fromMarkerRef.current = null;
          setPicking(null);

          setFrom({
            lat: pos.coords.latitude,
            lon: pos.coords.longitude,
            label: "My Location",
          });
          setNavigating(true);
        },
        (err) => {
          setLocating(false);
          if (err.code === err.PERMISSION_DENIED) {
            setRouteError("GPS access is turned off/denied. Please turn on location permissions to continue.");
          } else {
            setRouteError(err.message || "Waiting for location fix...");
          }
        },
        { enableHighAccuracy: true, timeout: 10000 }
      );
    };
    try {
      const permission = await navigator.permissions?.query({ name: "geolocation" });
      if (permission) {
        permission.onchange = () => {
          if (permission.state === "granted") {
            requestGPS();
          } else if (permission.state === "denied") {
            setRouteError("GPS is blocked. Please enable location in your browser address bar.");
          }
        };
      }
      if (permission?.state === "denied") {
        setRouteError("GPS access is blocked. Please enable location permissions in browser settings and tap 'Start Navigation' again.");
        return;
      }
    } catch {
    }
    requestGPS();
  };

  const handleEndNavigation = () => {
    setNavigating(false);
    setCurrentManeuver(null);
  };

  const handleRecenter = () => {
    const map = mapRef.current;
    const fix = lastFixRef.current;
    setFollowMode(true);
    if (!map || !fix) return;
    map.easeTo({
      center: [fix.lon, fix.lat],
      bearing: fix.bearing,
      pitch: NAV_PITCH,
      zoom: NAV_ZOOM,
      padding: { top: map.getContainer().clientHeight * 0.55, bottom: 0, left: 0, right: 0 },
      duration: 800,
    });
  };

  const handleReset = () => {
    setFrom(null);
    setTo(null);
    setPicking(null);
    setNavigating(false);
    setRouteSummary(null);
    setRouteError(null);
    setCurrentManeuver(null);
    maneuversRef.current = [];
    cumDistRef.current = [];
    fromMarkerRef.current?.remove();
    fromMarkerRef.current = null;
    toMarkerRef.current?.remove();
    toMarkerRef.current = null;
    const src = mapRef.current?.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    src?.setData({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [] } });
  };

  return (
    <div className="relative h-screen w-full">
      <div className="absolute left-2 right-2 top-2 z-10 flex flex-col gap-2 rounded-lg bg-white/95 p-3 shadow-md backdrop-blur-sm sm:left-4 sm:right-auto sm:top-4 sm:w-80">
        {navigating ? (
          <div className="flex flex-col gap-2">
            {currentManeuver ? (
              <div className="flex items-center gap-3 rounded-md bg-blue-600 p-3 text-white">
                <TurnIcon kind={getIconKind(currentManeuver.type)} className="h-9 w-9 flex-shrink-0" />
                <div className="min-w-0">
                  <div className="text-lg font-bold leading-tight">{formatDistance(currentManeuver.remainingM)}</div>
                  <div className="truncate text-xs text-blue-100">{currentManeuver.instruction}</div>
                </div>
              </div>
            ) : (
              routeSummary && (
                <div className="rounded-md bg-blue-600 px-3 py-3 text-sm font-semibold text-white">
                  Navigating · {routeSummary.distanceKm.toFixed(1)} km · {Math.round(routeSummary.durationMin)} min
                </div>
              )
            )}
            <button
              type="button"
              onClick={handleEndNavigation}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              End navigation
            </button>
          </div>
        ) : (
          <>
            <LocationSearchBox
              label="From"
              placeholder="Search starting point..."
              onSelect={handleFromSelect}
              onPickOnMap={() => setPicking(picking === "from" ? null : "from")}
              isPicking={picking === "from"}
              externalValue={from?.label}
            />
            <button
              type="button"
              onClick={handleUseMyLocation}
              className="flex items-center justify-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-gray-50"
            >
              <span className={`h-2 w-2 rounded-full bg-blue-500 ${locating ? "animate-pulse" : "opacity-60"}`} />
              {locating ? "Locating…" : "Use my location"}
            </button>
            <LocationSearchBox
              label="To"
              placeholder="Search destination..."
              onSelect={handleToSelect}
              onPickOnMap={() => setPicking(picking === "to" ? null : "to")}
              isPicking={picking === "to"}
              externalValue={to?.label}
            />
            <div className="flex gap-1 rounded-md bg-gray-100 p-1">
              {(Object.keys(MODE_META) as TravelMode[]).map((m) => {
                const { label, Icon } = MODE_META[m];
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className={`flex flex-1 flex-col items-center gap-0.5 rounded px-2 py-1.5 text-[11px] font-medium transition-colors ${
                      mode === m ? "bg-white text-blue-700 shadow-sm" : "text-gray-500 hover:text-gray-700"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {label}
                  </button>
                );
              })}
            </div>
            {picking && (
              <p className="text-xs text-blue-600">
                Click anywhere on the map to set the {picking === "from" ? "From" : "To"} location.
              </p>
            )}
            {routeLoading && <p className="text-xs text-gray-500">Calculating route…</p>}
            {routeError && <p className="text-xs text-red-600">{routeError}</p>}
            {routeSummary && !routeLoading && (
              <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <span className="font-medium">{routeSummary.distanceKm.toFixed(1)} km</span>
                {" · "}
                <span>{Math.round(routeSummary.durationMin)} min</span>
              </div>
            )}
            {routeSummary && !routeLoading && from && to && (
              <button
                type="button"
                onClick={handleStartNavigation}
                className="rounded-md bg-green-600 px-3 py-2 text-xs font-semibold text-white hover:bg-green-700"
              >
                ▶ Start navigation
              </button>
            )}
            {(from || to) && (
              <button
                type="button"
                onClick={handleReset}
                className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
              >
                Reset
              </button>
            )}
          </>
        )}
      </div>

      {navigating && !followMode && (
        <button
          type="button"
          onClick={handleRecenter}
          className="absolute bottom-8 right-4 z-10 rounded-full bg-white px-4 py-2 text-xs font-semibold text-blue-700 shadow-lg hover:bg-blue-50"
        >
          ⦿ Recenter
        </button>
      )}

      <div ref={mapContainer} className="h-full w-full" />
    </div>
  );
}