"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import LocationSearchBox from "./LocationSearchBox.tsx";
import { SearchResult } from "@/hooks/useLocationSearch";
import VALHALLA_BACKENDAPI from "@/util/valhalla-backendurl";

type Point = { lat: number; lon: number; label: string };
type PickTarget = "from" | "to" | null;

const FROM_MARKER_COLOR = "#22c55e"; // green
const TO_MARKER_COLOR = "#ef4444"; // red
const ROUTE_LINE_COLOR = "#3b82f6"; // blue

const API_BASE = VALHALLA_BACKENDAPI;
const ROUTE_SOURCE_ID = "route-source";
const ROUTE_LAYER_ID = "route-layer";

// How often we accept a new GPS fix and push it into "from" / recompute the
// route when just tracking (not actively navigating).
const GPS_UPDATE_INTERVAL_MS = 5000;
// Faster refresh while actively navigating, like turn-by-turn apps.
const NAV_GPS_UPDATE_INTERVAL_MS = 3000;
// How close (meters) to the destination counts as "arrived".
const ARRIVAL_THRESHOLD_METERS = 30;

type RouteSummary = {
  distanceKm: number;
  durationMin: number;
};

type Maneuver = {
  type: number;
  instruction: string;
  length: number; // km for this maneuver's segment
  time: number; // seconds
};

type TravelMode = "auto" | "bicycle" | "pedestrian";

const MODE_LABELS: Record<TravelMode, string> = {
  auto: "Car",
  bicycle: "Bike",
  pedestrian: "Foot",
};

// Rough icon per Valhalla maneuver "type" code.
// https://valhalla.github.io/valhalla/api/turn-by-turn/api-reference/#maneuver-types
function maneuverIcon(type: number): string {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return "🚗"; // start
    case 4:
    case 5:
    case 6:
      return "🏁"; // destination
    case 8:
      return "⬆️"; // continue
    case 9:
      return "↗️"; // slight right
    case 10:
      return "➡️"; // right
    case 11:
      return "↘️"; // sharp right
    case 12:
    case 13:
      return "↩️"; // u-turn
    case 14:
      return "↙️"; // sharp left
    case 15:
      return "⬅️"; // left
    case 16:
      return "↖️"; // slight left
    case 17:
    case 18:
    case 19:
      return "⤴️"; // ramp
    case 20:
    case 21:
      return "⤵️"; // exit
    case 25:
      return "🔀"; // merge
    case 26:
    case 27:
      return "🔄"; // roundabout
    default:
      return "⬆️";
  }
}

// Valhalla encodes route shapes using Google's polyline algorithm at
// precision 1e6 ("polyline6") instead of the standard 1e5. This decodes
// that into an array of [lon, lat] pairs for use as GeoJSON coordinates.
function decodePolyline6(encoded: string): [number, number][] {
  const coordinates: [number, number][] = [];
  let index = 0;
  let lat = 0;
  let lon = 0;
  const factor = 1e6;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLat = result & 1 ? ~(result >> 1) : result >> 1;
    lat += deltaLat;

    shift = 0;
    result = 0;
    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const deltaLon = result & 1 ? ~(result >> 1) : result >> 1;
    lon += deltaLon;

    coordinates.push([lon / factor, lat / factor]);
  }

  return coordinates;
}

