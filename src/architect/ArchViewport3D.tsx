import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clampToRoomWalls, resolveMoveOBB, type OBB2D } from '../lib/collision2d';
import { buildContactShadow } from '../lib/contactShadow';
import { preparePhotorealMaterial } from '../lib/roomRendering';
import { buildParametricObject3D } from './parametricFurniture';
import { buildArchitecturalRoom, type BuiltRoomResult } from './roomGeometryBuilder';
import { computeSolarLighting } from './solarMath';
import type { ArchPlacedObject, ArchRoomProject, ArchSelection, WallId } from './types';

export type ArchCameraMode = 'free' | 'plan' | 'inside';

export interface ArchViewportHandle {
  captureSnapshot: (hideSelection?: boolean) => string | null;
  resetCamera: (mode?: ArchCameraMode) => void;
  focusWall: (wall: WallId) => void;
}

interface Props {
  project: ArchRoomProject;
  cameraMode: ArchCameraMode;
  showGrid: boolean;
  showSunOrb: boolean;
  showDoorArcs: boolean;
  selection: ArchSelection;
  onSelect: (sel: ArchSelection) => void;
  onMoveObject: (id: string, x: number, z: number) => void;
  onWarningsChange?: (warnings: string[]) => void;
  onLoadingChange?: (loadingCount: number) => void;
  onToast?: (msg: string) => void;
}

function objectToOBB(o: ArchPlacedObject): OBB2D {
  return {
    id: o.id,
    x: o.x,
    z: o.z,
    rot: o.rot,
    halfW: Math.max(0.1, o.widthM * 0.5),
    halfD: Math.max(0.04, o.depthM * 0.5),
  };
}

