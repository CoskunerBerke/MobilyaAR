import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { USDZExporter } from 'three/examples/jsm/exporters/USDZExporter.js';

export interface ArDeviceEnv {
  isIPad: boolean;
  isIPhone: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  isAndroidTablet: boolean;
  isTablet: boolean;
  isMobile: boolean;
  isInAppBrowser: boolean;
  inAppBrowserName: string | null;
  supportsQuickLook: boolean;
}

/**
 * Reliable device & AR capability detection — explicitly catches iPadOS Safari
 * (which spoofs a Macintosh desktop user-agent!) and WhatsApp/Instagram/TikTok webviews.
 */
export function detectArEnvironment(): ArDeviceEnv {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') {
    return {
      isIPad: false,
      isIPhone: false,
      isIOS: false,
      isAndroid: false,
      isAndroidTablet: false,
      isTablet: false,
      isMobile: false,
      isInAppBrowser: false,
      inAppBrowserName: null,
      supportsQuickLook: false,
    };
  }

  const ua = navigator.userAgent || '';
  const touchPoints = navigator.maxTouchPoints || 0;
  const isIPad = /iPad/i.test(ua) || (/Macintosh/i.test(ua) && touchPoints > 1);
  const isIPhone = /iPhone|iPod/i.test(ua);
  const isIOS = isIPad || isIPhone;
  const isAndroid = /Android/i.test(ua);
  const isAndroidTablet = isAndroid && !/Mobile/i.test(ua);
  const isTablet = isIPad || isAndroidTablet;
  const isMobile = isIOS || isAndroid;

  let inAppBrowserName: string | null = null;
  if (/WhatsApp/i.test(ua)) inAppBrowserName = 'WhatsApp';
  else if (/Instagram/i.test(ua)) inAppBrowserName = 'Instagram';
  else if (/FBAN|FBAV|FB_IAB/i.test(ua)) inAppBrowserName = 'Facebook';
  else if (/BytedanceWebview|musical_ly|TikTok/i.test(ua)) inAppBrowserName = 'TikTok';
  else if (/LinkedInApp/i.test(ua)) inAppBrowserName = 'LinkedIn';
  else if (/Snapchat/i.test(ua)) inAppBrowserName = 'Snapchat';
  else if (/Line\//i.test(ua)) inAppBrowserName = 'LINE';
  else if (isIOS && !/Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/i.test(ua)) {
    inAppBrowserName = 'Uygulama İçi Tarayıcı';
  }
  const isInAppBrowser = inAppBrowserName !== null;

  let relArSupported = false;
  try {
    const a = document.createElement('a');
    relArSupported = Boolean(a.relList && a.relList.supports && a.relList.supports('ar'));
  } catch {
    relArSupported = false;
  }

  const supportsQuickLook = relArSupported || (isIOS && !isInAppBrowser);

  return {
    isIPad,
    isIPhone,
    isIOS,
    isAndroid,
    isAndroidTablet,
    isTablet,
    isMobile,
    isInAppBrowser,
    inAppBrowserName,
    supportsQuickLook,
  };
}

/**
 * Formats an Apple AR Quick Look URL with official hash parameters:
 * `#allowsContentScaling=0` enforces true 1:1 physical furniture dimensions on iPhone & iPad LiDAR!
 */
export function buildQuickLookUrl(usdzUrl: string, allowScaling = false): string {
  const clean = usdzUrl.split('#')[0];
  return `${clean}#allowsContentScaling=${allowScaling ? '1' : '0'}`;
}

/**
 * Launches Apple's native ARKit Quick Look directly on iPhone & iPad Safari (including LiDAR iPad Pro!),
 * bypassing <model-viewer>'s iPadOS desktop-UA detection bug.
 * Note: Apple Quick Look REQUIRES an <img> child inside <a rel="ar"> to trigger native AR instead of downloading!
 */
