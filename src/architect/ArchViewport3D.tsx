import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { buildContactShadow } from '../lib/contactShadow';
import { preparePhotorealMaterial } from '../lib/roomRendering';
import { buildParametricObject3D } from './parametricFurniture';
import { buildArchitecturalRoom, type BuiltRoomResult } from './roomGeometryBuilder';
import { computeSolarLighting } from './solarMath';
import { resolveHorizontalMove3D, resolveVerticalMove3D } from './surfacePhysics';
import { getHouseBounds, getWallLengthM, type ArchPlacedObject, type ArchRoomProject, type ArchSelection, type WallId } from './types';

interface RoomRect2D {
  cx: number;
  cz: number;
  w: number;
  d: number;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function getAllRoomRects(p: ArchRoomProject): RoomRect2D[] {
  const rects: RoomRect2D[] = [
    {
      cx: 0,
      cz: 0,
      w: p.widthM,
      d: p.depthM,
      minX: -p.widthM * 0.5,
      maxX: p.widthM * 0.5,
      minZ: -p.depthM * 0.5,
      maxZ: p.depthM * 0.5,
    },
  ];
  for (const r of p.adjacentRooms || []) {
    rects.push({
      cx: r.centerXM,
      cz: r.centerZM,
      w: r.widthM,
      d: r.depthM,
      minX: r.centerXM - r.widthM * 0.5,
      maxX: r.centerXM + r.widthM * 0.5,
      minZ: r.centerZM - r.depthM * 0.5,
      maxZ: r.centerZM + r.depthM * 0.5,
    });
  }
  return rects;
}

export type ArchCameraMode = 'free' | 'plan' | 'inside';

export interface ArchViewportHandle {
  captureSnapshot: (hideSelection?: boolean) => string | null;
  resetCamera: (mode?: ArchCameraMode) => void;
  focusWall: (wall: WallId) => void;
  enterFromDoor: () => void;
  walkStep: (forwardM: number, rightM: number) => void;
  turnLook: (deltaYawDeg: number) => void;
  nudgeObjectRelative: (objId: string, forwardM: number, rightM: number) => void;
  nudgeObjectVertical: (objId: string, deltaYM: number) => void;
  setObjectElevation: (objId: string, targetYM: number) => void;
  snapObjectToSurface: (objId: string) => void;
}

interface Props {
  project: ArchRoomProject;
  cameraMode: ArchCameraMode;
  dragAxis?: 'xz' | 'y';
  showGrid: boolean;
  showSunOrb: boolean;
  showDoorArcs: boolean;
  autoRotate?: boolean;
  selection: ArchSelection;
  onSelect: (sel: ArchSelection) => void;
  onMoveObject: (id: string, x: number, z: number, y?: number) => void;
  onExitWalkthrough?: () => void;
  onWarningsChange?: (warnings: string[]) => void;
  onLoadingChange?: (loadingCount: number) => void;
  onToast?: (msg: string) => void;
}

/** Computes realistic doorway spawn position (just at entrance door threshold stepping in) and look angles */
function computeDoorwaySpawn(p: ArchRoomProject): {
  startPos: THREE.Vector3;
  endPos: THREE.Vector3;
  yaw: number;
  pitch: number;
} {
  const eyeY = Math.min(1.65, Math.max(1.2, p.ceilingM - 0.38));
  const door = p.doors[0];
  let startX = 0;
  let startZ = p.depthM * 0.5 - 0.25;
  let inX = 0;
  let inZ = -1;

  if (door) {
    const lenM = getWallLengthM(door.wall, p.widthM, p.depthM);
    const u = door.offsetCm / 100 - lenM * 0.5;
    if (door.wall === 'north') {
      startX = u;
      startZ = -p.depthM * 0.5 + 0.08;
      inX = 0;
      inZ = 1;
    } else if (door.wall === 'south') {
      startX = -u;
      startZ = p.depthM * 0.5 - 0.08;
      inX = 0;
      inZ = -1;
    } else if (door.wall === 'west') {
      startX = -p.widthM * 0.5 + 0.08;
      startZ = -u;
      inX = 1;
      inZ = 0;
    } else {
      startX = p.widthM * 0.5 - 0.08;
      startZ = u;
      inX = -1;
      inZ = 0;
    }
  }

  const endX = Math.max(-p.widthM * 0.5 + 0.35, Math.min(p.widthM * 0.5 - 0.35, startX + inX * 0.85));
  const endZ = Math.max(-p.depthM * 0.5 + 0.35, Math.min(p.depthM * 0.5 - 0.35, startZ + inZ * 0.85));

  const lookTargetX = 0;
  const lookTargetY = Math.min(1.38, eyeY - 0.14);
  const lookTargetZ = 0;
  const dx = lookTargetX - endX;
  const dy = lookTargetY - eyeY;
  const dz = lookTargetZ - endZ;
  const yaw = Math.atan2(-dx, -dz);
  const pitch = Math.max(-0.4, Math.min(0.4, Math.atan2(dy, Math.max(0.2, Math.hypot(dx, dz)))));

  return {
    startPos: new THREE.Vector3(startX, eyeY, startZ),
    endPos: new THREE.Vector3(endX, eyeY, endZ),
    yaw,
    pitch,
  };
}

export const ArchViewport3D = forwardRef<ArchViewportHandle, Props>(
  (
    {
      project,
      cameraMode,
      dragAxis = 'xz',
      showGrid,
      showSunOrb,
      showDoorArcs,
      autoRotate = false,
      selection,
      onSelect,
      onMoveObject,
      onExitWalkthrough,
      onWarningsChange,
      onLoadingChange,
      onToast,
    },
    ref
  ) => {
    const hostRef = useRef<HTMLDivElement | null>(null);
    const projectRef = useRef(project);
    projectRef.current = project;
    const camModeRef = useRef(cameraMode);
    camModeRef.current = cameraMode;
    const dragAxisRef = useRef<'xz' | 'y'>(dragAxis || 'xz');
    dragAxisRef.current = dragAxis || 'xz';
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const showGridRef = useRef(showGrid);
    showGridRef.current = showGrid;
    const showDoorArcsRef = useRef(showDoorArcs);
    showDoorArcsRef.current = showDoorArcs;

    // First-person walkthrough state
    const fpsRef = useRef({
      yaw: 0,
      pitch: -0.06,
      looking: false,
      lastX: 0,
      lastY: 0,
      keys: new Set<string>(),
      walkRaf: 0,
      lastTs: 0,
      entryAnimRaf: 0,
    });

    const dragRef = useRef<{
      id: string;
      hx: number;
      hz: number;
      px: number;
      py: number;
      pz: number;
      liveX: number;
      liveY: number;
      liveZ: number;
      startClientX: number;
      startClientY: number;
      lastClientX: number;
      lastClientY: number;
      useScreenDelta: boolean;
      verticalDrag: boolean;
      moved: boolean;
      wasSelected: boolean;
    } | null>(null);
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
    const activePointersRef = useRef<Set<number>>(new Set());
    const hitObstacleRef = useRef(false);

    const engineRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      roomRoot: THREE.Group;
      objectsRoot: THREE.Group;
      sunLight: THREE.DirectionalLight;
      hemiLight: THREE.HemisphereLight;
      bounceLight: THREE.DirectionalLight;
      sunOrbGroup: THREE.Group;
      sunRayLine: THREE.Line;
      haloMesh: THREE.Mesh;
      selBox: THREE.LineSegments;
      selMat: THREE.LineBasicMaterial;
      builtRoom: BuiltRoomResult | null;
      gltfCache: Map<string, THREE.Group>;
      mountedObjects: Map<string, { sig: string; root: THREE.Group; dispose?: () => void }>;
      loadingKeys: Set<string>;
      shadowsDirty: boolean;
      lastCutawayMask: string;
      rafScheduled: number;
      renderFrame: () => void;
      scheduleRender: (dirtyShadows?: boolean) => void;
    } | null>(null);

    const applyFpsCameraRotation = () => {
      const eng = engineRef.current;
      if (!eng) return;
      eng.camera.rotation.order = 'YXZ';
      eng.camera.rotation.y = fpsRef.current.yaw;
      eng.camera.rotation.x = fpsRef.current.pitch;
      eng.camera.rotation.z = 0;
    };

    const moveFpsBy = (forwardM: number, rightM: number) => {
      const eng = engineRef.current;
      if (!eng || camModeRef.current !== 'inside') return;
      const p = projectRef.current;
      const yaw = fpsRef.current.yaw;
      const fx = -Math.sin(yaw);
      const fz = -Math.cos(yaw);
      const rx = Math.cos(yaw);
      const rz = -Math.sin(yaw);

      const candX = eng.camera.position.x + fx * forwardM + rx * rightM;
      const candZ = eng.camera.position.z + fz * forwardM + rz * rightM;
      const margin = 0.28;

      if ((p.adjacentRooms?.length || 0) > 0) {
        const rects = getAllRoomRects(p);
        const hb = getHouseBounds(p);
        const pad = p.wallThicknessM * 0.65;
        const inHouse = (x: number, z: number) =>
          x >= hb.minX + margin &&
          x <= hb.maxX - margin &&
          z >= hb.minZ + margin &&
          z <= hb.maxZ - margin &&
          rects.some((r) => x >= r.minX - pad && x <= r.maxX + pad && z >= r.minZ - pad && z <= r.maxZ + pad);

        if (inHouse(candX, candZ)) {
          eng.camera.position.x = candX;
          eng.camera.position.z = candZ;
        } else if (inHouse(candX, eng.camera.position.z)) {
          eng.camera.position.x = candX;
        } else if (inHouse(eng.camera.position.x, candZ)) {
          eng.camera.position.z = candZ;
        }
      } else {
        eng.camera.position.x = Math.max(-p.widthM * 0.5 + margin, Math.min(p.widthM * 0.5 - margin, candX));
        eng.camera.position.z = Math.max(-p.depthM * 0.5 + margin, Math.min(p.depthM * 0.5 - margin, candZ));
      }
      eng.camera.position.y = Math.min(1.65, Math.max(1.2, p.ceilingM - 0.38));
      applyFpsCameraRotation();
      eng.scheduleRender(false);
    };

    const enterFromDoorway = (animateStepIn = true) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (fpsRef.current.entryAnimRaf) {
        cancelAnimationFrame(fpsRef.current.entryAnimRaf);
        fpsRef.current.entryAnimRaf = 0;
      }

      const spawn = computeDoorwaySpawn(projectRef.current);
      eng.controls.enabled = false;
      eng.camera.fov = 62;
      eng.camera.near = 0.08;
      eng.camera.far = 90;
      eng.camera.updateProjectionMatrix();
      fpsRef.current.yaw = spawn.yaw;
      fpsRef.current.pitch = spawn.pitch;

      if (!animateStepIn) {
        eng.camera.position.copy(spawn.endPos);
        applyFpsCameraRotation();
        eng.scheduleRender(true);
        return;
      }

      // Smooth cinematic doorway walk-in (stepping through entrance door into room over 650 ms!)
      eng.camera.position.copy(spawn.startPos);
      applyFpsCameraRotation();
      eng.scheduleRender(true);
      const t0 = performance.now();
      const duration = 650;
      const step = (now: number) => {
        if (camModeRef.current !== 'inside' || !engineRef.current) {
          fpsRef.current.entryAnimRaf = 0;
          return;
        }
        const t = Math.min(1, (now - t0) / duration);
        const ease = 1 - Math.pow(1 - t, 3);
        engineRef.current.camera.position.lerpVectors(spawn.startPos, spawn.endPos, ease);
        applyFpsCameraRotation();
        engineRef.current.scheduleRender(false);
        if (t < 1) {
          fpsRef.current.entryAnimRaf = requestAnimationFrame(step);
        } else {
          fpsRef.current.entryAnimRaf = 0;
        }
      };
      fpsRef.current.entryAnimRaf = requestAnimationFrame(step);
    };

