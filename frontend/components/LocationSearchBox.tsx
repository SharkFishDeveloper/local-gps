import { useEffect } from "react";
import { SearchResult, useLocationSearch } from "@/hooks/useLocationSearch";
import { MapPin } from "lucide-react";

type Props = {
  label: string;
  placeholder: string;
  onSelect: (result: SearchResult) => void;
  onPickOnMap: () => void;
  isPicking: boolean;
  externalValue?: string;
};

export default function LocationSearchBox({
  label,
  placeholder,
  onSelect,
  onPickOnMap,
  isPicking,
  externalValue,
}: Props) {
  const { query, setQuery, results, searched, selectValue } = useLocationSearch();

  // Sync in external updates (e.g. map pick) WITHOUT re-triggering search
  useEffect(() => {
    if (externalValue !== undefined) {
      selectValue(externalValue);
    }
  }, [externalValue]);

  const handleSelect = (result: SearchResult) => {
    onSelect(result);
    selectValue(result.name); // sets query but suppresses the re-search
  };

  return (
    <div className="relative w-full">
      <label className="mb-1 block text-xs font-medium text-gray-600">
        {label}
      </label>

      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)} // normal typing still searches
          placeholder={placeholder}
          className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        />
        <button
          type="button"
          onClick={onPickOnMap}
          title="Pick location on map"
          className={`flex shrink-0 items-center justify-center rounded-md border px-3 transition-colors ${
            isPicking
              ? "border-blue-500 bg-blue-500 text-white"
              : "border-gray-300 bg-white hover:bg-gray-50"
          }`}
        >
          <MapPin
            className={`h-5 w-5 ${
              isPicking
                ? "text-white"
                : label === "From"
                ? "text-green-600"
                : label === "To"
                ? "text-red-600"
                : "text-gray-600"
            }`}
          />
        </button>
      </div>

      {searched && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border border-gray-200 bg-white shadow-lg">
          {results.length > 0 ? (
            results.slice(0, 5).map((r) => (
              <li
                key={r.id}
                onClick={() => handleSelect(r)}
                className="cursor-pointer border-b border-gray-100 px-3 py-2 last:border-b-0 hover:bg-gray-50"
              >
                <div className="text-sm font-medium text-gray-800">{r.name}</div>
                {r.class !== "unknown" && r.subclass && (
                  <div className="text-xs text-gray-500">
                    {r.subclass[0].toUpperCase() + r.subclass.slice(1).toLowerCase()}
                  </div>
                )}
              </li>
            ))
          ) : (
            <li className="px-3 py-2 text-sm text-gray-400">No results found</li>
          )}
        </ul>
      )}
    </div>
  );
}