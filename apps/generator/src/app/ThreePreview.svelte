<script lang="ts">
  import { onMount } from "svelte";
  import * as THREE from "three";
  import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
  import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
  import type { GeometryIRV1, Point2D, Polygon2D } from "@topostack/core";

  let { geometry, exploded }: { geometry: GeometryIRV1; exploded: number } = $props();
  let container: HTMLButtonElement;
  let runtime: Runtime | undefined;

  interface Runtime {
    renderer: THREE.WebGLRenderer; camera: THREE.PerspectiveCamera; controls: OrbitControls;
    rig: THREE.Group; content: THREE.Group; resizeObserver: ResizeObserver; frame: number;
    environmentTarget: THREE.WebGLRenderTarget; texture: THREE.CanvasTexture; hasFittedCamera: boolean;
  }

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
    for (let y = 0; y < 256; y += 3) { const alpha = 0.025 + ((Math.sin(y * 0.18) + 1) / 2) * 0.035; context.strokeStyle = `rgba(70,42,22,${alpha})`; context.beginPath(); context.moveTo(0, y); for (let x = 0; x <= 256; x += 16) context.lineTo(x, y + Math.sin(x * 0.04 + y * 0.09) * 2.5); context.stroke(); }
    const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(1 / 45, 1 / 45); return texture;
  }

  function disposeContent(content: THREE.Group): void {
    for (const child of [...content.children]) { child.traverse((object) => { if (object instanceof THREE.Mesh || object instanceof THREE.Line) { object.geometry.dispose(); const materials = Array.isArray(object.material) ? object.material : [object.material]; materials.forEach((material) => material.dispose()); } }); content.remove(child); }
  }
  function linePoints(points: Point2D[], z: number): THREE.Vector3[] { return points.map((point) => new THREE.Vector3(point.x, point.y, z)); }

  onMount(() => {
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#20231d");
    const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 10_000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }); renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05; renderer.outputColorSpace = THREE.SRGBColorSpace; container.appendChild(renderer.domElement);
    const pmrem = new THREE.PMREMGenerator(renderer); const environmentTarget = pmrem.fromScene(new RoomEnvironment()); pmrem.dispose(); scene.environment = environmentTarget.texture; scene.environmentIntensity = 0.42;
    const light = new THREE.DirectionalLight(0xffe7c2, 3.2); light.position.set(-180, -120, 280); scene.add(light); scene.add(new THREE.HemisphereLight(0x9fb8ad, 0x2d2118, 1.1));
    const rig = new THREE.Group(); const content = new THREE.Group(); content.scale.y = -1; rig.add(content); scene.add(rig);
    const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.065; controls.maxPolarAngle = Math.PI * 0.95; controls.minDistance = 120; controls.maxDistance = 1800; controls.target.set(0, 0, 10);
    const texture = makeWoodTexture();
    const resizeObserver = new ResizeObserver(([entry]) => { const width = entry?.contentRect.width ?? 0; const height = entry?.contentRect.height ?? 0; if (width <= 0 || height <= 0) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); }); resizeObserver.observe(container);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)"); let start = performance.now();
    const animate = (time: number) => { if (!reducedMotion.matches) { const elapsed = (time - start) / 1000; rig.position.y = Math.sin(elapsed * 0.37) * 1.2; rig.rotation.z = Math.sin(elapsed * 0.23) * 0.006; } else { rig.position.y = 0; rig.rotation.z = 0; start = time; } controls.update(); renderer.render(scene, camera); if (runtime) runtime.frame = requestAnimationFrame(animate); };
    runtime = { renderer, camera, controls, rig, content, resizeObserver, frame: requestAnimationFrame(animate), environmentTarget, texture, hasFittedCamera: false };
    return () => { if (!runtime) return; cancelAnimationFrame(runtime.frame); runtime.resizeObserver.disconnect(); disposeContent(runtime.content); runtime.texture.dispose(); runtime.environmentTarget.dispose(); runtime.controls.dispose(); runtime.renderer.dispose(); runtime.renderer.domElement.remove(); runtime = undefined; };
  });

  $effect(() => {
    const activeGeometry = geometry; const activeExploded = exploded;
    const timeout = window.setTimeout(() => {
      if (!runtime) return; disposeContent(runtime.content); const layerGap = activeExploded * 13;
      activeGeometry.layers.forEach((layer) => { const z = layer.index * (layer.materialThicknessMm + layerGap); layer.polygons.forEach((polygon) => { const extrusion = new THREE.ExtrudeGeometry(shapeFromPolygon(polygon), { depth: layer.materialThicknessMm, bevelEnabled: false, curveSegments: 8 }); const face = new THREE.MeshStandardMaterial({ color: 0xe2bd88, map: runtime!.texture, bumpMap: runtime!.texture, bumpScale: 0.22, roughness: 0.7, metalness: 0.02 }); const side = new THREE.MeshStandardMaterial({ color: 0x8b6039, roughness: 0.82, metalness: 0 }); const mesh = new THREE.Mesh(extrusion, [face, side]); mesh.position.z = z; runtime!.content.add(mesh); }); layer.markings.forEach((marking) => { const lineGeometry = new THREE.BufferGeometry().setFromPoints(linePoints(marking.points, z + layer.materialThicknessMm + 0.12)); const lineMaterial = new THREE.LineBasicMaterial({ color: marking.operation === "score" ? 0x365c79 : 0x39291d }); runtime!.content.add(new THREE.Line(lineGeometry, lineMaterial)); }); });
      const radius = Math.hypot(activeGeometry.widthMm / 2, activeGeometry.heightMm / 2); runtime.controls.minDistance = radius * 1.2; runtime.controls.maxDistance = radius * 8;
      if (!runtime.hasFittedCamera) { runtime.camera.position.set(radius * 0.15, -radius * 1.65, radius * 2.7); runtime.controls.target.set(0, 0, (activeGeometry.layers.length * (activeGeometry.layers[0]?.materialThicknessMm ?? 1)) / 2); runtime.hasFittedCamera = true; }
      runtime.controls.update();
    }, 160);
    return () => window.clearTimeout(timeout);
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
