import "leaflet/dist/leaflet.css";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, Rectangle, useMap, useMapEvents } from "react-leaflet";
import type { GridCell, DrawnBbox } from "@/lib/mapsApi";
import { Pencil, X } from "lucide-react";

function zoomToHalfDeg(zoom: number): number {
  if (zoom <= 8) return 5;
  if (zoom <= 9) return 2.5;
  if (zoom <= 10) return 1.0;
  if (zoom <= 11) return 0.25;
  if (zoom <= 12) return 0.075;
  if (zoom <= 13) return 0.03;
  if (zoom <= 14) return 0.015;
  return 0.008;
}

function cellBounds(cell: GridCell): [[number, number], [number, number]] {
  const half = cell.halfDeg ?? zoomToHalfDeg(cell.zoom);
  return [
    [cell.lat - half, cell.lng - half],
    [cell.lat + half, cell.lng + half],
  ];
}

function FitBounds({ cells }: { cells: GridCell[] }) {
  const map = useMap();
  useEffect(() => {
    if (cells.length === 0) return;
    const allBounds = cells.map(cellBounds);
    const minLat = Math.min(...allBounds.map((b) => b[0][0]));
    const minLng = Math.min(...allBounds.map((b) => b[0][1]));
    const maxLat = Math.max(...allBounds.map((b) => b[1][0]));
    const maxLng = Math.max(...allBounds.map((b) => b[1][1]));
    map.fitBounds([[minLat, minLng], [maxLat, maxLng]], { padding: [24, 24] });
  }, [cells, map]);
  return null;
}

function FitDrawnBbox({ bbox }: { bbox: DrawnBbox }) {
  const map = useMap();
  useEffect(() => {
    map.fitBounds(
      [[bbox.minLat, bbox.minLng], [bbox.maxLat, bbox.maxLng]],
      { padding: [24, 24] },
    );
  }, [bbox, map]);
  return null;
}

function DrawHandler({
  onComplete,
  onCancel,
}: {
  onComplete: (bbox: DrawnBbox) => void;
  onCancel: () => void;
}) {
  const map = useMap();
  const startRef = useRef<{ lat: number; lng: number } | null>(null);
  const [preview, setPreview] = useState<[[number, number], [number, number]] | null>(null);

  useEffect(() => {
    const el = map.getContainer();
    el.style.cursor = "crosshair";
    map.dragging.disable();
    return () => {
      el.style.cursor = "";
      map.dragging.enable();
    };
  }, [map]);

  useMapEvents({
    mousedown(e) {
      startRef.current = { lat: e.latlng.lat, lng: e.latlng.lng };
    },
    mousemove(e) {
      if (!startRef.current) return;
      setPreview([
        [startRef.current.lat, startRef.current.lng],
        [e.latlng.lat, e.latlng.lng],
      ]);
    },
    mouseup(e) {
      if (!startRef.current) return;
      const s = startRef.current;
      startRef.current = null;
      setPreview(null);
      const minLat = Math.min(s.lat, e.latlng.lat);
      const maxLat = Math.max(s.lat, e.latlng.lat);
      const minLng = Math.min(s.lng, e.latlng.lng);
      const maxLng = Math.max(s.lng, e.latlng.lng);
      if (maxLat - minLat < 0.01 || maxLng - minLng < 0.01) {
        onCancel();
        return;
      }
      onComplete({ minLat, maxLat, minLng, maxLng });
    },
  });

  if (!preview) return null;
  return (
    <Rectangle
      bounds={preview}
      pathOptions={{
        color: "#22c55e",
        fillColor: "#22c55e",
        fillOpacity: 0.15,
        weight: 2,
        dashArray: "6 3",
      }}
    />
  );
}

export interface MapGridPickerProps {
  cells: GridCell[];
  selectedIndices: Set<number>;
  onToggle: (index: number) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onDraw: (bbox: DrawnBbox) => void;
  drawnBbox: DrawnBbox | null;
  onClearDraw: () => void;
  loading?: boolean;
  placeholder?: string;
}