export function launchIosQuickLook(usdzUrl: string, opts: { allowScaling?: boolean; posterUrl?: string } = {}): void {
  if (typeof document === 'undefined') return;
  const href = buildQuickLookUrl(usdzUrl, Boolean(opts.allowScaling));
  const anchor = document.createElement('a');
  anchor.setAttribute('rel', 'ar');
  anchor.setAttribute('href', href);
  anchor.style.position = 'fixed';
  anchor.style.left = '-9999px';
  anchor.style.opacity = '0';

  const img = document.createElement('img');
  // 1x1 transparent pixel satisfies Apple Safari's strict <a rel="ar"><img/></a> Quick Look trigger!
  img.src =
    opts.posterUrl ||
    'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  img.alt = '';
  img.width = 1;
  img.height = 1;
  anchor.appendChild(img);

  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    anchor.remove();
  }, 1500);
}

/**
 * Launches Google's native ARCore Scene Viewer on Android with real floor plane detection,
 * depth shadows, and optional strict 1:1 scale lock (`resizable=false`).
 */
export function launchAndroidSceneViewer(
  glbUrl: string,
  title: string,
  opts: { allowScaling?: boolean } = {}
): void {
  if (typeof window === 'undefined') return;
  const absoluteUrl = glbUrl.startsWith('http')
    ? glbUrl
    : `${window.location.origin}${glbUrl.startsWith('/') ? '' : '/'}${glbUrl}`;
  const params = new URLSearchParams({
    file: absoluteUrl,
    mode: 'ar_preferred',
    title,
  });
  if (!opts.allowScaling) {
    params.set('resizable', 'false');
  }
  const fallback = encodeURIComponent(window.location.href);
  const intentUrl =
    `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}` +
    `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;` +
    `action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
  window.location.href = intentUrl;
}

/**
 * On-the-fly Apple ARKit USDZ exporter for custom AI / Pinterest / CAD .GLB files
 * (or scaled/recolored catalog items) that don't have a static .usdz file on disk.
 * Strictly grounds minY = 0, centers X/Z = 0, preserves true 1:1 meters, and embeds
 * horizontal floor plane anchoring for iPad Pro / iPhone LiDAR!
 */
export async function exportGlbUrlToUsdzBlobUrl(
  glbUrl: string,
  opts: { scaleFactor?: number; tintHex?: string; maxTextureSize?: number } = {}
): Promise<string> {
  const loader = new GLTFLoader();
  const gltf = await loader.loadAsync(glbUrl);

  const root = new THREE.Group();
  const model = gltf.scene;
  root.add(model);

  const scaleFactor = opts.scaleFactor && Number.isFinite(opts.scaleFactor) ? opts.scaleFactor : 1;
  if (Math.abs(scaleFactor - 1) > 0.002) {
    model.scale.multiplyScalar(scaleFactor);
  }

  const tintColor = opts.tintHex ? new THREE.Color(opts.tintHex) : null;
  model.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.attributes.normal) {
      mesh.geometry.computeVertexNormals();
    }
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const fixed = mats.map((m) => {
      let std: THREE.MeshStandardMaterial;
      if (m && (m as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
        std = m.clone() as THREE.MeshStandardMaterial;
      } else {
        const legacy = m as THREE.MeshPhongMaterial | undefined;
        std = new THREE.MeshStandardMaterial({
          color: legacy?.color ? legacy.color.clone() : new THREE.Color(0xd8d2c7),
          map: legacy?.map || null,
          roughness: 0.65,
          metalness: 0.05,
        });
      }
      if (tintColor && std.name?.startsWith('CAD_Fabric')) {
        std.color.copy(tintColor);
      }
      return std;
    });
    mesh.material = Array.isArray(mesh.material) ? fixed : fixed[0];
  });

  // Strict floor grounding: feet flush at Y = 0, footprint centered at (0, 0)
  root.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(root);
  const center = new THREE.Vector3();
  box.getCenter(center);
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  root.updateMatrixWorld(true);

  const exporter = new USDZExporter();
  const usdzArray = await exporter.parseAsync(root, {
    ar: {
      anchoring: { type: 'plane' },
      planeAnchoring: { alignment: 'horizontal' },
    },
    includeAnchoringProperties: true,
    onlyVisible: true,
    quickLookCompatible: true,
    maxTextureSize: opts.maxTextureSize || 1024,
  });

  const blob = new Blob([usdzArray], { type: 'model/vnd.usdz+zip' });
  return URL.createObjectURL(blob);
}