export const ArchViewport3D = forwardRef<ArchViewportHandle, Props>(
  (
    {
      project,
      cameraMode,
      showGrid,
      showSunOrb,
      showDoorArcs,
      selection,
      onSelect,
      onMoveObject,
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
    const selectionRef = useRef(selection);
    selectionRef.current = selection;
    const showGridRef = useRef(showGrid);
    showGridRef.current = showGrid;
    const showDoorArcsRef = useRef(showDoorArcs);
    showDoorArcsRef.current = showDoorArcs;

    const dragRef = useRef<{
      id: string;
      hx: number;
      hz: number;
      px: number;
      pz: number;
      liveX: number;
      liveZ: number;
      moved: boolean;
    } | null>(null);
    const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
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
      lastCutawayMask: number;
      rafScheduled: number;
      renderFrame: () => void;
      scheduleRender: (dirtyShadows?: boolean) => void;
    } | null>(null);

    const applyCameraPreset = (mode: ArchCameraMode) => {
      const eng = engineRef.current;
      if (!eng) return;
      const p = projectRef.current;
      const maxSpan = Math.max(p.widthM, p.depthM);
      if (mode === 'plan') {
        eng.camera.fov = 16;
        eng.camera.far = 220;
        eng.camera.updateProjectionMatrix();
        const aspect = Math.max(0.55, eng.camera.aspect || 1);
        const fitDiv = Math.min(1, aspect * 0.92);
        eng.camera.position.set(0, (maxSpan * 5.25) / fitDiv, 0.01);
        eng.controls.target.set(0, 0, 0);
        eng.controls.maxPolarAngle = Math.PI * 0.49;
        eng.controls.minDistance = 4.0;
        eng.controls.maxDistance = 80;
      } else if (mode === 'inside') {
        eng.camera.fov = 56;
        eng.camera.far = 90;
        eng.camera.updateProjectionMatrix();
        eng.camera.position.set(p.widthM * 0.3, Math.min(1.58, p.ceilingM * 0.56), p.depthM * 0.38);
        eng.controls.target.set(-p.widthM * 0.12, Math.min(1.15, p.ceilingM * 0.44), -p.depthM * 0.28);
        eng.controls.maxPolarAngle = Math.PI * 0.85;
        eng.controls.minDistance = 0.25;
        eng.controls.maxDistance = Math.max(p.widthM, p.depthM) * 1.1;
      } else {
        eng.camera.fov = 42;
        eng.camera.far = 90;
        eng.camera.updateProjectionMatrix();
        eng.camera.position.set(p.widthM * 0.95, Math.max(4.0, maxSpan * 0.86), p.depthM * 1.05);
        eng.controls.target.set(0, p.ceilingM * 0.34, 0);
        eng.controls.maxPolarAngle = Math.PI * 0.495;
        eng.controls.minDistance = 1.2;
        eng.controls.maxDistance = 24;
      }
      eng.controls.update();
      eng.scheduleRender(true);
    };

    const focusOnWall = (wall: WallId) => {
      const eng = engineRef.current;
      if (!eng) return;
      const p = projectRef.current;
      const maxSpan = Math.max(p.widthM, p.depthM);
      const camH = p.ceilingM + Math.max(1.85, maxSpan * 0.42);
      const targetY = p.ceilingM * 0.44;
      eng.camera.fov = 42;
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
        if (hideSelection) {
          eng.selBox.visible = false;
          eng.sunOrbGroup.visible = false;
          if (eng.builtRoom && camModeRef.current !== 'plan') {
            eng.builtRoom.compassRingGroup.visible = false;
            eng.builtRoom.planOverlayGroup.visible = false;
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
        }
        eng.renderer.render(eng.scene, eng.camera);
        return url;
      },
      resetCamera: (mode) => applyCameraPreset(mode || camModeRef.current),
      focusWall: (wall) => focusOnWall(wall),
    }));

    // 1) Mount TRUE ON-DEMAND WebGL Engine (0% GPU usage when idle / typing / clicking UI!)
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight - 100;

      // NO preserveDrawingBuffer: true -> eliminates costly Windows D3D11 per-frame backbuffer copy!
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.25));
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFShadowMap;
      renderer.shadowMap.autoUpdate = false;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe8e5de);

      const camera = new THREE.PerspectiveCamera(42, w / Math.max(1, h), 0.08, 90);
      const controls = new OrbitControls(camera, renderer.domElement);
      // Clean direct orbit without infinite idle damping spin
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
        lastCutawayMask: -1,
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
          br.gridHelper.visible = showGridRef.current;
          br.planOverlayGroup.visible = mode === 'plan' || showDoorArcsRef.current;
          br.planLabelsGroup.visible = mode === 'plan';
          br.compassRingGroup.visible = mode !== 'inside';
          br.compassRingGroup.rotation.y = (p.sun.northAngleDeg * Math.PI) / 180;

          let mask = 0;
          for (let wi = 0; wi < br.walls.length; wi++) {
            const wall = br.walls[wi];
            let showSolid = true;
            if (mode === 'free') {
              toCam.subVectors(camera.position, wall.center);
              showSolid = toCam.dot(wall.inwardNormal) > 0.05;
            }
            wall.visualGroup.visible = showSolid;
            wall.shadowGhost.visible = mode === 'free' && !showSolid;
            if (showSolid) mask |= 1 << wi;
          }

          if (mode === 'inside') {
            br.ceilingVisualGroup.visible = true;
            br.ceilingShadowGhost.visible = false;
            mask |= 1 << 5;
          } else if (mode === 'plan') {
            br.ceilingVisualGroup.visible = false;
            br.ceilingShadowGhost.visible = false;
          } else {
            br.ceilingVisualGroup.visible = p.showCeiling;
            br.ceilingShadowGhost.visible = !p.showCeiling;
            if (p.showCeiling) mask |= 1 << 5;
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
            const oz = d && d.id === obj.id ? d.liveZ : obj.z;
            selBox.visible = true;
            selBox.position.set(ox, obj.y + obj.heightM * 0.5, oz);
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
        camera.aspect = nw / Math.max(1, nh);
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
        eng.scheduleRender(false);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);

      return () => {
        ro.disconnect();
        controls.removeEventListener('change', onControlChange);
        if (eng.rafScheduled) cancelAnimationFrame(eng.rafScheduled);
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

    // 2) Rebuild architectural room geometry when structural props change
    const archKey = JSON.stringify({
      w: project.widthM,
      d: project.depthM,
      c: project.ceilingM,
      t: project.wallThicknessM,
      bb: project.showBaseboard,
      bbc: project.baseboardColorHex,
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
      eng.lastCutawayMask = -1;
      eng.scheduleRender(true);
      onWarningsChange?.(built.warnings);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [archKey]);

    // 3) Live solar lighting update
    useEffect(() => {
      const eng = engineRef.current;
      if (!eng) return;

      const sol = computeSolarLighting(project.sun);
      eng.scene.background = new THREE.Color(sol.backgroundHex);

      eng.sunLight.position.copy(sol.sunPosition);
      eng.sunLight.target.position.set(0, project.ceilingM * 0.2, 0);
      eng.sunLight.color.copy(sol.sunColor);
      eng.sunLight.intensity = sol.effectiveSunIntensity;

      const span = Math.max(project.widthM, project.depthM) * 1.35 + 2.5;
      eng.sunLight.shadow.camera.left = -span;
      eng.sunLight.shadow.camera.right = span;
      eng.sunLight.shadow.camera.top = span;
      eng.sunLight.shadow.camera.bottom = -span;
      eng.sunLight.shadow.camera.updateProjectionMatrix();

      eng.hemiLight.color.copy(sol.skyColor);
      eng.hemiLight.groundColor.copy(sol.groundColor);
      eng.hemiLight.intensity = sol.effectiveHemiIntensity;

      eng.bounceLight.position.set(-sol.sunPosition.x * 0.5, 4.5, -sol.sunPosition.z * 0.5);
      eng.bounceLight.intensity = sol.isNight ? 0.14 : 0.34;

      const orbDist = Math.max(project.widthM, project.depthM) * 0.85 + 2.2;
      const orbPos = sol.sunDirWorld.clone().multiplyScalar(orbDist);
      orbPos.y = Math.max(0.6, orbPos.y);
      eng.sunOrbGroup.visible = showSunOrb && !sol.isNight && cameraMode !== 'inside';
      eng.sunOrbGroup.children[0].position.copy(orbPos);
      eng.sunOrbGroup.children[1].position.copy(orbPos);

      const rayAttr = eng.sunRayLine.geometry.attributes.position as THREE.BufferAttribute;
      rayAttr.setXYZ(0, orbPos.x, orbPos.y, orbPos.z);
      rayAttr.setXYZ(1, 0, Math.min(1.0, project.ceilingM * 0.35), 0);
      rayAttr.needsUpdate = true;

      if (eng.builtRoom?.interiorFillLight) {
        eng.builtRoom.interiorFillLight.intensity = sol.isNight ? 1.55 : sol.elevationDeg < 18 ? 1.05 : 0.65;
      }
      eng.scheduleRender(true);
    }, [project.sun, project.widthM, project.depthM, project.ceilingM, showSunOrb, cameraMode, archKey]);

    // 4) Re-render on view toggles / selection / ceiling toggle
    useEffect(() => {
      engineRef.current?.scheduleRender(false);
    }, [selection, showGrid, showDoorArcs, project.showCeiling]);

    // 5) Camera mode changes
    useEffect(() => {
      applyCameraPreset(cameraMode);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

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
        if (rawSize.x > 0.01 && rawSize.y > 0.01 && rawSize.z > 0.01) {
          const sx = obj.widthM / rawSize.x;
          const sy = obj.heightM / rawSize.y;
          const sz = obj.depthM / rawSize.z;
          const ratioSpread = Math.max(sx, sy, sz) / Math.max(0.01, Math.min(sx, sy, sz));
          if (ratioSpread < 1.35) clone.scale.set(sx, sy, sz);
          else clone.scale.setScalar(Math.min(sx, sy, sz));
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
        clone.traverse((node) => {
          const m = node as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = obj.mountMode !== 'rug';
            m.receiveShadow = true;
            m.userData.objectId = obj.id;
            const mats = Array.isArray(m.material) ? m.material : [m.material];
            mats.forEach((mt) => {
              if (mt) preparePhotorealMaterial(mt, maxAniso, isFabric);
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
          ? `param:${obj.parametricKind}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}:${obj.parametricColorHex}:${obj.parametricAccentHex}`
          : `glb:${obj.glbUrl}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}`;

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
          const built = buildParametricObject3D(obj);
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
      const ray = getRay(clientX, clientY);
      if (!ray) return null;
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY), hit) ? hit : null;
    };

    const pickDraggableObjectId = (clientX: number, clientY: number): string | null => {
      const eng = engineRef.current;
      const ray = getRay(clientX, clientY);
      if (!eng || !ray) return null;

      const hits = ray.intersectObjects(eng.objectsRoot.children, true);
      let ceilingHit: string | null = null;
      let rugHit: string | null = null;

      for (const h of hits) {
        if (!h.object.visible) continue;
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (typeof cur.userData?.objectId === 'string') {
            const obj = projectRef.current.objects.find((o) => o.id === cur!.userData.objectId);
            if (!obj) break;
            if (obj.mountMode === 'floor' || obj.mountMode === 'wall') return obj.id;
            if (obj.mountMode === 'ceiling' && !ceilingHit) ceilingHit = obj.id;
            if (obj.mountMode === 'rug' && !rugHit) rugHit = obj.id;
            break;
          }
          cur = cur.parent;
        }
      }
      return ceilingHit || rugHit;
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
      pointerDownPosRef.current = { x: e.clientX, y: e.clientY };

      const hitObjId = pickDraggableObjectId(e.clientX, e.clientY);
      if (!hitObjId) return;

      onSelect({ type: 'object', id: hitObjId });
      const obj = projectRef.current.objects.find((o) => o.id === hitObjId);
      if (!obj) return;
      const pt = raycastPlaneY(e.clientX, e.clientY, obj.y);
      if (pt) {
        dragRef.current = {
          id: hitObjId,
          hx: pt.x,
          hz: pt.z,
          px: obj.x,
          pz: obj.z,
          liveX: obj.x,
          liveZ: obj.z,
          moved: false,
        };
        eng.controls.enabled = false;
        hitObstacleRef.current = false;
        (e.currentTarget as HTMLDivElement).setPointerCapture(e.pointerId);
      }
    };

    const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      const eng = engineRef.current;
      if (!d || !eng) return;
      const p = projectRef.current;
      const obj = p.objects.find((o) => o.id === d.id);
      if (!obj) return;
      const pt = raycastPlaneY(e.clientX, e.clientY, obj.y);
      if (!pt) return;

      const targetX = d.px + (pt.x - d.hx);
      const targetZ = d.pz + (pt.z - d.hz);
      let nextX = targetX;
      let nextZ = targetZ;

      if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling' || obj.y >= 1.0) {
        const c = clampToRoomWalls(targetX, targetZ, obj.rot, obj.widthM * 0.5, obj.depthM * 0.5, p.widthM, p.depthM, 0.015);
        nextX = c.x;
        nextZ = c.z;
        hitObstacleRef.current = c.clamped;
      } else {
        const others: OBB2D[] = [
          ...p.objects
            .filter((o) => o.id !== obj.id && o.mountMode !== 'rug' && o.mountMode !== 'ceiling' && o.y < 1.0)
            .map(objectToOBB),
          ...p.columns.map((col) => ({
            id: `col-${col.id}`,
            x: col.xCm / 100,
            z: col.zCm / 100,
            rot: 0,
            halfW: col.widthCm / 200,
            halfD: col.depthCm / 200,
          })),
        ];
        const res = resolveMoveOBB(objectToOBB({ ...obj, x: d.liveX, z: d.liveZ }), targetX, targetZ, others, p.widthM, p.depthM);
        nextX = res.x;
        nextZ = res.z;
        hitObstacleRef.current = res.hitObstacle;
      }

      d.liveX = nextX;
      d.liveZ = nextZ;
      d.moved = true;

      const mounted = eng.mountedObjects.get(d.id);
      if (mounted) mounted.root.position.set(nextX, obj.y, nextZ);
      eng.scheduleRender(true);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d) {
        dragRef.current = null;
        hitObstacleRef.current = false;
        if (engineRef.current) engineRef.current.controls.enabled = true;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
        if (d.moved) onMoveObject(d.id, d.liveX, d.liveZ);
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

    return (
      <div
        ref={hostRef}
        className="w-full h-full cursor-grab active:cursor-grabbing touch-none select-none"
        onPointerDownCapture={onPointerDownCapture}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    );
  }
);
ArchViewport3D.displayName = 'ArchViewport3D';