    const applyCameraPreset = (mode: ArchCameraMode) => {
      const eng = engineRef.current;
      if (!eng) return;
      if (fpsRef.current.entryAnimRaf) {
        cancelAnimationFrame(fpsRef.current.entryAnimRaf);
        fpsRef.current.entryAnimRaf = 0;
      }
      const p = projectRef.current;
      const hb = getHouseBounds(p);
      const maxSpan = Math.max(hb.totalW, hb.totalD);
      const hasMulti = (p.adjacentRooms?.length || 0) > 0;
      if (mode === 'inside') {
        enterFromDoorway(true);
        return;
      }

      eng.camera.rotation.order = 'XYZ';
      eng.controls.enabled = true;

      if (mode === 'plan') {
        eng.camera.fov = 16;
        eng.camera.near = 2.0;
        eng.camera.far = Math.max(220, maxSpan * 18);
        eng.camera.updateProjectionMatrix();
        const aspect = Math.max(0.55, eng.camera.aspect || 1);
        const fitDiv = Math.min(1, aspect * 0.9);
        eng.camera.position.set(hb.centerX, (maxSpan * (hasMulti ? 5.2 : 5.25)) / fitDiv, hb.centerZ + 0.01);
        eng.controls.target.set(hb.centerX, 0, hb.centerZ);
        eng.controls.maxPolarAngle = Math.PI * 0.49;
        eng.controls.minDistance = 4.0;
        eng.controls.maxDistance = Math.max(80, maxSpan * 8);
      } else {
        eng.camera.fov = 42;
        eng.camera.near = 0.08;
        eng.camera.far = Math.max(90, maxSpan * 10);
        eng.camera.updateProjectionMatrix();
        eng.camera.position.set(
          hb.centerX + hb.totalW * (hasMulti ? 0.88 : 0.95),
          Math.max(4.0, maxSpan * (hasMulti ? 0.9 : 0.86)),
          hb.centerZ + hb.totalD * (hasMulti ? 1.06 : 1.05)
        );
        eng.controls.target.set(hb.centerX, p.ceilingM * (hasMulti ? 0.18 : 0.34), hb.centerZ);
        eng.controls.maxPolarAngle = Math.PI * 0.495;
        eng.controls.minDistance = 1.2;
        eng.controls.maxDistance = Math.max(24, maxSpan * 3.8);
      }
      eng.controls.update();
      eng.scheduleRender(true);
    };