export function MapGridPicker({
  cells,
  selectedIndices,
  onToggle,
  onSelectAll,
  onDeselectAll,
  onDraw,
  drawnBbox,
  onClearDraw,
  loading,
  placeholder,
}: MapGridPickerProps) {
  const [drawing, setDrawing] = useState(false);

  function startDraw() {
    setDrawing(true);
  }

  function handleComplete(bbox: DrawnBbox) {
    setDrawing(false);
    onDraw(bbox);
  }

  function handleCancel() {
    setDrawing(false);
  }

  function handleClear() {
    setDrawing(false);
    onClearDraw();
  }

  return (
    <div className="flex flex-col gap-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-3 py-2 border border-b-0 border-muted/30 rounded-t-lg bg-muted/5">
        <span className="text-[11px] font-mono text-muted-foreground">
          {drawing ? (
            <span className="text-primary animate-pulse">Click and drag on the map to draw your area</span>
          ) : cells.length > 0 ? (
            <>
              <span className="text-primary font-semibold">{selectedIndices.size}</span>
              <span className="text-muted-foreground/60"> / {cells.length} cells selected</span>
              {drawnBbox && <span className="ml-2 text-primary/60">· drawn area</span>}
            </>
          ) : loading ? (
            <span className="text-muted-foreground/50 animate-pulse">Loading grid…</span>
          ) : (
            <span className="text-muted-foreground/40">{placeholder ?? "Enter a location or draw an area"}</span>
          )}
        </span>

        <div className="flex items-center gap-3">
          {/* Draw / cancel button */}
          <button
            type="button"
            onClick={drawing ? handleCancel : startDraw}
            className={`flex items-center gap-1 text-[10px] font-mono px-2 py-0.5 rounded border transition-colors ${
              drawing
                ? "border-primary/60 bg-primary/10 text-primary"
                : "border-muted/30 text-muted-foreground hover:border-primary/40 hover:text-primary"
            }`}
          >
            <Pencil className="h-3 w-3" />
            {drawing ? "Cancel" : "Draw area"}
          </button>

          {/* Clear drawn bbox */}
          {drawnBbox && !drawing && (
            <button
              type="button"
              onClick={handleClear}
              className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="h-3 w-3" />
              Clear
            </button>
          )}

          {/* Select / Deselect all */}
          {cells.length > 0 && !drawing && (
            <>
              <button
                type="button"
                onClick={onSelectAll}
                className="text-[10px] font-mono text-primary hover:underline"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onDeselectAll}
                className="text-[10px] font-mono text-muted-foreground hover:text-foreground hover:underline"
              >
                Deselect all
              </button>
            </>
          )}
        </div>
      </div>

      {/* Map */}
      <div className="rounded-b-lg overflow-hidden border border-muted/30" style={{ height: 380 }}>
        <MapContainer
          center={[20, 0]}
          zoom={2}
          style={{ height: "100%", width: "100%", background: "#0d1117" }}
          zoomControl
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            maxZoom={19}
          />

          {/* Fit bounds to cells or drawn bbox */}
          {cells.length > 0 ? <FitBounds cells={cells} /> : drawnBbox ? <FitDrawnBbox bbox={drawnBbox} /> : null}

          {/* Draw handler — active while drawing */}
          {drawing && <DrawHandler onComplete={handleComplete} onCancel={handleCancel} />}

          {/* Drawn bbox outline */}
          {drawnBbox && (
            <Rectangle
              bounds={[[drawnBbox.minLat, drawnBbox.minLng], [drawnBbox.maxLat, drawnBbox.maxLng]]}
              pathOptions={{
                color: "#22c55e",
                fillOpacity: 0,
                weight: 1.5,
                dashArray: "6 3",
                opacity: 0.5,
              }}
            />
          )}

          {/* Grid cells */}
          {cells.map((cell, idx) => {
            const selected = selectedIndices.has(idx);
            return (
              <Rectangle
                key={idx}
                bounds={cellBounds(cell)}
                pathOptions={{
                  color: selected ? "#22c55e" : "#6b7280",
                  fillColor: selected ? "#22c55e" : "#6b7280",
                  fillOpacity: selected ? 0.28 : 0.07,
                  weight: selected ? 1.5 : 0.8,
                  opacity: selected ? 0.85 : 0.35,
                }}
                eventHandlers={{ click: () => onToggle(idx) }}
              />
            );
          })}
        </MapContainer>
      </div>

      {cells.length > 0 && (
        <p className="text-[10px] font-mono text-muted-foreground/40 mt-1 pl-1">
          Click cells to include / exclude · or draw a new area to re-tile
        </p>
      )}
    </div>
  );
}
