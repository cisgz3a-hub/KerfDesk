/**
 * Estimate job time from G-code
 * Parses movement commands and calculates time based on feed rates and distances
 */
export function estimateJobTime(gcode: string): {
  totalSeconds: number;
  cutTime: number;
  travelTime: number;
  totalDistance: number;
  cutDistance: number;
  formatted: string;
} {
  const lines = gcode.split('\n');
  let x = 0, y = 0;
  let feedRate = 1000; // mm/min default
  let cutTime = 0;
  let travelTime = 0;
  let cutDistance = 0;
  let travelDistance = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(';')) continue;

    const fMatch = trimmed.match(/F([\d.]+)/);
    if (fMatch) feedRate = parseFloat(fMatch[1]);

    const xMatch = trimmed.match(/X([-\d.]+)/);
    const yMatch = trimmed.match(/Y([-\d.]+)/);

    if (xMatch || yMatch) {
      const nx = xMatch ? parseFloat(xMatch[1]) : x;
      const ny = yMatch ? parseFloat(yMatch[1]) : y;
      const dx = nx - x;
      const dy = ny - y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      if (trimmed.startsWith('G0')) {
        // Rapid move — assume 5000 mm/min
        const rapidRate = 5000;
        travelTime += (dist / rapidRate) * 60;
        travelDistance += dist;
      } else if (trimmed.startsWith('G1')) {
        const rate = feedRate || 1000;
        cutTime += (dist / rate) * 60;
        cutDistance += dist;
      }

      x = nx;
      y = ny;
    }
  }

  const totalSeconds = cutTime + travelTime;
  const totalDistance = cutDistance + travelDistance;

  // Format time
  const mins = Math.floor(totalSeconds / 60);
  const secs = Math.round(totalSeconds % 60);
  const formatted = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;

  return { totalSeconds, cutTime, travelTime, totalDistance, cutDistance, formatted };
}