    const focusOnWall = (wall: WallId) => {
      const eng = engineRef.current;
      if (!eng || camModeRef.current === 'inside') return;
      const p = projectRef.current;
      const maxSpan = Math.max(p.widthM, p.depthM);
      const camH = p.ceilingM + Math.max(1.85, maxSpan * 0.42);
      const targetY = p.ceilingM * 0.44;
      eng.camera.rotation.order = 'XYZ';
      eng.controls.enabled = true;
      eng.camera.fov = 42;
      eng.camera.near = 0.08;
      eng.camera.far = 90;
      eng.camera.updateProjectionMatrix();
      eng.controls.maxPolarAngle = Math.PI * 0.495;
      if (wall === 'north') {
        eng.camera.position.set(p.widthM * 0.42, camH, p.depthM * 1.15);
        eng.controls.target.set(0, targetY, -p.depthM * 0.25);
      } else if (wall === 'south') {
        eng.camera.position.set(-p.widthM * 0.42, camH, -p.depthM * 1.15);
        eng.controls.target.set(0, targetY, p.depthM * 0.25);
      } else if (wall === 'west') {
        eng.camera.position.set(p.widthM * 1.15, camH, p.depthM * 0.42);
        eng.controls.target.set(-p.widthM * 0.25, targetY, 0);
      } else {
        eng.camera.position.set(-p.widthM * 1.15, camH, -p.depthM * 0.42);
        eng.controls.target.set(p.widthM * 0.25, targetY, 0);
      }
      eng.controls.update();
      eng.scheduleRender(true);
    };

    useImperativeHandle(ref, () => ({
      captureSnapshot: (hideSelection = true) => {
        const eng = engineRef.current;
        if (!eng) return null;
        const prevSel = eng.selBox.visible;
        const prevOrb = eng.sunOrbGroup.visible;
        const prevCompass = eng.builtRoom?.compassRingGroup.visible ?? false;
        const prevOverlay = eng.builtRoom?.planOverlayGroup.visible ?? false;
        const prev3dLbl = eng.builtRoom?.room3dLabelsGroup.visible ?? false;
        if (hideSelection) {
          eng.selBox.visible = false;
          eng.sunOrbGroup.visible = false;
          if (eng.builtRoom && camModeRef.current !== 'plan') {
            eng.builtRoom.compassRingGroup.visible = false;
            eng.builtRoom.planOverlayGroup.visible = false;
            eng.builtRoom.room3dLabelsGroup.visible = false;
          }
        }
        eng.renderer.shadowMap.needsUpdate = true;
        eng.renderer.render(eng.scene, eng.camera);
        const url = eng.renderer.domElement.toDataURL('image/jpeg', 0.94);
        eng.selBox.visible = prevSel;
        eng.sunOrbGroup.visible = prevOrb;
        if (eng.builtRoom) {
          eng.builtRoom.compassRingGroup.visible = prevCompass;
          eng.builtRoom.planOverlayGroup.visible = prevOverlay;
          eng.builtRoom.room3dLabelsGroup.visible = prev3dLbl;
        }
        eng.renderer.render(eng.scene, eng.camera);
        return url;
      },
      resetCamera: (mode) => applyCameraPreset(mode || camModeRef.current),
      focusWall: (wall) => focusOnWall(wall),
      enterFromDoor: () => enterFromDoorway(true),
      walkStep: (f, r) => moveFpsBy(f, r),
      turnLook: (deltaYawDeg) => {
        if (camModeRef.current !== 'inside') return;
        fpsRef.current.yaw += (deltaYawDeg * Math.PI) / 180;
        applyFpsCameraRotation();
        engineRef.current?.scheduleRender(false);
      },
      nudgeObjectRelative: (objId, forwardM, rightM) => {
        const eng = engineRef.current;
        if (!eng) return;
        const p = projectRef.current;
        const obj = p.objects.find((o) => o.id === objId);
        if (!obj) return;
        const dir = new THREE.Vector3();
        eng.camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        else dir.normalize();
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const targetX = obj.x + dir.x * forwardM + right.x * rightM;
        const targetZ = obj.z + dir.z * forwardM + right.z * rightM;

        const res = resolveHorizontalMove3D(p, obj, obj.x, obj.y, obj.z, targetX, targetZ, eng.mountedObjects);
        const mounted = eng.mountedObjects.get(obj.id);
        if (mounted) mounted.root.position.set(res.x, res.y, res.z);
        onMoveObject(obj.id, res.x, res.z, res.y);
        if (res.support && Math.abs(res.y - obj.y) > 0.02) {
          onToast?.(`${res.support.host.name} üst yüzeyine oturtuldu (${Math.round(res.y * 100)} cm).`);
        } else if (res.hitObstacle && Math.hypot(res.x - targetX, res.z - targetZ) > 0.03) {
          onToast?.('Mobilya sınırı: ürün diğer eşyanın içine/altına geçirilemez.');
        }
        eng.scheduleRender(true);
      },
      nudgeObjectVertical: (objId, deltaYM) => {
        const eng = engineRef.current;
        if (!eng) return;
        const p = projectRef.current;
        const obj = p.objects.find((o) => o.id === objId);
        if (!obj) return;
        const res = resolveVerticalMove3D(p, obj, obj.y + deltaYM, eng.mountedObjects);
        const mounted = eng.mountedObjects.get(obj.id);
        if (mounted) mounted.root.position.set(obj.x, res.y, obj.z);
        onMoveObject(obj.id, obj.x, obj.z, res.y);
        if (res.clampedBySupport && res.support) {
          onToast?.(`${res.support.host.name} üst sınırı (${Math.round(res.y * 100)} cm) — altına indirilemez.`);
        }
        eng.scheduleRender(true);
      },
      setObjectElevation: (objId, targetYM) => {
        const eng = engineRef.current;
        if (!eng) return;
        const p = projectRef.current;
        const obj = p.objects.find((o) => o.id === objId);
        if (!obj) return;
        const res = resolveVerticalMove3D(p, obj, targetYM, eng.mountedObjects);
        const mounted = eng.mountedObjects.get(obj.id);
        if (mounted) mounted.root.position.set(obj.x, res.y, obj.z);
        onMoveObject(obj.id, obj.x, obj.z, res.y);
        if (res.clampedBySupport && res.support) {
          onToast?.(`${res.support.host.name} üst yüzeyi (${Math.round(res.y * 100)} cm) — altına yerleştirilemez.`);
        }
        eng.scheduleRender(true);
      },
      snapObjectToSurface: (objId) => {
        const eng = engineRef.current;
        if (!eng) return;
        const p = projectRef.current;
        const obj = p.objects.find((o) => o.id === objId);
        if (!obj) return;
        const res = resolveVerticalMove3D(p, obj, 0, eng.mountedObjects);
        const mounted = eng.mountedObjects.get(obj.id);
        if (mounted) mounted.root.position.set(obj.x, res.y, obj.z);
        onMoveObject(obj.id, obj.x, obj.z, res.y);
        if (res.support) {
          onToast?.(`${res.support.host.name} üstüne oturtuldu (${Math.round(res.y * 100)} cm).`);
        } else {
          onToast?.(`Zemine indirildi (${Math.round(res.y * 100)} cm).`);
        }
        eng.scheduleRender(true);
      },
    }));

    // 1) Mount TRUE ON-DEMAND WebGL Engine
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight - 100;

