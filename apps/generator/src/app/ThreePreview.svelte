<script module lang="ts">
  // Persist the user's orbit across preview-mode switches: the component is
  // destroyed when leaving 3D mode, so the camera pose lives at module level.
  let savedCamera: { position: [number, number, number]; target: [number, number, number] } | undefined;
</script>

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
  import { labelLineSegments, type GeometryIRV1, type Point2D, type Polygon2D } from "@topostack/core";

  let { geometry, exploded }: { geometry: GeometryIRV1; exploded: number } = $props();
  let container: HTMLButtonElement;
  let runtime: Runtime | undefined;

  interface Runtime {
    renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    rig: THREE.Group; content: THREE.Group; resizeObserver: ResizeObserver; frame: number;
    environmentTarget: THREE.WebGLRenderTarget; texture: THREE.CanvasTexture; hasFittedCamera: boolean;
    keyLight: THREE.DirectionalLight; detachContextHandlers: () => void;
  }

  interface StackedObject { layerIndex: number; baseZ: number }

  // Faces are pushed one depth unit back so coincident engrave/score lines
  // resolve in front of them regardless of viewing angle.
  const SURFACE_DEPTH_BIAS = { polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 } as const;

  // Markings ride above the face they annotate by a fraction of the stock
  // thickness, so thin material does not collapse them into the surface.
  function markingLift(materialThicknessMm: number): number { return Math.max(materialThicknessMm * 0.04, 0.05); }

  function shapeFromPolygon(polygon: Polygon2D): THREE.Shape {
    const shape = new THREE.Shape();
    polygon.outer.forEach((point, index) => index === 0 ? shape.moveTo(point.x, point.y) : shape.lineTo(point.x, point.y));
    polygon.holes.forEach((hole) => { const path = new THREE.Path(); hole.forEach((point, index) => index === 0 ? path.moveTo(point.x, point.y) : path.lineTo(point.x, point.y)); shape.holes.push(path); });
    return shape;
  }

  function makeWoodTexture(): THREE.CanvasTexture {
    const canvas = document.createElement("canvas"); canvas.width = 256; canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 0, 256, 0); gradient.addColorStop(0, "#d7b587"); gradient.addColorStop(0.45, "#edcf9f"); gradient.addColorStop(1, "#c99f6c");
    context.fillStyle = gradient; context.fillRect(0, 0, 256, 256);
    for (let y = 0; y < 256; y += 3) { const alpha = 0.04 + ((Math.sin(y * 0.18) + 1) / 2) * 0.05; context.strokeStyle = `rgba(70,42,22,${alpha})`; context.beginPath(); context.moveTo(0, y); for (let x = 0; x <= 256; x += 16) context.lineTo(x, y + Math.sin(x * 0.04 + y * 0.09) * 2.5); context.stroke(); }
    // A few heavier growth lines so the grain direction stays legible once the
    // per-layer rotation is applied.
    for (let line = 0; line < 7; line += 1) { const y = 18 + line * 37.5; context.strokeStyle = "rgba(96,58,30,0.16)"; context.lineWidth = 1.6; context.beginPath(); context.moveTo(0, y); for (let x = 0; x <= 256; x += 8) context.lineTo(x, y + Math.sin(x * 0.03 + line * 2.1) * 4.5); context.stroke(); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1 / 45, 1 / 45); return texture;
  }

  function disposeContent(content: THREE.Group): void {
    for (const child of [...content.children]) { child.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => { if (material instanceof THREE.MeshStandardMaterial) { material.map?.dispose(); material.bumpMap?.dispose(); } material.dispose(); }); } }); content.remove(child); }
  }

  // Deterministic per-layer randomness: grain orientation must survive
  // geometry rebuilds without visibly re-rolling, so seed from the layer index.
  function mulberry32(seed: number): () => number {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Each physical layer is cut from its own sheet, so grain direction is
  // uniform within a layer but varies between layers.
  function layerGrainTexture(base: THREE.CanvasTexture, layerIndex: number): THREE.Texture {
    const random = mulberry32(layerIndex + 1);
    const grain = base.clone();
    grain.center.set(0.5, 0.5);
    grain.rotation = random() * Math.PI * 2;
    grain.offset.set(random(), random());
    grain.needsUpdate = true;
    return grain;
  }
  function linePoints(points: Point2D[], z: number): THREE.Vector3[] { return points.map((point) => new THREE.Vector3(point.x, point.y, z)); }
  function labelPoints(label: string, origin: Point2D, rotationRad = 0): THREE.Vector3[] { return labelLineSegments(label, origin, 0, 0, rotationRad).flatMap((segment) => [new THREE.Vector3(segment.start.x, segment.start.y, 0), new THREE.Vector3(segment.end.x, segment.end.y, 0)]); }

  // Fast path for the exploded slider: only mesh z-positions move, so a drag
  // never tears down or re-extrudes the scene.
  function applyExploded(content: THREE.Group, amount: number): void {
    const layerGap = amount * 13;
    for (const child of content.children) {
      const stacked = child.userData as StackedObject;
      child.position.z = stacked.baseZ + stacked.layerIndex * layerGap;
    }
  }

  function addStacked(content: THREE.Group, object: THREE.Object3D, layerIndex: number, baseZ: number): void {
    object.userData = { layerIndex, baseZ } satisfies StackedObject;
    content.add(object);
  }

  onMount(() => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#20231d");
    const camera = new THREE.PerspectiveCamera(34, 1, 10, 4_000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; container.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer); const environmentTarget = pmrem.fromScene(new RoomEnvironment()); pmrem.dispose(); scene.environment = environmentTarget.texture; scene.environmentIntensity = 0.38;
    // Layer steps read through cast shadows plus a cool fill from the opposite
    // quadrant; the warm key alone left the stepped edges flat. The key light's
    // position and shadow frustum are fitted to the model in the rebuild effect.
    const keyLight = new THREE.DirectionalLight(0xffe7c2, 3.2); keyLight.position.set(-180, -120, 280); keyLight.castShadow = true; keyLight.shadow.mapSize.set(2048, 2048); keyLight.shadow.bias = -0.0002; scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa8c6e8, 0.85); fillLight.position.set(210, 150, 120); scene.add(fillLight);
    scene.add(new THREE.HemisphereLight(0x9fb8ad, 0x2d2118, 0.9));
    const rig = new THREE.Group(); const content = new THREE.Group(); content.scale.y = -1; rig.add(content); scene.add(rig);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.065; controls.maxPolarAngle = Math.PI * 0.95; controls.minDistance = 120; controls.maxDistance = 1800; controls.target.set(0, 0, 10);
    let hasFittedCamera = false;
    if (savedCamera) { camera.position.set(...savedCamera.position); controls.target.set(...savedCamera.target); controls.update(); hasFittedCamera = true; }
    const texture = makeWoodTexture();
    const resizeObserver = new ResizeObserver(([entry]) => { const width = entry?.contentRect.width ?? 0; const height = entry?.contentRect.height ?? 0; if (width <= 0 || height <= 0) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); }); resizeObserver.observe(container);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)"); let start = performance.now();
    const animate = (time: number) => { if (!reducedMotion.matches) { const elapsed = (time - start) / 1000; rig.position.y = Math.sin(elapsed * 0.37) * 1.2; rig.rotation.z = Math.sin(elapsed * 0.23) * 0.006; } else { rig.position.y = 0; rig.rotation.z = 0; start = time; } controls.update(); renderer.render(scene, camera); if (runtime) runtime.frame = requestAnimationFrame(animate); };
    // A GPU reset otherwise leaves a dead black canvas: swallow the loss and
    // restart the loop once the driver hands the context back.
    const onContextLost = (event: Event) => { event.preventDefault(); if (runtime) cancelAnimationFrame(runtime.frame); };
    const onContextRestored = () => { if (runtime) runtime.frame = requestAnimationFrame(animate); };
    renderer.domElement.addEventListener("webglcontextlost", onContextLost);
    renderer.domElement.addEventListener("webglcontextrestored", onContextRestored);
    const detachContextHandlers = () => { renderer.domElement.removeEventListener("webglcontextlost", onContextLost); renderer.domElement.removeEventListener("webglcontextrestored", onContextRestored); };
    runtime = { renderer, camera, controls, rig, content, resizeObserver, frame: requestAnimationFrame(animate), environmentTarget, texture, hasFittedCamera, keyLight, detachContextHandlers };
    return () => {
      if (!runtime) return;
      const { position } = runtime.camera; const { target } = runtime.controls;
      savedCamera = { position: [position.x, position.y, position.z], target: [target.x, target.y, target.z] };
      cancelAnimationFrame(runtime.frame); runtime.detachContextHandlers(); runtime.resizeObserver.disconnect(); disposeContent(runtime.content); runtime.texture.dispose(); runtime.environmentTarget.dispose(); runtime.controls.dispose(); runtime.renderer.dispose(); runtime.renderer.domElement.remove(); runtime = undefined;
    };
  });

  // Full rebuild only when the geometry itself changes.
  $effect(() => {
    const activeGeometry = geometry;
    const timeout = window.setTimeout(() => {
      if (!runtime) return;
      disposeContent(runtime.content);
      const side = new THREE.MeshStandardMaterial({ color: 0x8b6039, roughness: 0.82, metalness: 0, ...SURFACE_DEPTH_BIAS });
      const engraveMaterial = new THREE.LineBasicMaterial({ color: 0x39291d });
      const scoreMaterial = new THREE.LineBasicMaterial({ color: 0x365c79 });
      const labelMaterial = new THREE.LineBasicMaterial({ color: 0x21170f });
      activeGeometry.layers.forEach((layer) => {
        const baseZ = layer.index * layer.materialThicknessMm;
        const grain = layerGrainTexture(runtime!.texture, layer.index);
        const face = new THREE.MeshStandardMaterial({ color: 0xe2bd88, map: grain, bumpMap: grain, bumpScale: 0.22, roughness: 0.7, metalness: 0.02, ...SURFACE_DEPTH_BIAS });
        layer.polygons.forEach((polygon) => {
          const extrusion = new THREE.ExtrudeGeometry(shapeFromPolygon(polygon), { depth: layer.materialThicknessMm, bevelEnabled: false, curveSegments: 8 });
          const mesh = new THREE.Mesh(extrusion, [face, side]);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          addStacked(runtime!.content, mesh, layer.index, baseZ);
        });
        layer.markings.forEach((marking) => {
          if (marking.points.length > 1) {
            const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints(marking.points, 0));
            addStacked(runtime!.content, new THREE.Line(lineGeometry, marking.operation === "score" ? scoreMaterial : engraveMaterial), layer.index, baseZ + layer.materialThicknessMm + markingLift(layer.materialThicknessMm));
          }
          if (marking.label && marking.points[0]) {
            const labelGeometry = new THREE.BufferGeometry().setFromPoints(labelPoints(marking.label, marking.points[0], marking.labelRotationRad));
            addStacked(runtime!.content, new THREE.LineSegments(labelGeometry, labelMaterial), layer.index, baseZ + layer.materialThicknessMm + markingLift(layer.materialThicknessMm) * 1.5);
          }
        });
      });
      applyExploded(runtime.content, untrack(() => exploded));
      const radius = Math.hypot(activeGeometry.widthMm / 2, activeGeometry.heightMm / 2);
      // Fit the key light and its shadow frustum to the model, including the
      // fully exploded stack height, so shadows stay crisp at every size.
      const stackHeight = activeGeometry.layers.length * ((activeGeometry.layers[0]?.materialThicknessMm ?? 1) + 13);
      const shadowHalfSize = Math.max(radius * 1.4, stackHeight);
      runtime.keyLight.position.set(-0.5, -0.33, 0.78).normalize().multiplyScalar(radius * 2.6);
      runtime.keyLight.shadow.camera.left = -shadowHalfSize; runtime.keyLight.shadow.camera.right = shadowHalfSize;
      runtime.keyLight.shadow.camera.bottom = -shadowHalfSize; runtime.keyLight.shadow.camera.top = shadowHalfSize;
      runtime.keyLight.shadow.camera.near = radius * 0.4; runtime.keyLight.shadow.camera.far = radius * 6;
      runtime.keyLight.shadow.normalBias = Math.max(radius * 0.003, 0.05);
      runtime.keyLight.shadow.camera.updateProjectionMatrix();
      runtime.controls.minDistance = radius * 1.2; runtime.controls.maxDistance = radius * 8;
      runtime.camera.near = Math.max(radius * 0.15, 0.5); runtime.camera.far = radius * 24; runtime.camera.updateProjectionMatrix();
      if (!runtime.hasFittedCamera) { runtime.camera.position.set(radius * 0.15, -radius * 1.65, radius * 2.7); runtime.controls.target.set(0, 0, (activeGeometry.layers.length * (activeGeometry.layers[0]?.materialThicknessMm ?? 1)) / 2); runtime.hasFittedCamera = true; }
      runtime.controls.update();
    }, 160);
    return () => window.clearTimeout(timeout);
  });

  // Exploded-slider changes only reposition existing meshes.
  $effect(() => {
    const activeExploded = exploded;
    if (runtime) applyExploded(runtime.content, activeExploded);
  });

  function handleKeyDown(event: KeyboardEvent): void {
    if (!runtime) return; if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "+", "-"].includes(event.key)) event.preventDefault();
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") { const direction = event.key === "ArrowLeft" ? 1 : -1; const relative = runtime.camera.position.clone().sub(runtime.controls.target).applyAxisAngle(new THREE.Vector3(0, 0, 1), direction * 0.12); runtime.camera.position.copy(runtime.controls.target).add(relative); }
    else if (event.key === "ArrowUp" || event.key === "+") runtime.camera.position.lerp(runtime.controls.target, 0.08);
    else if (event.key === "ArrowDown" || event.key === "-") runtime.camera.position.lerp(runtime.controls.target, -0.08);
    runtime.controls.update();
  }
</script>

<button type="button" class="three-stage" bind:this={container} onkeydown={handleKeyDown} aria-label="Interactive 3D preview. Drag or use left and right arrows to orbit; scroll or use up and down arrows to zoom."></button>
