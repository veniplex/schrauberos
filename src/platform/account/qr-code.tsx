import type { QrMatrix } from "@/lib/qr";

/**
 * QR-Code als SVG, gezeichnet aus der Matrix des Servers (`lib/qr.ts`) – kein Bild, kein externer Dienst, nichts, was die Content-Security-Policy berührt. Immer
 * **dunkel auf hell**, auch im dunklen Design: Scanner lesen den Code zuverlässig nur so (mit der vorgeschriebenen stillen Zone von vier Modulen ringsum).
 */
export function QrCode({ matrix, label, className }: { matrix: QrMatrix; label: string; className?: string }) {
  const quiet = 4;
  const total = matrix.size + quiet * 2;
  let path = "";
  matrix.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) if (row[x] === "1") path += `M${x + quiet} ${y + quiet}h1v1h-1z`;
  });
  return (
    <svg viewBox={`0 0 ${total} ${total}`} role="img" aria-label={label} shapeRendering="crispEdges" className={`aspect-square w-full max-w-60 rounded-md bg-white text-black ${className ?? ""}`}>
      <path d={path} fill="currentColor" />
    </svg>
  );
}