      const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
      // Cap pixelRatio on 4K TVs (>=2200px) to 1.0 to protect Smart TV GPU VRAM; <=1.25 on phones/iPads/laptops
      const targetDpr = window.innerWidth >= 2200 ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.25);
      renderer.setPixelRatio(targetDpr);
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;
      renderer.domElement.style.touchAction = 'none';

      // Graceful WebGL context-loss recovery for Smart TVs & iOS Safari backgrounding
      const onContextLost = (ev: Event) => {
        ev.preventDefault();
        onToast?.('3B grafik bağlamı yenileniyor...');
      };
      const onContextRestored = () => {
        eng.scheduleRender(true);
      };
      renderer.domElement.addEventListener('webglcontextlost', onContextLost, false);
      renderer.domElement.addEventListener('webglcontextrestored', onContextRestored, false);

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe8e5de);

      const camera = new THREE.PerspectiveCamera(42, w / Math.max(1, h), 0.08, 90);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = false;
      controls.rotateSpeed = 0.78;
      controls.zoomSpeed = 0.95;

      const hemiLight = new THREE.HemisphereLight(0xf8fbff, 0xc9c2b6, 0.9);
      scene.add(hemiLight);

      const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.75);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(1024, 1024);
      sunLight.shadow.camera.near = 1.0;
      sunLight.shadow.camera.far = 40;
      const sBound = 9.0;
      sunLight.shadow.camera.left = -sBound;
      sunLight.shadow.camera.right = sBound;
      sunLight.shadow.camera.top = sBound;
      sunLight.shadow.camera.bottom = -sBound;
      sunLight.shadow.bias = -0.00055;
      sunLight.shadow.normalBias = 0.025;
      scene.add(sunLight);
      scene.add(sunLight.target);

      const bounceLight = new THREE.DirectionalLight(0xeef3ff, 0.34);
      bounceLight.position.set(-5, 3.5, 4);
      scene.add(bounceLight);

      const sunOrbGroup = new THREE.Group();
      const orbGeo = new THREE.SphereGeometry(0.26, 16, 16);
      const orbMat = new THREE.MeshBasicMaterial({ color: 0xffc857 });
      const orbMesh = new THREE.Mesh(orbGeo, orbMat);
      orbMesh.raycast = () => {};
      sunOrbGroup.add(orbMesh);

      const haloGeo = new THREE.RingGeometry(0.34, 0.44, 20);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffd578,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.52,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      haloMesh.raycast = () => {};
      sunOrbGroup.add(haloMesh);

      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 2, 0),
      ]);
      const rayMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.5 });
      const sunRayLine = new THREE.Line(rayGeo, rayMat);
      sunRayLine.raycast = () => {};
      sunOrbGroup.add(sunRayLine);
      scene.add(sunOrbGroup);

      const roomRoot = new THREE.Group();
      scene.add(roomRoot);

      const objectsRoot = new THREE.Group();
      scene.add(objectsRoot);

      const unitBoxGeo = new THREE.BoxGeometry(1, 1, 1);
      const selEdgesGeo = new THREE.EdgesGeometry(unitBoxGeo);
      unitBoxGeo.dispose();
      const selMat = new THREE.LineBasicMaterial({ color: 0x0f172a });
      const selBox = new THREE.LineSegments(selEdgesGeo, selMat);
      selBox.visible = false;
      selBox.raycast = () => {};
      scene.add(selBox);

      host.innerHTML = '';
      host.appendChild(renderer.domElement);

      const toCam = new THREE.Vector3();

      const eng = {
        renderer,
        scene,
        camera,
        controls,
        roomRoot,
        objectsRoot,
        sunLight,
        hemiLight,
        bounceLight,
        sunOrbGroup,
        sunRayLine,
        haloMesh,
        selBox,
        selMat,
        builtRoom: null as BuiltRoomResult | null,
        gltfCache: new Map<string, THREE.Group>(),
        mountedObjects: new Map<string, { sig: string; root: THREE.Group; dispose?: () => void }>(),
        loadingKeys: new Set<string>(),
        shadowsDirty: true,
        lastCutawayMask: '',
        rafScheduled: 0,
        renderFrame: () => {},
        scheduleRender: (_dirtyShadows = false) => {},
      };

      eng.renderFrame = () => {
        eng.rafScheduled = 0;
        const mode = camModeRef.current;
        const p = projectRef.current;
        const br = eng.builtRoom;

        if (br) {
          br.gridHelper.visible = showGridRef.current && mode !== 'inside';
          br.planOverlayGroup.visible = mode === 'plan' || (showDoorArcsRef.current && mode !== 'inside');
          br.planLabelsGroup.visible = mode === 'plan';
          br.room3dLabelsGroup.visible = mode === 'free';
          br.compassRingGroup.visible = mode !== 'inside';
          br.compassRingGroup.rotation.y = (p.sun.northAngleDeg * Math.PI) / 180;

          let mask = '';
          for (let wi = 0; wi < br.walls.length; wi++) {
            const wall = br.walls[wi];
            let showSolid = true;
            if (mode === 'free') {
              toCam.subVectors(camera.position, wall.center);
              showSolid = toCam.dot(wall.inwardNormal) > 0.05;
            }
            wall.visualGroup.visible = showSolid;
            wall.shadowGhost.visible = mode === 'free' && !showSolid;
            mask += showSolid ? '1' : '0';
          }

          if (mode === 'inside') {
            br.ceilingVisualGroup.visible = true;
            br.ceilingShadowGhost.visible = false;
            mask += '|C1';
          } else if (mode === 'plan') {
            br.ceilingVisualGroup.visible = false;
            br.ceilingShadowGhost.visible = false;
            mask += '|C0';
          } else {
            br.ceilingVisualGroup.visible = p.showCeiling;
            br.ceilingShadowGhost.visible = !p.showCeiling;
            mask += p.showCeiling ? '|C1' : '|C0';
          }

          if (mask !== eng.lastCutawayMask) {
            eng.lastCutawayMask = mask;
            eng.shadowsDirty = true;
          }
        }

        if (eng.sunOrbGroup.visible) eng.haloMesh.lookAt(camera.position);

        const sel = selectionRef.current;
        if (sel?.type === 'object') {
          const obj = p.objects.find((o) => o.id === sel.id);
          if (obj) {
            const d = dragRef.current;
            const ox = d && d.id === obj.id ? d.liveX : obj.x;
            const oy = d && d.id === obj.id ? d.liveY : obj.y;
            const oz = d && d.id === obj.id ? d.liveZ : obj.z;
            selBox.visible = true;
            selBox.position.set(ox, oy + obj.heightM * 0.5, oz);
            selBox.rotation.y = obj.rot;
            selBox.scale.set(obj.widthM + 0.04, Math.max(0.06, obj.heightM + 0.03), obj.depthM + 0.04);
            selMat.color.setHex(hitObstacleRef.current ? 0xdc2626 : 0x0f172a);
          } else {
            selBox.visible = false;
          }
        } else {
          selBox.visible = false;
        }

        if (eng.shadowsDirty) {
          renderer.shadowMap.needsUpdate = true;
          eng.shadowsDirty = false;
        }

        renderer.render(scene, camera);
      };

      eng.scheduleRender = (dirtyShadows = false) => {
        if (dirtyShadows) eng.shadowsDirty = true;
        if (!eng.rafScheduled) {
          eng.rafScheduled = requestAnimationFrame(eng.renderFrame);
        }
      };

      engineRef.current = eng;

      const onControlChange = () => eng.scheduleRender(false);
      controls.addEventListener('change', onControlChange);

      applyCameraPreset(camModeRef.current);

      const onResize = () => {
        if (!hostRef.current) return;
        const nw = hostRef.current.clientWidth || window.innerWidth;
        const nh = hostRef.current.clientHeight || window.innerHeight - 100;
        const dpr = window.innerWidth >= 2200 ? 1.0 : Math.min(window.devicePixelRatio || 1, 1.25);
        renderer.setPixelRatio(dpr);
        camera.aspect = nw / Math.max(1, nh);
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
        eng.scheduleRender(false);
      };
      const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
      ro?.observe(host);
      window.addEventListener('resize', onResize);

      return () => {
        ro?.disconnect();
        window.removeEventListener('resize', onResize);
        renderer.domElement.removeEventListener('webglcontextlost', onContextLost, false);
        renderer.domElement.removeEventListener('webglcontextrestored', onContextRestored, false);
        controls.removeEventListener('change', onControlChange);
        if (eng.rafScheduled) cancelAnimationFrame(eng.rafScheduled);
        if (fpsRef.current.walkRaf) cancelAnimationFrame(fpsRef.current.walkRaf);
        if (fpsRef.current.entryAnimRaf) cancelAnimationFrame(fpsRef.current.entryAnimRaf);
        if (eng.builtRoom) eng.builtRoom.dispose();
        eng.mountedObjects.forEach((m) => m.dispose?.());
        orbGeo.dispose();
        orbMat.dispose();
        haloGeo.dispose();
        haloMat.dispose();
        rayGeo.dispose();
        rayMat.dispose();
        selEdgesGeo.dispose();
        selMat.dispose();
        controls.dispose();
        renderer.dispose();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keyboard WASD / Arrow Keys walking when in 'inside' Walkthrough mode (0% CPU when no key is held!)
    useEffect(() => {
      if (cameraMode !== 'inside') {
        fpsRef.current.keys.clear();
        if (fpsRef.current.walkRaf) {
          cancelAnimationFrame(fpsRef.current.walkRaf);
          fpsRef.current.walkRaf = 0;
        }
        return;
      }

      const tickWalk = (ts: number) => {
        if (camModeRef.current !== 'inside' || fpsRef.current.keys.size === 0) {
          fpsRef.current.walkRaf = 0;
          return;
        }
        const dt = Math.min(0.05, Math.max(0.008, (ts - (fpsRef.current.lastTs || ts)) / 1000));
        fpsRef.current.lastTs = ts;
        const speed = 1.9 * dt;
        const keys = fpsRef.current.keys;
        let fwd = 0;
        let right = 0;
        if (keys.has('w') || keys.has('arrowup')) fwd += speed;
        if (keys.has('s') || keys.has('arrowdown')) fwd -= speed;
        if (keys.has('d') || keys.has('arrowright')) right += speed;
        if (keys.has('a') || keys.has('arrowleft')) right -= speed;
        if (fwd !== 0 || right !== 0) {
          moveFpsBy(fwd, right);
        }
        fpsRef.current.walkRaf = requestAnimationFrame(tickWalk);
      };

      const isTypingTarget = (el: EventTarget | null) => {
        const tag = (el as HTMLElement | null)?.tagName?.toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select';
      };

      const onKeyDown = (e: KeyboardEvent) => {
        if (isTypingTarget(e.target)) return;
        const k = e.key.toLowerCase();
        if (k === 'escape') {
          onExitWalkthrough?.();
          return;
        }
        if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) {
          e.preventDefault();
          fpsRef.current.keys.add(k);
          if (!fpsRef.current.walkRaf) {
            fpsRef.current.lastTs = performance.now();
            fpsRef.current.walkRaf = requestAnimationFrame(tickWalk);
          }
        }
      };

      const onKeyUp = (e: KeyboardEvent) => {
        fpsRef.current.keys.delete(e.key.toLowerCase());
      };

      window.addEventListener('keydown', onKeyDown);
      window.addEventListener('keyup', onKeyUp);
      return () => {
        window.removeEventListener('keydown', onKeyDown);
        window.removeEventListener('keyup', onKeyUp);
        fpsRef.current.keys.clear();
        if (fpsRef.current.walkRaf) {
          cancelAnimationFrame(fpsRef.current.walkRaf);
          fpsRef.current.walkRaf = 0;
        }
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode, onExitWalkthrough]);

    // 2) Rebuild architectural room geometry when structural props change
    const archKey = JSON.stringify({
      w: project.widthM,
      d: project.depthM,
      c: project.ceilingM,
      t: project.wallThicknessM,
      bb: project.showBaseboard,
      bbc: project.baseboardColorHex,
      bbh: project.baseboardHeightCm,
      ct: project.showCornerTrim,
      ctc: project.cornerTrimColorHex,
      cc: project.ceilingColorHex,
      sp: project.recessedSpots,
      spw: project.spotWarmthHex,
      fm: project.floorMaterial,
      ft: project.floorTintHex,
      walls: project.walls,
      wallZones: project.wallZones,
      windows: project.windows,
      doors: project.doors,
      columns: project.columns,
      beams: project.beams,
      coves: project.curtainCoves,
      mez: project.mezzanine,
      adjacentRooms: project.adjacentRooms,
    });

    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;

      if (eng.builtRoom) {
        eng.builtRoom.dispose();
        eng.builtRoom = null;
      }
      while (eng.roomRoot.children.length > 0) {
        eng.roomRoot.remove(eng.roomRoot.children[0]);
      }

      const built = buildArchitecturalRoom(project, eng.roomRoot);
      eng.builtRoom = built;
      eng.lastCutawayMask = '';
      eng.scheduleRender(true);
      onWarningsChange?.(built.warnings);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [archKey]);

    // 3) Live solar lighting update
    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;

      const sol = computeSolarLighting(project.sun);
      const hb = getHouseBounds(project);
      eng.scene.background = new THREE.Color(sol.backgroundHex);

      eng.sunLight.position.set(hb.centerX + sol.sunPosition.x, sol.sunPosition.y, hb.centerZ + sol.sunPosition.z);
      eng.sunLight.target.position.set(hb.centerX, project.ceilingM * 0.2, hb.centerZ);
      eng.sunLight.color.copy(sol.sunColor);
      eng.sunLight.intensity = sol.effectiveSunIntensity;

      const span = Math.max(hb.totalW, hb.totalD) * 0.95 + 3.2;
      eng.sunLight.shadow.camera.left = -span;
      eng.sunLight.shadow.camera.right = span;
      eng.sunLight.shadow.camera.top = span;
      eng.sunLight.shadow.camera.bottom = -span;
      eng.sunLight.shadow.camera.far = Math.max(44, span * 4.5);
      eng.sunLight.shadow.camera.updateProjectionMatrix();

      eng.hemiLight.color.copy(sol.skyColor);
      eng.hemiLight.groundColor.copy(sol.groundColor);
      eng.hemiLight.intensity = sol.effectiveHemiIntensity;

      eng.bounceLight.position.set(hb.centerX - sol.sunPosition.x * 0.5, 4.5, hb.centerZ - sol.sunPosition.z * 0.5);
      eng.bounceLight.intensity = sol.isNight ? 0.14 : 0.34;

      const orbDist = Math.max(hb.totalW, hb.totalD) * 0.76 + 2.4;
      const orbPos = sol.sunDirWorld.clone().multiplyScalar(orbDist);
      orbPos.x += hb.centerX;
      orbPos.z += hb.centerZ;
      orbPos.y = Math.max(0.6, orbPos.y);
      eng.sunOrbGroup.visible = showSunOrb && !sol.isNight && cameraMode !== 'inside';
      eng.sunOrbGroup.children[0].position.copy(orbPos);
      eng.sunOrbGroup.children[1].position.copy(orbPos);

      const rayAttr = eng.sunRayLine.geometry.attributes.position as THREE.BufferAttribute;
      rayAttr.setXYZ(0, orbPos.x, orbPos.y, orbPos.z);
      rayAttr.setXYZ(1, hb.centerX, Math.min(1.0, project.ceilingM * 0.35), hb.centerZ);
      rayAttr.needsUpdate = true;

      if (eng.builtRoom?.interiorFillLight) {
        eng.builtRoom.interiorFillLight.intensity = sol.isNight ? 1.55 : sol.elevationDeg < 18 ? 1.05 : 0.65;
      }
      eng.scheduleRender(true);
    }, [project.sun, project.widthM, project.depthM, project.ceilingM, showSunOrb, cameraMode, archKey]);

    useEffect(() => {
      engineRef.current?.scheduleRender(false);
    }, [selection, showGrid, showDoorArcs, project.showCeiling]);

    useEffect(() => {
      applyCameraPreset(cameraMode);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

    // Showroom TV 360° slow turntable mode (only runs when enabled; 0% GPU when off!)
    useEffect(() => {
      if (!autoRotate || cameraMode !== 'free') return;
      let raf = 0;
      let last = performance.now();
      const spin = (now: number) => {
        const eng = engineRef.current;
        if (!eng || camModeRef.current !== 'free') return;
        const dt = Math.min(0.06, Math.max(0.01, (now - last) / 1000));
        last = now;
        const tgt = eng.controls.target;
        const offset = eng.camera.position.clone().sub(tgt);
        const angle = dt * 0.22; // gentle cinematic showroom speed
        const cosA = Math.cos(angle);
        const sinA = Math.sin(angle);
        const nx = offset.x * cosA - offset.z * sinA;
        const nz = offset.x * sinA + offset.z * cosA;
        offset.x = nx;
        offset.z = nz;
        eng.camera.position.copy(tgt).add(offset);
        eng.camera.lookAt(tgt);
        eng.controls.update();
        eng.scheduleRender(false);
        raf = requestAnimationFrame(spin);
      };
      raf = requestAnimationFrame(spin);
      return () => cancelAnimationFrame(raf);
    }, [autoRotate, cameraMode]);

    // 6) Synchronize 3D objects
    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;
      const loader = new GLTFLoader();

      const activeIds = new Set(project.objects.map((o) => o.id));
      for (const [id, entry] of eng.mountedObjects.entries()) {
        if (!activeIds.has(id)) {
          eng.objectsRoot.remove(entry.root);
          entry.dispose?.();
          eng.mountedObjects.delete(id);
          eng.scheduleRender(true);
        }
      }

      const mountGlb = (obj: ArchPlacedObject, template: THREE.Group, sig: string) => {
        const cur = engineRef.current;
        if (!cur) return;
        const prev = cur.mountedObjects.get(obj.id);
        if (prev) {
          cur.objectsRoot.remove(prev.root);
          prev.dispose?.();
        }

        const root = new THREE.Group();
        root.userData.objectId = obj.id;
        const clone = template.clone(true);

        const rawBox = new THREE.Box3().setFromObject(clone);
        const rawSize = new THREE.Vector3();
        rawBox.getSize(rawSize);
        if (rawSize.x > 0.005 && rawSize.y > 0.005 && rawSize.z > 0.005) {
          const sx = obj.widthM / rawSize.x;
          const sy = obj.heightM / rawSize.y;
          const sz = obj.depthM / rawSize.z;
          if (obj.mountMode === 'rug') {
            // Rugs must always span full W × D and stay thin (never shrink to tiny stamp because heightM=0.01)
            const targetH = Math.max(0.008, Math.min(0.03, obj.heightM));
            clone.scale.set(sx, targetH / rawSize.y, sz);
          } else if (obj.mountMode === 'wall' && obj.depthM <= 0.14) {
            // Thin wall mirrors / frames / wall TVs: fit W × H cleanly without letting tiny 5cm depth shrink everything
            const faceScale = Math.min(sx, sy);
            const depthScale = Math.min(faceScale, Math.max(0.02, obj.depthM) / rawSize.z);
            clone.scale.set(faceScale, faceScale, depthScale);
          } else {
            const ratioSpread = Math.max(sx, sy, sz) / Math.max(0.01, Math.min(sx, sy, sz));
            if (ratioSpread < 1.45) {
              clone.scale.set(sx, sy, sz);
            } else {
              // Uniform scale by dominant dimensions so 3D furniture stays true to room scale
              const sorted = [sx, sy, sz].sort((a, b) => a - b);
              clone.scale.setScalar(sorted[1]);
            }
          }
          clone.updateMatrixWorld(true);
          const scaledBox = new THREE.Box3().setFromObject(clone);
          const center = new THREE.Vector3();
          scaledBox.getCenter(center);
          clone.position.x -= center.x;
          clone.position.y -= scaledBox.min.y;
          clone.position.z -= center.z;
        }

        const maxAniso = Math.min(2, cur.renderer.capabilities.getMaxAnisotropy());
        const isFabric = obj.category === 'Kanepe' || obj.category === 'Berjer' || obj.category === 'Yatak';
        const tintColor = obj.tintHex ? new THREE.Color(obj.tintHex) : null;
        clone.traverse((node) => {
          const m = node as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = obj.mountMode !== 'rug';
            m.receiveShadow = true;
            m.userData.objectId = obj.id;
            // Clone materials when tinting so cached template materials are never mutated
            if (tintColor) {
              m.material = Array.isArray(m.material)
                ? m.material.map((mt) => (mt ? mt.clone() : mt))
                : m.material
                ? m.material.clone()
                : m.material;
            }
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mt) => {
              if (!mt) return;
              preparePhotorealMaterial(mt, maxAniso, isFabric);
              if (tintColor && 'color' in mt && (mt as THREE.MeshStandardMaterial).color) {
                const std = mt as THREE.MeshStandardMaterial;
                // Blend cleanly toward user's target color so even dark/blue GLB furniture turns bright yellow!
                std.color.copy(tintColor);
                if (std.map) {
                  std.color.lerp(new THREE.Color(0xffffff), 0.12);
                }
                std.needsUpdate = true;
              }
            });
          }
        });
        root.add(clone);

        if (obj.mountMode === 'floor') {
          try {
            const sh = buildContactShadow(clone);
            sh.raycast = () => {};
            root.add(sh);
          } catch {
            /* ignore */
          }
        }

        const live = projectRef.current.objects.find((x) => x.id === obj.id) || obj;
        root.position.set(live.x, live.y, live.z);
        root.rotation.y = live.rot;
        cur.objectsRoot.add(root);
        cur.mountedObjects.set(obj.id, { sig, root });
        cur.scheduleRender(true);
      };

      for (const obj of project.objects) {
        const sig = obj.parametricKind
          ? `param:${obj.parametricKind}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}:${obj.parametricColorHex}:${obj.parametricAccentHex}:${obj.countertopSurface || ''}:${obj.thumbUrl ? obj.thumbUrl.slice(-24) : ''}:${obj.name}`
          : `glb:${obj.glbUrl}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}:${obj.tintHex || ''}`;

        const existing = eng.mountedObjects.get(obj.id);
        if (existing && existing.sig === sig) {
          existing.root.position.set(obj.x, obj.y, obj.z);
          existing.root.rotation.y = obj.rot;
          eng.scheduleRender(true);
          continue;
        }

        if (obj.parametricKind) {
          if (existing) {
            eng.objectsRoot.remove(existing.root);
            existing.dispose?.();
          }
          const built = buildParametricObject3D(obj, () => engineRef.current?.scheduleRender(false));
          built.group.userData.objectId = obj.id;
          built.group.traverse((n) => {
            n.userData.objectId = obj.id;
          });
          built.group.position.set(obj.x, obj.y, obj.z);
          built.group.rotation.y = obj.rot;
          eng.objectsRoot.add(built.group);
          eng.mountedObjects.set(obj.id, { sig, root: built.group, dispose: built.dispose });
          eng.scheduleRender(true);
          continue;
        }

        if (!obj.glbUrl) continue;
        const cached = eng.gltfCache.get(obj.glbUrl);
        if (cached) {
          mountGlb(obj, cached, sig);
          continue;
        }

        const loadKey = `${obj.id}::${obj.glbUrl}`;
        if (eng.loadingKeys.has(loadKey)) continue;
        eng.loadingKeys.add(loadKey);
        onLoadingChange?.(eng.loadingKeys.size);

        loader.load(
          obj.glbUrl,
          (gltf) => {
            const cur = engineRef.current;
            if (!cur) return;
            cur.loadingKeys.delete(loadKey);
            onLoadingChange?.(cur.loadingKeys.size);

            const wrap = new THREE.Group();
            wrap.add(gltf.scene);
            wrap.updateMatrixWorld(true);
            const box = new THREE.Box3().setFromObject(wrap);
            const center = new THREE.Vector3();
            box.getCenter(center);
            gltf.scene.position.x -= center.x;
            gltf.scene.position.y -= box.min.y;
            gltf.scene.position.z -= center.z;
            wrap.updateMatrixWorld(true);

            cur.gltfCache.set(obj.glbUrl!, wrap);
            mountGlb(obj, wrap, sig);
          },
          undefined,
          () => {
            const cur = engineRef.current;
            if (cur) {
              cur.loadingKeys.delete(loadKey);
              onLoadingChange?.(cur.loadingKeys.size);
            }
            onToast?.(`${obj.name} 3B modeli yüklenemedi`);
          }
        );
      }
    }, [project.objects, onLoadingChange, onToast]);

    const getRay = (clientX: number, clientY: number): THREE.Raycaster | null => {
      const eng = engineRef.current;
      if (!eng) return null;
      const rect = eng.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, eng.camera);
      return ray;
    };

    const raycastPlaneY = (clientX: number, clientY: number, planeY = 0): THREE.Vector3 | null => {
      const eng = engineRef.current;
      const ray = getRay(clientX, clientY);
      if (!eng || !ray) return null;
      const hit = new THREE.Vector3();
      const ok = ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), hit);
      if (!ok) return null;
      // Guard against horizon blow-ups when standing at 1.65m eye height in Kapıdan Gez mode
      if (camModeRef.current === 'inside') {
        const toHit = hit.clone().sub(eng.camera.position);
        if (toHit.dot(ray.ray.direction) <= 0.05) return null;
        const p = projectRef.current;
        const maxReach = Math.max(12, Math.max(p.widthM, p.depthM) * 3.0);
        if (toHit.length() > maxReach) return null;
      }
      return hit;
    };

    const pickDraggableObjectId = (clientX: number, clientY: number, skipUnselectedRugs = false): string | null => {
      const eng = engineRef.current;
      const ray = getRay(clientX, clientY);
      if (!eng || !ray) return null;

      const hits = ray.intersectObjects(eng.objectsRoot.children, true);
      const selectedId = selectionRef.current?.type === 'object' ? selectionRef.current.id : null;
      let floorOrWallHit: string | null = null;
      let ceilingHit: string | null = null;
      let rugHit: string | null = null;

      for (const h of hits) {
        if (!h.object.visible) continue;
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (typeof cur.userData?.objectId === 'string') {
            const obj = projectRef.current.objects.find((o) => o.id === cur!.userData.objectId);
            if (!obj) break;
            // Always prioritize the currently selected object if under the pointer (easy grab even in tight clusters!)
            if (selectedId && obj.id === selectedId) return obj.id;
            if ((obj.mountMode === 'floor' || obj.mountMode === 'wall') && !floorOrWallHit) {
              floorOrWallHit = obj.id;
            } else if (obj.mountMode === 'ceiling' && !ceilingHit) {
              ceilingHit = obj.id;
            } else if (obj.mountMode === 'rug' && !rugHit && !skipUnselectedRugs) {
              rugHit = obj.id;
            }
            break;
          }
          cur = cur.parent;
        }
      }
      return floorOrWallHit || ceilingHit || rugHit;
    };

    const pickArchitecturalElement = (clientX: number, clientY: number): ArchSelection => {
      const eng = engineRef.current;
      const ray = getRay(clientX, clientY);
      if (!eng || !ray) return null;

      const isVisibleUpTree = (o: THREE.Object3D): boolean => {
        let cur: THREE.Object3D | null = o;
        while (cur) {
          if (!cur.visible) return false;
          cur = cur.parent;
        }
        return true;
      };

      const hits = ray.intersectObjects(eng.roomRoot.children, true);
      for (const h of hits) {
        if (!isVisibleUpTree(h.object)) continue;
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (cur.userData?.pickTarget) return cur.userData.pickTarget as ArchSelection;
          cur = cur.parent;
        }
      }
      return null;
    };

    const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
      const eng = engineRef.current;
      if (!eng) return;
      activePointersRef.current.add(e.pointerId);

      // Multi-touch guard for iPad & iPhone: 2+ fingers ALWAYS hand straight to OrbitControls pinch-zoom/pan!
      if (activePointersRef.current.size >= 2) {
        if (dragRef.current) {
          dragRef.current = null;
          hitObstacleRef.current = false;
        }
        fpsRef.current.looking = false;
        if (camModeRef.current !== 'inside') {
          eng.controls.enabled = true;
        }
        pointerDownPosRef.current = null;
        return;
      }

      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

      const isInside = camModeRef.current === 'inside';
      if (isInside && fpsRef.current.entryAnimRaf) {
        cancelAnimationFrame(fpsRef.current.entryAnimRaf);
        fpsRef.current.entryAnimRaf = 0;
      }

      // In BOTH 3B/2D AND Kapıdan Gez (1st-person) modes: clicking/dragging a furniture piece grabs & moves it!
      // In Kapıdan Gez, skip unselected flat floor rugs so dragging on open floor still smoothly turns your head 360°!
      const hitObjId = pickDraggableObjectId(e.clientX, e.clientY, isInside);
      if (hitObjId) {
        const obj = projectRef.current.objects.find((o) => o.id === hitObjId);
        if (obj) {
          const pt = isInside ? null : raycastPlaneY(e.clientX, e.clientY, obj.y);
          // In Kapıdan Gez (1.65m eye height), always use horizon-safe camera-relative screen delta (push UP = ileri, pull DOWN = geri, LEFT/RIGHT = yan)!
          const useScreenDelta = isInside || !pt;
          const verticalDrag = dragAxisRef.current === 'y' || e.shiftKey;
          e.stopPropagation();
          const wasSelected = selectionRef.current?.type === 'object' && selectionRef.current.id === hitObjId;
          selectionRef.current = { type: 'object', id: hitObjId };
          dragRef.current = {
            id: hitObjId,
            hx: pt ? pt.x : obj.x,
            hz: pt ? pt.z : obj.z,
            px: obj.x,
            py: obj.y,
            pz: obj.z,
            liveX: obj.x,
            liveY: obj.y,
            liveZ: obj.z,
            startClientX: e.clientX,
            startClientY: e.clientY,
            lastClientX: e.clientX,
            lastClientY: e.clientY,
            useScreenDelta,
            verticalDrag,
            moved: false,
            wasSelected,
          };
          if (!isInside) eng.controls.enabled = false;
          hitObstacleRef.current = false;
          try {
            (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
          } catch {
            /* ignore */
          }
          eng.scheduleRender(false);
          return;
        }
      }

      // In First-Person Walkthrough mode on empty space/walls/floor: drag smoothly rotates head (360° look around!)
      if (isInside) {
        fpsRef.current.looking = true;
        fpsRef.current.lastX = e.clientX;
        fpsRef.current.lastY = e.clientY;
        try {
          (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        return;
      }
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      if (camModeRef.current === 'inside' && fpsRef.current.looking) {
        const dx = e.clientX - fpsRef.current.lastX;
        const dy = e.clientY - fpsRef.current.lastY;
        fpsRef.current.lastX = e.clientX;
        fpsRef.current.lastY = e.clientY;
        fpsRef.current.yaw += dx * 0.0042;
        fpsRef.current.pitch = Math.max(-1.12, Math.min(1.12, fpsRef.current.pitch + dy * 0.0036));
        applyFpsCameraRotation();
        engineRef.current?.scheduleRender(false);
        return;
      }

      const d = dragRef.current;
      const eng = engineRef.current;
      if (!d || !eng) return;

      // Tiny 4px deadzone prevents accidental nudging on simple taps while feeling instant when dragging
      if (!d.moved && Math.hypot(e.clientX - d.startClientX, e.clientY - d.startClientY) < 4) {
        return;
      }

      const p = projectRef.current;
      const obj = p.objects.find((o) => o.id === d.id);
      if (!obj) return;

      const isVertical = d.verticalDrag || e.shiftKey;
      if (isVertical) {
        // Direct 3D Up/Down elevation drag (drag UP = raise, drag DOWN = lower, clamped cleanly on bed/table/floor!)
        const dyPx = e.clientY - d.lastClientY;
        d.lastClientX = e.clientX;
        d.lastClientY = e.clientY;
        const distToObj = Math.max(1.2, Math.hypot(d.liveX - eng.camera.position.x, d.liveZ - eng.camera.position.z));
        const vScale = Math.min(0.012, Math.max(0.004, distToObj * 0.0022));
        const targetY = d.liveY - dyPx * vScale;
        const vRes = resolveVerticalMove3D(
          p,
          { ...obj, x: d.liveX, y: d.liveY, z: d.liveZ },
          targetY,
          eng.mountedObjects
        );
        d.liveY = vRes.y;
        d.moved = true;
        hitObstacleRef.current = vRes.clampedBySupport;
        const mounted = eng.mountedObjects.get(d.id);
        if (mounted) mounted.root.position.set(d.liveX, d.liveY, d.liveZ);
        eng.scheduleRender(false);
        return;
      }

      let targetX = d.liveX;
      let targetZ = d.liveZ;

      const pt = !d.useScreenDelta ? raycastPlaneY(e.clientX, e.clientY, d.py) : null;
      if (pt) {
        targetX = d.px + (pt.x - d.hx);
        targetZ = d.pz + (pt.z - d.hz);
      } else {
        // Smooth camera-relative screen drag fallback (push UP = forward/ileri, pull DOWN = back/geri, LEFT/RIGHT = sideways!)
        const dxPx = e.clientX - d.lastClientX;
        const dyPx = e.clientY - d.lastClientY;
        const dir = new THREE.Vector3();
        eng.camera.getWorldDirection(dir);
        dir.y = 0;
        if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
        else dir.normalize();
        const right = new THREE.Vector3(-dir.z, 0, dir.x);
        const distToObj = Math.max(1.2, Math.hypot(d.liveX - eng.camera.position.x, d.liveZ - eng.camera.position.z));
        const scale = Math.min(0.015, Math.max(0.004, distToObj * 0.0028));
        const forwardDelta = -dyPx * scale;
        const rightDelta = dxPx * scale;
        targetX = d.liveX + dir.x * forwardDelta + right.x * rightDelta;
        targetZ = d.liveZ + dir.z * forwardDelta + right.z * rightDelta;
      }
      d.lastClientX = e.clientX;
      d.lastClientY = e.clientY;

      // Full 3D surface-aware placement: pillows/lamps/decor automatically climb ON TOP of beds/tables/nightstands,
      // solid furniture slides cleanly along bed/table boundaries (NEVER clips underneath!), and floor drop is automatic!
      const hRes = resolveHorizontalMove3D(
        p,
        obj,
        d.liveX,
        d.liveY,
        d.liveZ,
        targetX,
        targetZ,
        eng.mountedObjects
      );
      d.liveX = hRes.x;
      d.liveY = hRes.y;
      d.liveZ = hRes.z;
      d.moved = true;
      hitObstacleRef.current = hRes.hitObstacle;

      const mounted = eng.mountedObjects.get(d.id);
      if (mounted) mounted.root.position.set(hRes.x, hRes.y, hRes.z);
      // 60 FPS butter-smooth drag: skip heavy shadow-map rebuild until pointerUp!
      eng.scheduleRender(false);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      activePointersRef.current.delete(e.pointerId);
      if (camModeRef.current === 'inside' && fpsRef.current.looking) {
        fpsRef.current.looking = false;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        const down = pointerDownPosRef.current;
        pointerDownPosRef.current = null;
        // Clicking (not dragging) on a wall/floor/window/door/rug in Kapıdan Gez opens its Right Inspector too!
        if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
          const rugHit = pickDraggableObjectId(e.clientX, e.clientY, false);
          if (rugHit) {
            onSelect({ type: 'object', id: rugHit });
          } else {
            const picked = pickArchitecturalElement(e.clientX, e.clientY);
            onSelect(picked);
          }
        }
        return;
      }

      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        hitObstacleRef.current = false;
        if (engineRef.current) {
          if (camModeRef.current !== 'inside') {
            engineRef.current.controls.enabled = true;
          }
          // Refresh shadows cleanly once on drop!
          engineRef.current.scheduleRender(true);
        }
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (d.moved) {
          onMoveObject(d.id, Number(d.liveX.toFixed(3)), Number(d.liveZ.toFixed(3)), Number(d.liveY.toFixed(3)));
        }
        // Commit React selection cleanly AFTER drag completes (prevents mid-drag canvas resize jumps on phone & desktop!)
        onSelect({ type: 'object', id: d.id });
        pointerDownPosRef.current = null;
        return;
      }

      const down = pointerDownPosRef.current;
      pointerDownPosRef.current = null;
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) {
        const picked = pickArchitecturalElement(e.clientX, e.clientY);
        onSelect(picked);
      }
    };

    const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
      if (camModeRef.current === 'inside') {
        // Scroll mouse wheel forward/back to walk smoothly through the room!
        const step = e.deltaY < 0 ? 0.35 : -0.35;
        moveFpsBy(step, 0);
      }
    };

    return (
      <div
        ref={hostRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      />
    );
  }
);
ArchViewport3D.displayName = 'ArchViewport3D';
