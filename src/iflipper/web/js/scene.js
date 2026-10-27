// Desk scene: renderer, lighting, the repair mat, camera and render-on-demand loop.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/addons/RoundedBoxGeometry.js';
import { MAT, matTextures, rng, woodTextures } from './textures.js';

const HOME = { pos: new THREE.Vector3(0, 205, 255), target: new THREE.Vector3(0, 4, 4) };
const REST = new THREE.Vector3(0, 0, 6); // where the Flipper comes to rest on the mat

export class Stage {
  constructor(canvas, { quality = 'high', transparent = false } = {}) {
    this.canvas = canvas;
    this.quality = quality;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.25));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.92;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.shadowMap.autoUpdate = false;

    this.scene = new THREE.Scene();
    this.scene.background = transparent ? null : new THREE.Color(0x0e0f12);
    this.transparent = transparent;
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(32, 1, 5, 4000);
    this.camera.position.copy(HOME.pos);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.target.copy(HOME.target);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 110;
    this.controls.maxDistance = 650;
    this.controls.maxPolarAngle = THREE.MathUtils.degToRad(76);
    this.controls.enablePan = false;
    this.controls.addEventListener('change', () => this.invalidate());

    if (!transparent) this.buildDesk();
    this.buildLights();
    this.clock = new THREE.Clock();
    this.animators = new Set(); // fn(dt) -> true while still animating
    this.dirty = true;
    this.shadowFrames = 2;
    this.timeScale = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.renderer.setAnimationLoop(() => this.tick());
  }

  buildDesk() {
    const wood = woodTextures();
    const desk = new THREE.Mesh(new THREE.PlaneGeometry(2400, 1600),
      new THREE.MeshStandardMaterial({ ...wood, roughness: 0.62, color: 0xd8c8b8 }));
    desk.rotation.x = -Math.PI / 2;
    desk.position.y = -6;
    desk.receiveShadow = true;
    this.scene.add(desk);

    const mt = matTextures('#2c4b5b');
    const matMat = new THREE.MeshStandardMaterial({ map: mt.map, bumpMap: mt.bumpMap, bumpScale: 3, roughness: 0.82 });
    const side = new THREE.MeshStandardMaterial({ color: 0x2c4a59, roughness: 0.85 });
    const mat = new THREE.Mesh(new RoundedBoxGeometry(MAT.w, 6, MAT.h, 4, 2.5), [side, side, matMat, side, side, side]);
    mat.position.y = -3;
    mat.receiveShadow = true;
    this.scene.add(mat);
    this.mat = mat;

    // A few props so the bench feels used.
    this.buildProps();
  }

  buildProps() {
    const r = rng(11);
    // Solder spool
    const spool = new THREE.Group();
    const flange = new THREE.MeshStandardMaterial({ color: 0x1d6fd6, roughness: 0.45 });
    const wire = new THREE.MeshStandardMaterial({ color: 0xc9cdd2, metalness: 1, roughness: 0.32 });
    for (const y of [0, 26]) {
      const f = new THREE.Mesh(new THREE.CylinderGeometry(30, 30, 2.2, 48), flange);
      f.position.y = y + 1.1;
      spool.add(f);
    }
    const coil = new THREE.Mesh(new THREE.CylinderGeometry(24, 24, 24, 48, 1, true), wire);
    coil.position.y = 14;
    spool.add(coil);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(8, 8, 28, 24, 1, true), new THREE.MeshStandardMaterial({ color: 0x0e0e10, side: THREE.DoubleSide }));
    hub.position.y = 14;
    spool.add(hub);
    const tail = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
      new THREE.Vector3(24, 18, 0), new THREE.Vector3(40, 10, 10), new THREE.Vector3(60, 1, 30), new THREE.Vector3(85, 0.6, 26),
    ]), 40, 0.5, 6), wire);
    spool.add(tail);
    spool.position.set(285, -6, -170);
    this.scene.add(spool);

    // Tweezers on the mat
    const steel = new THREE.MeshStandardMaterial({ color: 0xd5d8dc, metalness: 1, roughness: 0.22 });
    const tw = new THREE.Group();
    for (const s of [-1, 1]) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(115, 1, 6), steel);
      arm.position.set(0, 1.6, s * 2.8);
      arm.rotation.y = s * 0.035;
      tw.add(arm);
    }
    tw.position.set(130, 0, 120);
    tw.rotation.y = -0.5;
    this.scene.add(tw);

    // Screws scattered in the trays
    const screwMat = new THREE.MeshStandardMaterial({ color: 0x9fa4aa, metalness: 1, roughness: 0.3 });
    const screwGeo = new THREE.CylinderGeometry(1.1, 1.1, 5, 10);
    const headGeo = new THREE.CylinderGeometry(2, 2, 1.2, 14);
    const screws = new THREE.Group();
    for (let i = 0; i < 9; i++) {
      const s = new THREE.Group();
      s.add(new THREE.Mesh(screwGeo, screwMat));
      const h = new THREE.Mesh(headGeo, screwMat);
      h.position.y = 2.8;
      s.add(h);
      s.rotation.z = Math.PI / 2;
      s.rotation.y = r() * Math.PI;
      const tray = Math.floor(r() * 6);
      s.position.set(-MAT.w / 2 + 330 + (tray % 3) * 30 + r() * 8, 2, -MAT.h / 2 + 40 + Math.floor(tray / 3) * 30 + r() * 6);
      screws.add(s);
    }
    this.scene.add(screws);

    for (const o of [spool, tw, screws]) o.traverse((m) => { if (m.isMesh) { m.castShadow = true; m.receiveShadow = true; } });
  }

  buildLights() {
    const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x2a1d14, 0.35);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xfff1e0, 2.4);
    key.position.set(-160, 340, 140);
    key.castShadow = true;
    const s = key.shadow;
    s.mapSize.set(this.quality === 'high' ? 2048 : 1024, this.quality === 'high' ? 2048 : 1024);
    s.camera.left = -260; s.camera.right = 260; s.camera.top = 200; s.camera.bottom = -200;
    s.camera.near = 50; s.camera.far = 900;
    s.bias = -0.0004;
    s.normalBias = 0.6;
    s.radius = 4;
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xbcd6ff, 0.7);
    rim.position.set(220, 160, -260);
    this.scene.add(rim);
    // Warm desk-lamp pool
    const lamp = new THREE.SpotLight(0xffd2a0, 5000, 1200, 0.55, 0.8, 2);
    lamp.position.set(180, 420, -60);
    lamp.target.position.set(-20, 0, 20);
    this.scene.add(lamp, lamp.target);
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth, h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Keep the Flipper big on narrow windows.
    this.camera.fov = w / h < 1.3 ? 42 : 32;
    this.camera.updateProjectionMatrix();
    this.invalidate();
  }

  invalidate(shadows = false) {
    this.dirty = true;
    if (shadows) this.shadowFrames = Math.max(this.shadowFrames, 2);
  }

  animate(fn) {
    this.animators.add(fn);
    this.invalidate();
  }

  tick() {
    const dt = Math.min(this.clock.getDelta(), 0.05) * this.timeScale;
    for (const fn of [...this.animators]) {
      if (!fn(dt)) this.animators.delete(fn);
      this.dirty = true;
    }
    if (this.controls.update()) this.dirty = true;
    if (!this.dirty) return; // nothing changed: no GPU work at all
    if (this.shadowFrames > 0) {
      this.renderer.shadowMap.needsUpdate = true;
      this.shadowFrames--;
    }
    this.renderer.render(this.scene, this.camera);
    this.dirty = false;
  }

  resetView() {
    const from = this.camera.position.clone(), to = HOME.pos.clone();
    const tFrom = this.controls.target.clone();
    let t = 0;
    this.animate((dt) => {
      t = Math.min(1, t + dt * 1.8);
      const e = 1 - Math.pow(1 - t, 3);
      this.camera.position.lerpVectors(from, to, e);
      this.controls.target.lerpVectors(tFrom, HOME.target, e);
      return t < 1;
    });
  }

  // Throw an object onto the mat: it flies in, flips over, bounces and slides to a stop.
  throwIn(obj, { lift = 0, onImpact } = {}) {
    const start = new THREE.Vector3(-380, 230, 360);
    const land = new THREE.Vector3(-70, 0, 40);
    const rest = REST.clone();
    const restYaw = -0.06;
    const tFly = 0.62, tTotal = 2.3;
    let t = 0, impacts = 0;
    obj.visible = true;
    const bounce = [0, 0.18, 0.11, 0.06]; // hop heights relative to the fall
    this.animate((dt) => {
      t += dt;
      const p = obj.position, rot = obj.rotation;
      if (t < tFly) {
        const u = t / tFly;
        p.lerpVectors(start, land, u);
        p.y = THREE.MathUtils.lerp(start.y, 0, u) + Math.sin(u * Math.PI) * 90;
        rot.set(-Math.PI * 2 * (1 - u) * 1.0 + 0.35 * (1 - u), 1.4 - 1.2 * u, 0.5 * (1 - u));
      } else {
        const u = Math.min(1, (t - tFly) / (tTotal - tFly));
        // decaying hops: three arcs in the first 45% of the slide
        const hopT = u / 0.45;
        const k = Math.min(3, Math.floor(hopT * 3));
        const frac = hopT * 3 - k;
        const h = hopT < 1 ? Math.sin(frac * Math.PI) * 60 * bounce[k + 1] : 0;
        if (hopT < 1 && k + 1 > impacts) { impacts = k + 1; onImpact && onImpact(1 / impacts); }
        const slide = 1 - Math.pow(1 - u, 3.2);
        p.lerpVectors(land, rest, slide);
        p.y = h;
        // rocking on its edges, dying out
        const damp = Math.exp(-u * 5.5);
        rot.set(Math.sin(u * 26) * 0.22 * damp, THREE.MathUtils.lerp(0.2, restYaw, slide) + Math.sin(u * 9) * 0.05 * damp,
          Math.sin(u * 21 + 1) * 0.16 * damp);
        if (u >= 1) {
          if (impacts < 4) onImpact && onImpact(0.15);
          p.copy(rest);
          rot.set(0, restYaw, 0);
          p.y += lift;
          this.invalidate(true);
          return false;
        }
      }
      p.y += lift;
      this.shadowFrames = Math.max(this.shadowFrames, 1);
      return true;
    });
  }

  // Lift the object off the mat and out of view.
  takeAway(obj, done) {
    const from = obj.position.clone();
    let t = 0;
    this.animate((dt) => {
      t = Math.min(1, t + dt * 1.6);
      const e = t * t;
      obj.position.set(from.x - e * 260, from.y + e * 220, from.z - e * 120);
      obj.rotation.z = e * 0.8;
      this.shadowFrames = 1;
      if (t >= 1) { obj.visible = false; this.invalidate(true); done && done(); return false; }
      return true;
    });
  }
}
