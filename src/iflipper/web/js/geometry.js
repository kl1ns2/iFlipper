// Geometry helpers. Units are millimetres; Y is up.
import * as THREE from 'three';

// `r` is one corner radius, or [left, right] for different radii on each end.
export function roundedRectShape(w, h, r, cx = 0, cy = 0) {
  const s = new THREE.Shape();
  const x = cx - w / 2, y = cy - h / 2;
  const [rl, rr] = (Array.isArray(r) ? r : [r, r]).map((v) => Math.min(v, w / 2, h / 2 - 0.001));
  s.moveTo(x + rl, y);
  s.lineTo(x + w - rr, y);
  s.absarc(x + w - rr, y + rr, rr, -Math.PI / 2, 0, false);
  if (h - 2 * rr > 0.01) s.lineTo(x + w, y + h - rr);
  s.absarc(x + w - rr, y + h - rr, rr, 0, Math.PI / 2, false);
  s.lineTo(x + rl, y + h);
  s.absarc(x + rl, y + h - rl, rl, Math.PI / 2, Math.PI, false);
  if (h - 2 * rl > 0.01) s.lineTo(x, y + rl);
  s.absarc(x + rl, y + rl, rl, Math.PI, Math.PI * 1.5, false);
  return s;
}

// Radii of the Flipper's outline grown by `d` (left end tighter, right end round around the d-pad).
export const bodyRadii = (d = 0) => [11.2 + d, 18.6 + d];

export function roundedRectPath(w, h, r, cx = 0, cy = 0) {
  const p = new THREE.Path();
  const sh = roundedRectShape(w, h, r, cx, cy);
  p.curves = sh.curves;
  return p;
}

// Points around a rounded rectangle, counter-clockwise, evenly spaced along the perimeter.
export function roundedRectPoints(w, h, r, n = 160) {
  const pts = roundedRectShape(w, h, r).getSpacedPoints(n);
  pts.pop(); // closing duplicate
  return pts;
}

// Extrude a 2D shape (in the XZ plane: shape +y = world -z) upward from y = 0.
export function extrudeUp(shape, depth, { bevel = 0, segments = 4, curveSegments = 24 } = {}) {
  const g = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(depth - 2 * bevel, 0.01),
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelSegments: segments,
    curveSegments,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  g.computeVertexNormals();
  return g;
}

export function annularSector(r0, r1, a0, a1) {
  const s = new THREE.Shape();
  s.moveTo(Math.cos(a0) * r1, Math.sin(a0) * r1);
  s.absarc(0, 0, r1, a0, a1, false);
  s.lineTo(Math.cos(a1) * r0, Math.sin(a1) * r0);
  s.absarc(0, 0, r0, a1, a0, true);
  return s;
}

// A wall following a closed outline (outer/inner point loops with matching indices),
// optionally with a gap where `skip(point)` is true. Built as an explicit triangle mesh.
export function wallRing(outer, inner, y0, y1, skip = null, { top = true, bottom = true } = {}) {
  const n = outer.length;
  const keep = outer.map((p, i) => !(skip && (skip(p) || skip(outer[(i + 1) % n]))));
  const pos = [];
  const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  const v = (p, y) => [p.x, y, -p.y];
  for (let i = 0; i < n; i++) {
    if (!keep[i]) continue;
    const j = (i + 1) % n;
    const o0 = outer[i], o1 = outer[j], i0 = inner[i], i1 = inner[j];
    quad(v(o0, y0), v(o1, y0), v(o1, y1), v(o0, y1)); // outside
    quad(v(i1, y0), v(i0, y0), v(i0, y1), v(i1, y1)); // inside
    // `top`/`bottom`: true, false, or a predicate per segment (cap only where the next band is cut away)
    const cap = (c) => (typeof c === 'function' ? c(o0) || c(o1) : c);
    if (cap(top)) quad(v(o0, y1), v(o1, y1), v(i1, y1), v(i0, y1)); // top lip
    if (cap(bottom)) quad(v(i0, y0), v(i1, y0), v(o1, y0), v(o0, y0)); // bottom
    // close the wall where the gap starts / ends
    if (!keep[(i - 1 + n) % n]) quad(v(i0, y0), v(o0, y0), v(o0, y1), v(i0, y1));
    if (!keep[j]) quad(v(o1, y0), v(i1, y0), v(i1, y1), v(o1, y1));
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export function place(mesh, x, y, z) {
  mesh.position.set(x, y, z);
  return mesh;
}
