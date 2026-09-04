/**
 * The `L` in GLOBathy's `D = l * Dmax / L`: the radius of the largest circle
 * that fits inside a lake. Extracted from build-lake-data.mjs so the depth
 * scale every modeled basin depends on can be exercised directly.
 */
/**
 * Distance from a point to a polygon's boundary; negative outside it.
 * Rings arrive as GeoJSON coordinate arrays already projected to meters.
 */
export function signedDistanceToRings(x, y, rings) {
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
      const [ax, ay] = ring[index];
      const [bx, by] = ring[previous];
      if ((ay > y) !== (by > y) && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
      const dx = bx - ax;
      const dy = by - ay;
      const lengthSquared = dx * dx + dy * dy;
      const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
      best = Math.min(best, Math.hypot(x - ax - t * dx, y - ay - t * dy));
    }
  }
  return inside ? best : -best;
}

/**
 * Radius of the largest circle that fits inside the polygon - the `L` in
 * GLOBathy's equation, found by the quadtree search Mapbox's polylabel uses.
 *
 * This has to describe the whole lake. The browser only ever sees the part of a
 * lake inside the map window, so a lake bigger than the crop would normalize
 * against a clipped radius and come out far too shallow.
 */
/** Max-heap on `max`, so the search pops the most promising cell in O(log n). */
class CellHeap {
  #items = [];
  get size() { return this.#items.length; }
  push(cell) {
    const items = this.#items;
    items.push(cell);
    let index = items.length - 1;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (items[parent].max >= items[index].max) break;
      [items[parent], items[index]] = [items[index], items[parent]];
      index = parent;
    }
  }
  pop() {
    const items = this.#items;
    const top = items[0];
    const last = items.pop();
    if (items.length) {
      items[0] = last;
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        let largest = index;
        if (left < items.length && items[left].max > items[largest].max) largest = left;
        if (right < items.length && items[right].max > items[largest].max) largest = right;
        if (largest === index) break;
        [items[largest], items[index]] = [items[index], items[largest]];
        index = largest;
      }
    }
    return top;
  }
}

/**
 * Thin a ring to at most `limit` vertices.
 *
 * L only sets the depth scale, so a fraction of a percent of error in it is
 * invisible once the basin is cut into millimetre sheets - but Lake Superior
 * carries tens of thousands of vertices, and every one of them would be walked
 * on every probe of the search below.
 */
function thinRing(ring, limit) {
  if (ring.length <= limit) return ring;
  const step = ring.length / limit;
  const thinned = [];
  for (let index = 0; index < limit; index += 1) thinned.push(ring[Math.floor(index * step)]);
  thinned.push(thinned[0]);
  return thinned;
}

/**
 * Radius of the largest circle that fits inside the polygon - the `L` in
 * GLOBathy's equation, found by the quadtree search Mapbox's polylabel uses.
 *
 * This has to describe the whole lake. The browser only ever sees the part of a
 * lake inside the map window, so a lake bigger than the crop would normalize
 * against a clipped radius and come out far too shallow.
 */
export function maximumInscribedRadiusM(inputRings, precision) {
  const rings = inputRings.map((ring) => thinRing(ring, 1200)).filter((ring) => ring.length >= 4);
  if (!rings.length) return 0;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of rings[0]) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const cellSize = Math.min(width, height);
  if (!(cellSize > 0)) return 0;
  // Relative tolerance: a pond does not deserve metre precision and a great
  // lake would never reach it.
  const tolerance = precision ?? Math.max(1, Math.min(width, height) / 400);

  const cellOf = (x, y, half) => {
    const distance = signedDistanceToRings(x, y, rings);
    // Upper bound on any distance within this cell, which is what makes the
    // search safe to prune on.
    return { x, y, half, distance, max: distance + half * Math.SQRT2 };
  };

  const queue = new CellHeap();
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) queue.push(cellOf(x + cellSize / 2, y + cellSize / 2, cellSize / 2));
  }
  let best = cellOf(minX + width / 2, minY + height / 2, 0);
  while (queue.size) {
    const cell = queue.pop();
    if (cell.distance > best.distance) best = cell;
    if (cell.max - best.distance <= tolerance) continue;
    const half = cell.half / 2;
    queue.push(cellOf(cell.x - half, cell.y - half, half));
    queue.push(cellOf(cell.x + half, cell.y - half, half));
    queue.push(cellOf(cell.x - half, cell.y + half, half));
    queue.push(cellOf(cell.x + half, cell.y + half, half));
  }
  return Math.max(0, best.distance);
}

/** Local equirectangular meters about the lake, which is accurate at lake scale. */
export function toLocalMeters(rings, originLat, originLon) {
  const metersPerDegreeLat = 110574;
  const metersPerDegreeLon = 111320 * Math.cos((originLat * Math.PI) / 180);
  return rings.map((ring) => ring.map(([lon, lat]) => [(lon - originLon) * metersPerDegreeLon, (lat - originLat) * metersPerDegreeLat]));
}
