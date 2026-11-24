import React, { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import {
  clampToRoomWalls,
  resolveMoveOBB,
  type OBB2D,
} from '../lib/collision2d';
import { buildContactShadow } from '../lib/contactShadow';
import { preparePhotorealMaterial } from '../lib/roomRendering';
import { buildParametricObject3D } from './parametricFurniture';
import { buildArchitecturalRoom, type BuiltRoomResult } from './roomGeometryBuilder';
import { computeSolarLighting } from './solarMath';
import type { ArchPlacedObject, ArchRoomProject, WallId } from './types';

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
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
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
    halfW: Math.max(0.12, o.widthM * 0.5),
    halfD: Math.max(0.06, o.depthM * 0.5),
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
      selectedObjectId,
      onSelectObject,
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
    const selectedIdRef = useRef(selectedObjectId);
    selectedIdRef.current = selectedObjectId;
    const showGridRef = useRef(showGrid);
    showGridRef.current = showGrid;
    const showDoorArcsRef = useRef(showDoorArcs);
    showDoorArcsRef.current = showDoorArcs;

    const dragRef = useRef<{ id: string; hx: number; hz: number; px: number; pz: number } | null>(null);
    const hitObstacleRef = useRef(false);

    const engineRef = useRef<{
      renderer: THREE.WebGLRenderer;
      scene: THREE.Scene;
      camera: THREE.PerspectiveCamera;
      controls: OrbitControls;
      rafId: number;
      roomRoot: THREE.Group;
      objectsRoot: THREE.Group;
      sunLight: THREE.DirectionalLight;
      hemiLight: THREE.HemisphereLight;
      bounceLight: THREE.DirectionalLight;
      sunOrbGroup: THREE.Group;
      sunRayLine: THREE.Line;
      selFrame: THREE.LineLoop;
      selMat: THREE.LineBasicMaterial;
      builtRoom: BuiltRoomResult | null;
      gltfCache: Map<string, THREE.Group>;
      mountedObjects: Map<string, { sig: string; root: THREE.Group; dispose?: () => void }>;
      loadingKeys: Set<string>;
    } | null>(null);

    const applyCameraPreset = (mode: ArchCameraMode) => {
      const eng = engineRef.current;
      if (!eng) return;
      const p = projectRef.current;
      const maxSpan = Math.max(p.widthM, p.depthM);
      if (mode === 'plan') {
        // Low-FOV high-altitude top-down camera with vertical margin so all 4 A/B/C/D cm badges stay inside frame
        eng.camera.fov = 16;
        eng.camera.far = 180;
        eng.camera.updateProjectionMatrix();
        eng.camera.position.set(0, maxSpan * 5.25, 0.01);
        eng.controls.target.set(0, 0, 0);
        eng.controls.maxPolarAngle = Math.PI * 0.49;
        eng.controls.minDistance = 4.0;
        eng.controls.maxDistance = 65;
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
    };

    useImperativeHandle(ref, () => ({
      captureSnapshot: (hideSelection = true) => {
        const eng = engineRef.current;
        if (!eng) return null;
        const prevSel = eng.selFrame.visible;
        const prevOrb = eng.sunOrbGroup.visible;
        const prevCompass = eng.builtRoom?.compassRingGroup.visible ?? false;
        const prevOverlay = eng.builtRoom?.planOverlayGroup.visible ?? false;
        if (hideSelection) {
          eng.selFrame.visible = false;
          eng.sunOrbGroup.visible = false;
          if (eng.builtRoom && camModeRef.current !== 'plan') {
            eng.builtRoom.compassRingGroup.visible = false;
            eng.builtRoom.planOverlayGroup.visible = false;
          }
        }
        eng.renderer.render(eng.scene, eng.camera);
        const url = eng.renderer.domElement.toDataURL('image/jpeg', 0.94);
        eng.selFrame.visible = prevSel;
        eng.sunOrbGroup.visible = prevOrb;
        if (eng.builtRoom) {
          eng.builtRoom.compassRingGroup.visible = prevCompass;
          eng.builtRoom.planOverlayGroup.visible = prevOverlay;
        }
        eng.renderer.render(eng.scene, eng.camera);
        return url;
      },
      resetCamera: (mode) => {
        applyCameraPreset(mode || camModeRef.current);
      },
      focusWall: (wall) => {
        focusOnWall(wall);
      },
    }));

    // 1) Mount Three.js WebGL Engine once
    useEffect(() => {
      const host = hostRef.current;
      if (!host) return;
      const w = host.clientWidth || window.innerWidth;
      const h = host.clientHeight || window.innerHeight - 120;

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        powerPreference: 'high-performance',
        preserveDrawingBuffer: true,
      });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(w, h);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.04;
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.PCFSoftShadowMap;

      const scene = new THREE.Scene();
      scene.background = new THREE.Color(0xe8e5de);

      const camera = new THREE.PerspectiveCamera(42, w / Math.max(1, h), 0.08, 90);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;

      const hemiLight = new THREE.HemisphereLight(0xf8fbff, 0xc9c2b6, 0.9);
      scene.add(hemiLight);

      const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.75);
      sunLight.castShadow = true;
      sunLight.shadow.mapSize.set(2048, 2048);
      sunLight.shadow.camera.near = 1.0;
      sunLight.shadow.camera.far = 42;
      const sBound = 9.0;
      sunLight.shadow.camera.left = -sBound;
      sunLight.shadow.camera.right = sBound;
      sunLight.shadow.camera.top = sBound;
      sunLight.shadow.camera.bottom = -sBound;
      sunLight.shadow.bias = -0.00045;
      sunLight.shadow.normalBias = 0.025;
      scene.add(sunLight);
      scene.add(sunLight.target);

      const bounceLight = new THREE.DirectionalLight(0xeef3ff, 0.34);
      bounceLight.position.set(-5, 3.5, 4);
      scene.add(bounceLight);

      // Visible 3D sun beacon + ray indicator
      const sunOrbGroup = new THREE.Group();
      const orbGeo = new THREE.SphereGeometry(0.28, 24, 24);
      const orbMat = new THREE.MeshBasicMaterial({ color: 0xffc857 });
      const orbMesh = new THREE.Mesh(orbGeo, orbMat);
      sunOrbGroup.add(orbMesh);

      const haloGeo = new THREE.RingGeometry(0.36, 0.46, 32);
      const haloMat = new THREE.MeshBasicMaterial({
        color: 0xffd578,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.55,
      });
      const haloMesh = new THREE.Mesh(haloGeo, haloMat);
      sunOrbGroup.add(haloMesh);

      const rayGeo = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, 2, 0),
      ]);
      const rayMat = new THREE.LineBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.55,
      });
      const sunRayLine = new THREE.Line(rayGeo, rayMat);
      sunOrbGroup.add(sunRayLine);
      scene.add(sunOrbGroup);

      const roomRoot = new THREE.Group();
      scene.add(roomRoot);

      const objectsRoot = new THREE.Group();
      scene.add(objectsRoot);

      const framePts = [
        new THREE.Vector3(-0.5, 0.02, -0.5),
        new THREE.Vector3(0.5, 0.02, -0.5),
        new THREE.Vector3(0.5, 0.02, 0.5),
        new THREE.Vector3(-0.5, 0.02, 0.5),
      ];
      const selGeo = new THREE.BufferGeometry().setFromPoints(framePts);
      const selMat = new THREE.LineBasicMaterial({ color: 0x0f172a });
      const selFrame = new THREE.LineLoop(selGeo, selMat);
      selFrame.visible = false;
      scene.add(selFrame);

      host.innerHTML = '';
      host.appendChild(renderer.domElement);

      const eng = {
        renderer,
        scene,
        camera,
        controls,
        rafId: 0,
        roomRoot,
        objectsRoot,
        sunLight,
        hemiLight,
        bounceLight,
        sunOrbGroup,
        sunRayLine,
        selFrame,
        selMat,
        builtRoom: null as BuiltRoomResult | null,
        gltfCache: new Map<string, THREE.Group>(),
        mountedObjects: new Map<string, { sig: string; root: THREE.Group; dispose?: () => void }>(),
        loadingKeys: new Set<string>(),
      };
      engineRef.current = eng;
      applyCameraPreset(camModeRef.current);

      const toCam = new THREE.Vector3();
      const animate = () => {
        eng.rafId = requestAnimationFrame(animate);
        controls.update();

        const mode = camModeRef.current;
        const p = projectRef.current;
        const br = eng.builtRoom;

        if (br) {
          br.gridHelper.visible = showGridRef.current;
          br.planOverlayGroup.visible = mode === 'plan' || showDoorArcsRef.current;
          br.planLabelsGroup.visible = mode === 'plan';
          br.compassRingGroup.visible = mode !== 'inside';
          br.compassRingGroup.rotation.y = (p.sun.northAngleDeg * Math.PI) / 180;

          // Wall cutaway with preserved shadow casting!
          for (const wall of br.walls) {
            if (mode === 'inside' || mode === 'plan') {
              wall.visualGroup.visible = true;
              wall.shadowGhost.visible = false;
            } else {
              toCam.subVectors(camera.position, wall.center);
              const showSolid = toCam.dot(wall.inwardNormal) > 0.05;
              wall.visualGroup.visible = showSolid;
              // Shadow ghost stays active when cutaway so outdoor sunlight still enters strictly via windows!
              wall.shadowGhost.visible = !showSolid;
            }
          }

          // Ceiling visibility & shadow roof blocker
          if (mode === 'inside') {
            br.ceilingVisualGroup.visible = true;
            br.ceilingShadowGhost.visible = false;
          } else if (mode === 'plan') {
            br.ceilingVisualGroup.visible = false;
            br.ceilingShadowGhost.visible = false;
          } else {
            br.ceilingVisualGroup.visible = p.showCeiling;
            br.ceilingShadowGhost.visible = !p.showCeiling;
          }
        }

        // Keep sun halo facing camera
        haloMesh.lookAt(camera.position);

        // Selection frame update
        const sel = p.objects.find((o) => o.id === selectedIdRef.current);
        if (sel) {
          selFrame.visible = true;
          selFrame.position.set(sel.x, sel.y, sel.z);
          selFrame.rotation.y = sel.rot;
          selFrame.scale.set(sel.widthM + 0.08, 1, sel.depthM + 0.08);
          selMat.color.setHex(hitObstacleRef.current ? 0xdc2626 : 0x0f172a);
        } else {
          selFrame.visible = false;
        }

        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        if (!hostRef.current) return;
        const nw = hostRef.current.clientWidth || window.innerWidth;
        const nh = hostRef.current.clientHeight || window.innerHeight - 120;
        camera.aspect = nw / Math.max(1, nh);
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      };
      const ro = new ResizeObserver(onResize);
      ro.observe(host);

      return () => {
        ro.disconnect();
        cancelAnimationFrame(eng.rafId);
        if (eng.builtRoom) eng.builtRoom.dispose();
        eng.mountedObjects.forEach((m) => m.dispose?.());
        orbGeo.dispose();
        orbMat.dispose();
        haloGeo.dispose();
        haloMat.dispose();
        rayGeo.dispose();
        rayMat.dispose();
        selGeo.dispose();
        selMat.dispose();
        controls.dispose();
        renderer.dispose();
        engineRef.current = null;
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // 2) Rebuild architectural shell when room dimensions, walls, windows, doors, beams, columns, coves change
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
      onWarningsChange?.(built.warnings);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [archKey]);

    // 3) Update live physical solar light, compass orb, and evening interior light boost
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

      // Opposite gentle sky-bounce fill
      eng.bounceLight.position.set(-sol.sunPosition.x * 0.5, 4.5, -sol.sunPosition.z * 0.5);
      eng.bounceLight.intensity = sol.isNight ? 0.12 : 0.34;

      // Update visible sun orb & directional beam arrow outside room
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

      // Boost interior cove LEDs & ceiling spots gracefully at dusk/night
      if (eng.builtRoom) {
        const boost = sol.isNight ? 1.85 : sol.elevationDeg < 18 ? 1.3 : 0.85;
        eng.builtRoom.spotLights.forEach((l) => {
          l.intensity = 0.65 * boost;
        });
      }
    }, [project.sun, project.widthM, project.depthM, project.ceilingM, showSunOrb, cameraMode, archKey]);

    // 4) Apply camera preset change
    useEffect(() => {
      applyCameraPreset(cameraMode);
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cameraMode]);

    // 5) Synchronize placed 3D objects (parametric architectural modules + GLB models)
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

        // Scale cloned GLB accurately to target widthM / depthM / heightM
        const rawBox = new THREE.Box3().setFromObject(clone);
        const rawSize = new THREE.Vector3();
        rawBox.getSize(rawSize);
        if (rawSize.x > 0.01 && rawSize.y > 0.01 && rawSize.z > 0.01) {
          const sx = obj.widthM / rawSize.x;
          const sy = obj.heightM / rawSize.y;
          const sz = obj.depthM / rawSize.z;
          // Preserve aspect ratio cleanly unless dimensions match closely
          const ratioSpread = Math.max(sx, sy, sz) / Math.max(0.01, Math.min(sx, sy, sz));
          if (ratioSpread < 1.35) {
            clone.scale.set(sx, sy, sz);
          } else {
            const uniform = Math.min(sx, sy, sz);
            clone.scale.setScalar(uniform);
          }
          clone.updateMatrixWorld(true);
          const scaledBox = new THREE.Box3().setFromObject(clone);
          const center = new THREE.Vector3();
          scaledBox.getCenter(center);
          clone.position.x -= center.x;
          clone.position.y -= scaledBox.min.y;
          clone.position.z -= center.z;
        }

        const maxAniso = Math.min(8, cur.renderer.capabilities.getMaxAnisotropy());
        const isFabric =
          obj.category === 'Kanepe' || obj.category === 'Berjer' || obj.category === 'Yatak';
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
            sh.userData.objectId = obj.id;
            root.add(sh);
          } catch {
            /* ignore contact shadow fallback */
          }
        }

        const live = projectRef.current.objects.find((x) => x.id === obj.id) || obj;
        root.position.set(live.x, live.y, live.z);
        root.rotation.y = live.rot;
        cur.objectsRoot.add(root);
        cur.mountedObjects.set(obj.id, { sig, root });
      };

      for (const obj of project.objects) {
        const sig = obj.parametricKind
          ? `param:${obj.parametricKind}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}:${obj.parametricColorHex}:${obj.parametricAccentHex}`
          : `glb:${obj.glbUrl}:${obj.widthM.toFixed(2)}:${obj.depthM.toFixed(2)}:${obj.heightM.toFixed(2)}`;

        const existing = eng.mountedObjects.get(obj.id);
        if (existing && existing.sig === sig) {
          existing.root.position.set(obj.x, obj.y, obj.z);
          existing.root.rotation.y = obj.rot;
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

    // Raycast helpers
    const raycastPlaneY = (clientX: number, clientY: number, planeY = 0): THREE.Vector3 | null => {
      const eng = engineRef.current;
      if (!eng) return null;
      const rect = eng.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, eng.camera);
      const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -planeY);
      const hit = new THREE.Vector3();
      return ray.ray.intersectPlane(plane, hit) ? hit : null;
    };

    const findHitObjectId = (clientX: number, clientY: number): string | null => {
      const eng = engineRef.current;
      if (!eng) return null;
      const rect = eng.renderer.domElement.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1,
        -((clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, eng.camera);
      const hits = ray.intersectObjects(eng.objectsRoot.children, true);
      // Prefer non-rug items if cursor hits both furniture and rug underneath
      let rugHit: string | null = null;
      for (const h of hits) {
        let cur: THREE.Object3D | null = h.object;
        while (cur) {
          if (typeof cur.userData?.objectId === 'string') {
            const found = projectRef.current.objects.find((o) => o.id === cur!.userData.objectId);
            if (found && found.mountMode === 'rug') {
              if (!rugHit) rugHit = found.id;
            } else if (found) {
              return found.id;
            }
            break;
          }
          cur = cur.parent;
        }
      }
      return rugHit;
    };

    const onPointerDownCapture = (e: React.PointerEvent<HTMLDivElement>) => {
      const eng = engineRef.current;
      if (!eng) return;
      const hitId = findHitObjectId(e.clientX, e.clientY);
      if (!hitId) {
        onSelectObject(null);
        return;
      }
      onSelectObject(hitId);
      const obj = projectRef.current.objects.find((o) => o.id === hitId);
      if (!obj) return;
      const pt = raycastPlaneY(e.clientX, e.clientY, obj.y);
      if (pt) {
        dragRef.current = { id: hitId, hx: pt.x, hz: pt.z, px: obj.x, pz: obj.z };
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

      if (obj.mountMode === 'rug' || obj.mountMode === 'ceiling') {
        const c = clampToRoomWalls(
          targetX,
          targetZ,
          obj.rot,
          obj.widthM * 0.5,
          obj.depthM * 0.5,
          p.widthM,
          p.depthM,
          0.02
        );
        nextX = c.x;
        nextZ = c.z;
        hitObstacleRef.current = c.clamped;
      } else {
        // Collide against solid floor/wall items AND architectural columns!
        const others: OBB2D[] = [
          ...p.objects
            .filter((o) => o.id !== obj.id && o.mountMode !== 'rug' && o.mountMode !== 'ceiling')
            .filter((o) => Math.abs(o.y - obj.y) < Math.max(o.heightM, obj.heightM) * 0.75)
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
        const res = resolveMoveOBB(
          objectToOBB(obj),
          targetX,
          targetZ,
          others,
          p.widthM,
          p.depthM
        );
        nextX = res.x;
        nextZ = res.z;
        hitObstacleRef.current = res.hitObstacle;
      }

      const mounted = eng.mountedObjects.get(d.id);
      if (mounted) {
        mounted.root.position.set(nextX, obj.y, nextZ);
      }
      onMoveObject(d.id, nextX, nextZ);
    };

    const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragRef.current) {
        dragRef.current = null;
        hitObstacleRef.current = false;
        if (engineRef.current) engineRef.current.controls.enabled = true;
        try {
          (e.currentTarget as HTMLDivElement).releasePointerCapture(e.pointerId);
        } catch {
          /* ignore */
        }
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
