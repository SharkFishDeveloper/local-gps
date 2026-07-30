"use client";

import { useEffect, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import LocationSearchBox from "./LocationSearchBox.tsx";
import { SearchResult } from "@/hooks/useLocationSearch";

type Point = { lat: number; lon: number; label: string };
type PickTarget = "from" | "to" | null;

const FROM_MARKER_COLOR = "#22c55e"; // green
const TO_MARKER_COLOR = "#ef4444"; // red
const ROUTE_LINE_COLOR = "#3b82f6"; // blue

const API_BASE = "http://127.0.0.1:8000";
const ROUTE_SOURCE_ID = "route-source";
const ROUTE_LAYER_ID = "route-layer";

type RouteSummary = {
  distanceKm: number;
  durationMin: number;
};

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

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "map-styles/osm-liberty/style.json",
      center: [77.213, 28.623],
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

    map.flyTo({ center: [from.lon, from.lat], zoom: 15 });
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

    map.flyTo({ center: [to.lon, to.lat], zoom: 15 });
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
            costing: "auto",
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

        // Fit the map to the route bounds
        const bounds = coordinates.reduce(
          (b: maplibregl.LngLatBounds, coord: [number, number]) => b.extend(coord),
          new maplibregl.LngLatBounds(coordinates[0], coordinates[0])
        );
        map.fitBounds(bounds, { padding: 80, maxZoom: 16 });
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
  }, [from, to]);

  const handleFromSelect = (result: SearchResult) =>
    setFrom({ lat: result.lat, lon: result.lon, label: result.name });

  const handleToSelect = (result: SearchResult) =>
    setTo({ lat: result.lat, lon: result.lon, label: result.name });

  const handleReset = () => {
    setFrom(null);
    setTo(null);
    setPicking(null);
    setRouteSummary(null);
    setRouteError(null);
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

  return (
    <div className="relative h-screen w-full">
      <div className="absolute left-2 right-2 top-2 z-10 flex flex-col gap-2 rounded-lg bg-white/95 p-3 shadow-md backdrop-blur-sm sm:left-4 sm:right-auto sm:top-4 sm:w-80">
        <LocationSearchBox
          label="From"
          placeholder="Search starting point..."
          onSelect={handleFromSelect}
          onPickOnMap={() => setPicking(picking === "from" ? null : "from")}
          isPicking={picking === "from"}
          externalValue={from?.label}
        />
        <LocationSearchBox
          label="To"
          placeholder="Search destination..."
          onSelect={handleToSelect}
          onPickOnMap={() => setPicking(picking === "to" ? null : "to")}
          isPicking={picking === "to"}
          externalValue={to?.label}
        />
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

        {(from || to) && (
          <button
            type="button"
            onClick={handleReset}
            className="mt-1 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-xs text-gray-600 hover:bg-gray-50"
          >
            Reset
          </button>
        )}
      </div>

      <div ref={mapContainer} className="h-full w-full" />
    </div>
  );
}