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

export default function Map() {
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const fromMarkerRef = useRef<maplibregl.Marker | null>(null);
  const toMarkerRef = useRef<maplibregl.Marker | null>(null);

  const [from, setFrom] = useState<Point | null>(null);
  const [to, setTo] = useState<Point | null>(null);
  const [picking, setPicking] = useState<PickTarget>(null);

  // Initialize map once
  useEffect(() => {
    if (!mapContainer.current) return;

    const map = new maplibregl.Map({
      container: mapContainer.current,
      style: "map-styles/osm-liberty/style.json",
      center: [77.213, 28.623],
      zoom: 11,
    });

    mapRef.current = map;
    return () => map.remove();
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
 // Sync "from" marker
useEffect(() => {
  const map = mapRef.current;
  if (!map || !from) return;

  if (fromMarkerRef.current) fromMarkerRef.current.remove();
  fromMarkerRef.current = new maplibregl.Marker({ color: FROM_MARKER_COLOR })
    .setLngLat([from.lon, from.lat])
    .setPopup(new maplibregl.Popup({ offset: 25 }).setText(`From: ${from.label}`)) // ADDED
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
    .setPopup(new maplibregl.Popup({ offset: 25 }).setText(`To: ${to.label}`)) // ADDED
    .addTo(map);

  map.flyTo({ center: [to.lon, to.lat], zoom: 15 });
}, [to]);

  const handleFromSelect = (result: SearchResult) =>
    setFrom({ lat: result.lat, lon: result.lon, label: result.name });

  const handleToSelect = (result: SearchResult) =>
    setTo({ lat: result.lat, lon: result.lon, label: result.name });

  const handleReset = () => {
    setFrom(null);
    setTo(null);
    setPicking(null);
    fromMarkerRef.current?.remove();
    toMarkerRef.current?.remove();
    fromMarkerRef.current = null;
    toMarkerRef.current = null;
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