// Haversine distance in meters between two lat/lon points.
function distanceMeters(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fromMarkerRef = useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = useRef<maplibregl.Marker | null>(null);
  const mapLoadedRef = useRef(false);

  const [from, setFrom] = useState<Point | null>(null);
  const [to, setTo] = useState<Point | null>(null);
  const [picking, setPicking] = useState<PickTarget>(null);
  const [routeSummary, setRouteSummary] = useState<RouteSummary | null>(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [maneuvers, setManeuvers] = useState<Maneuver[]>([]);

  const [mode, setMode] = useState<TravelMode>("auto");

  // --- Live GPS tracking for the "from" point --------------------------
  const [gpsActive, setGpsActive] = useState(false);
  const [gpsError, setGpsError] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastGpsFixAtRef = useRef(0);

  // --- Turn-by-turn navigation mode -------------------------------------
  const [navigating, setNavigating] = useState(false);
  const [arrivalMessage, setArrivalMessage] = useState<string | null>(null);
  const navigatingRef = useRef(false);
  const toRef = useRef<Point | null>(null);

  useEffect(() => {
    navigatingRef.current = navigating;
  }, [navigating]);

  useEffect(() => {
    toRef.current = to;
  }, [to]);

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "map-styles/osm-liberty/style.json",
      // center: [77.213, 28.623],
      zoom: 11,
    });

    map.on("load", () => {
      mapLoadedRef.current = true;

      map.addSource(ROUTE_SOURCE_ID, {
        type: "geojson",
        data: {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: [] },
        },
      });

      map.addLayer({
        id: ROUTE_LAYER_ID,
        type: "line",
        source: ROUTE_SOURCE_ID,
        layout: { "line-join": "round", "line-cap": "round" },
        paint: {
          "line-color": ROUTE_LINE_COLOR,
          "line-width": 5,
          "line-opacity": 0.85,
        },
      });
    });

    mapRef.current = map;
    return () => {
      mapLoadedRef.current = false;
      map.remove();
    };
  }, []);

  // Handle "pick on map" clicks
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !picking) return;

    const handleClick = (e: maplibregl.MapMouseEvent) => {
      const { lat, lng } = e.lngLat;
      const point: Point = {
        lat,
        lon: lng,
        label: `${lat.toFixed(5)}, ${lng.toFixed(5)}`,
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

  // Sync "from" marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !from) return;

    if (fromMarkerRef.current) fromMarkerRef.current.remove();
    fromMarkerRef.current = new maplibregl.Marker({ color: FROM_MARKER_COLOR })
      .setLngLat([from.lon, from.lat])
      .setPopup(new maplibregl.Popup({ offset: 25 }).setText(`From: ${from.label}`))
      .addTo(map);

    if (navigatingRef.current) {
      // Keep the view locked on the driver instead of re-fitting bounds.
      map.easeTo({ center: [from.lon, from.lat], zoom: 17, duration: 800 });
    } else {
      map.flyTo({ center: [from.lon, from.lat], zoom: 15 });
    }
  }, [from]);

  // Sync "to" marker
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !to) return;

    if (toMarkerRef.current) toMarkerRef.current.remove();
    toMarkerRef.current = new maplibregl.Marker({ color: TO_MARKER_COLOR })
      .setLngLat([to.lon, to.lat])
      .setPopup(new maplibregl.Popup({ offset: 25 }).setText(`To: ${to.label}`))
      .addTo(map);

    if (!navigatingRef.current) {
      map.flyTo({ center: [to.lon, to.lat], zoom: 15 });
    }
  }, [to]);

  // Fetch and draw the route whenever both points are set
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !from || !to) return;

    const clearRoute = () => {
      const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      source?.setData({
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: [] },
      });
      setRouteSummary(null);
      setManeuvers([]);
    };

    const fetchRoute = async () => {
      setRouteLoading(true);
      setRouteError(null);

      try {
        const response = await fetch(`${API_BASE}/route`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            locations: [
              { lat: from.lat, lon: from.lon },
              { lat: to.lat, lon: to.lon },
            ],
            costing: mode,
            units: "kilometers",
          }),
        });

        if (!response.ok) {
          const errBody = await response.json().catch(() => null);
          throw new Error(errBody?.detail || `Request failed with status ${response.status}`);
        }

        const data = await response.json();
        const legs = data?.trip?.legs;
        if (!legs || legs.length === 0) {
          throw new Error("No route found between these points.");
        }

        // Combine all leg shapes into a single line (usually just one leg
        // for a simple two-point route, but this supports multi-leg trips).
        const coordinates = legs.flatMap((leg: { shape: string }) =>
          decodePolyline6(leg.shape)
        );

        const source = map.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        source?.setData({
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates },
        });

        const summary = data?.trip?.summary;
        if (summary) {
          setRouteSummary({
            distanceKm: summary.length,
            durationMin: summary.time / 60,
          });
        }

        const allManeuvers: Maneuver[] = legs.flatMap(
          (leg: { maneuvers?: Maneuver[] }) => leg.maneuvers ?? []
        );
        setManeuvers(allManeuvers);

        // Only zoom-to-fit the whole route when we're just planning.
        // While navigating we stay locked on the live position instead
        // (handled in the "from" marker effect).
        if (!navigatingRef.current) {
          const bounds = coordinates.reduce(
            (b: maplibregl.LngLatBounds, coord: [number, number]) => b.extend(coord),
            new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
          );
          map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
        }
      } catch (err) {
        clearRoute();
        setRouteError(err instanceof Error ? err.message : "Failed to fetch route.");
      } finally {
        setRouteLoading(false);
      }
    };

    if (mapLoadedRef.current) {
      fetchRoute();
    } else {
      map.once("load", fetchRoute);
    }
  }, [from, to, mode]);

  // Start/stop watching the browser's GPS position while gpsActive is on.
  // New fixes are throttled so the route only recomputes every few seconds
  // instead of on every raw geolocation event. The throttle interval
  // shrinks while actively navigating for tighter turn-by-turn updates.
  useEffect(() => {
    if (!gpsActive) {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      return;
    }

    if (!("geolocation" in navigator)) {
      setGpsError("Geolocation is not supported by this browser.");
      setGpsActive(false);
      setNavigating(false);
      return;
    }

    setGpsError(null);

    const id = navigator.geolocation.watchPosition(
      (position) => {
        const now = Date.now();
        const interval = navigatingRef.current
          ? NAV_GPS_UPDATE_INTERVAL_MS
          : GPS_UPDATE_INTERVAL_MS;
        if (now - lastGpsFixAtRef.current < interval) return;
        lastGpsFixAtRef.current = now;

        const { latitude, longitude } = position.coords;
        const here = { lat: latitude, lon: longitude };

        // Arrival check while navigating.
        if (navigatingRef.current && toRef.current) {
          const remaining = distanceMeters(here, toRef.current);
          if (remaining <= ARRIVAL_THRESHOLD_METERS) {
            setArrivalMessage("You have arrived at your destination.");
            setNavigating(false);
            setGpsActive(false);
            return;
          }
        }

        setFrom({ ...here, label: "My Location" });
      },
      (err) => {
        setGpsError(err.message || "Unable to get your location.");
        setGpsActive(false);
        setNavigating(false);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 15000,
      }
    );

    watchIdRef.current = id;

    return () => {
      navigator.geolocation.clearWatch(id);
      watchIdRef.current = null;
    };
  }, [gpsActive]);

  const handleFromSelect = (result: SearchResult) => {
    setGpsActive(false);
    setNavigating(false);
    setFrom({ lat: result.lat, lon: result.lon, label: result.name });
  };

  const handleToSelect = (result: SearchResult) => {
    setNavigating(false);
    setTo({ lat: result.lat, lon: result.lon, label: result.name });
  };

  const handleFromPickOnMap = () => {
    setGpsActive(false);
    setNavigating(false);
    setPicking(picking === "from" ? null : "from");
  };

  const handleToggleGps = () => {
    if (navigating) return;
    setPicking(null);
    setGpsError(null);
    setGpsActive((prev) => !prev);
  };

  const handleStartNavigation = () => {
    if (!from || !to) return;
    setArrivalMessage(null);
    setPicking(null);
    setNavigating(true);
    setGpsActive(true); // reuses the same GPS watch, now at nav-speed refresh
  };

  const handleStopNavigation = () => {
    setNavigating(false);
    setGpsActive(false);
  };

  const handleReset = () => {
    setGpsActive(false);
    setGpsError(null);
    setNavigating(false);
    setArrivalMessage(null);
    setFrom(null);
    setTo(null);
    setPicking(null);
    setRouteSummary(null);
    setRouteError(null);
    setManeuvers([]);
    fromMarkerRef.current?.remove();
    toMarkerRef.current?.remove();
    fromMarkerRef.current = null;
    toMarkerRef.current = null;

    const map = mapRef.current;
    const source = map?.getSource(ROUTE_SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [] },
    });
  };

  const nextManeuver = maneuvers[0];
  const afterManeuver = maneuvers[1];

  return (
    <div className="relative h-screen w-full">
      <div className="absolute left-2 right-2 top-2 z-10 flex flex-col gap-2 rounded-lg bg-white/95 p-3 shadow-md backdrop-blur-sm sm:left-4 sm:right-auto sm:top-4 sm:w-80">
        {navigating && nextManeuver ? (
          // --- Turn-by-turn navigation panel ---
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 rounded-md bg-blue-600 px-3 py-3 text-white">
              <span className="text-3xl leading-none">{maneuverIcon(nextManeuver.type)}</span>
              <div className="flex-1">
                <p className="text-sm font-semibold leading-snug">
                  {nextManeuver.instruction}
                </p>
                {nextManeuver.length > 0.01 && (
                  <p className="text-xs text-blue-100">
                    in {(nextManeuver.length * 1000).toFixed(0)} m
                  </p>
                )}
              </div>
            </div>

            {afterManeuver && (
              <p className="truncate px-1 text-xs text-gray-500">
                Then: {afterManeuver.instruction}
              </p>
            )}

            {routeSummary && (
              <div className="rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800">
                <span className="font-medium">{routeSummary.distanceKm.toFixed(1)} km</span>
                {" remaining · "}
                <span>{Math.round(routeSummary.durationMin)} min</span>
              </div>
            )}

            {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}

            <button
              type="button"
              onClick={handleStopNavigation}
              className="rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-100"
            >
              End navigation
            </button>
          </div>
        ) : (
          // --- Route planning panel ---
          <>
            {arrivalMessage && (
              <div className="rounded-md bg-green-50 px-3 py-2 text-xs font-medium text-green-800">
                {arrivalMessage}
              </div>
            )}

            <LocationSearchBox
              label="From"
              placeholder="Search starting point..."
              onSelect={handleFromSelect}
              onPickOnMap={handleFromPickOnMap}
              isPicking={picking === "from"}
              externalValue={from?.label}
            />
            <button
              type="button"
              onClick={handleToggleGps}
              className={`flex items-center justify-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                gpsActive
                  ? "border-blue-300 bg-blue-50 text-blue-700"
                  : "border-gray-300 bg-white text-gray-600 hover:bg-gray-50"
              }`}
            >
              <span className={gpsActive ? "animate-pulse" : ""}>📍</span>
              {gpsActive ? "Tracking my location…" : "Use my location"}
            </button>
            {gpsError && <p className="text-xs text-red-600">{gpsError}</p>}
            <LocationSearchBox
              label="To"
              placeholder="Search destination..."
              onSelect={handleToSelect}
              onPickOnMap={() => setPicking(picking === "to" ? null : "to")}
              isPicking={picking === "to"}
              externalValue={to?.label}
            />
            <div className="flex gap-1 rounded-md bg-gray-100 p-1">
              {(Object.keys(MODE_LABELS) as TravelMode[]).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={`flex-1 rounded px-2 py-1 text-xs font-medium transition-colors ${
                    mode === m
                      ? "bg-white text-blue-700 shadow-sm"
                      : "text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {MODE_LABELS[m]}
                </button>
              ))}
            </div>
            {picking && (
              <p className="text-xs text-blue-600">
                Click anywhere on the map to set the {picking === "from" ? "From" : "To"} location.
              </p>
            )}

            {routeLoading && (
              <p className="text-xs text-gray-500">Calculating route…</p>
            )}

            {routeError && (
              <p className="text-xs text-red-600">{routeError}</p>
            )}

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

      <div ref={mapContainer} className="h-full w-full" />
    </div>
  );
}