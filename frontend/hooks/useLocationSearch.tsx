import { useEffect, useRef, useState } from "react";
import SEARCH_BACKEND_URL from "@/util/search-backendurl";

export type SearchResult = {
  id: number;
  name: string;
  class: string;
  subclass: string;
  lat: number;
  lon: number;
};

export function useLocationSearch() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searched, setSearched] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressNextSearch = useRef(false); // NEW

  useEffect(() => {
    if (suppressNextSearch.current) {
      suppressNextSearch.current = false; // consume the flag once
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);

    const trimmed = query.trim();
    if (!trimmed) {
      setResults([]);
      setSearched(false);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(
          `${SEARCH_BACKEND_URL}/search?q=${encodeURIComponent(trimmed)}`
        );
        const data: SearchResult[] = await res.json();
        setResults(data);
        setSearched(true);
      } catch (err) {
        console.error("Search failed", err);
        setResults([]);
        setSearched(true);
      }
    }, 200);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query]);

  // Sets the query WITHOUT triggering a search — used after a selection
  const selectValue = (value: string) => {
    suppressNextSearch.current = true;
    setQuery(value);
    setResults([]);
    setSearched(false);
  };

  const reset = () => {
    suppressNextSearch.current = true; // clearing shouldn't search either
    setQuery("");
    setResults([]);
    setSearched(false);
  };

  return { query, setQuery, results, searched, reset, selectValue };
}