import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  LIGHTING_PRESETS,
  QUALITY_PRESETS,
  ROAD_CONFIG,
} from './config.ts';
import type {
  AttentionState,
  LightingPreset,
  QualityPreset,
} from './config.ts';
import { getRoadSample } from './road.ts';
import type { RoadHazard } from './road.ts';
import { getInterpolatedVehiclePose } from './vehicle.ts';
import type { VehicleState } from './vehicle.ts';

// Pre-allocated scratch math objects to prevent GC in the render loop
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();

export interface RendererDiagnostics {
  activeBackend: string;
  webgpuSupported: boolean;
  webgpuNote: string;
  frameTimeMs: number;
  fps: number;
  qualityPreset: QualityPreset;
  lightingPreset: LightingPreset;
}

function createRoadAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  // Base dark asphalt
  ctx.fillStyle = '#1b222e';
  ctx.fillRect(0, 0, 512, 512);

  // Fine aggregate grain
  for (let i = 0; i < 6500; i++) {
    const x = (i * 73) % 512;
    const y = (i * 137) % 512;
    const v = 24 + ((i * 29) % 18);
    ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 10})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // Left & Right paved shoulders
  ctx.fillStyle = '#2d3848';
  ctx.fillRect(0, 0, 56, 512);
  ctx.fillRect(456, 0, 56, 512);

  // Rumble strip alternating warning bars
  for (let y = 0; y < 512; y += 32) {
    ctx.fillStyle = y % 64 === 0 ? '#f59e0b' : '#1e293b';
    ctx.fillRect(40, y, 16, 20);
    ctx.fillRect(456, y, 16, 20);
  }

  // Solid outer edge lines (crisp reflective white)
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(60, 0, 8, 512);
  ctx.fillRect(444, 0, 8, 512);

  // Center dashed yellow highway divider + reflective cat's eyes
  for (let y = 0; y < 512; y += 64) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(251, y + 8, 10, 38);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(253, y + 52, 6, 6);
  }

  // Subtle tire wear tracks in left & right lanes
  ctx.fillStyle = 'rgba(15, 23, 42, 0.25)';
  ctx.fillRect(115, 0, 22, 512);
  ctx.fillRect(175, 0, 22, 512);
  ctx.fillRect(315, 0, 22, 512);
  ctx.fillRect(375, 0, 22, 512);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function buildCompositeHazardGroup(
  hazard: RoadHazard,
  colorblindSafe = false,
): {
  group: THREE.Group;
  brakeLights: THREE.Mesh[];
  beaconLight?: THREE.Mesh;
} {
  const group = new THREE.Group();
  const brakeLights: THREE.Mesh[] = [];

  if (hazard.type === 'work_zone') {
    const baseMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.6,
      metalness: 0.1,
    });
    const stripeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.15,
    });
    const darkMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.8,
      metalness: 0.2,
    });

    const barrierMain = new THREE.Mesh(
      new THREE.BoxGeometry(1.95, 0.85, 1.2),
      baseMat,
    );
    barrierMain.position.set(0, 0.425, 0);
    group.add(barrierMain);

    const stripeBar = new THREE.Mesh(
      new THREE.BoxGeometry(1.98, 0.32, 1.22),
      stripeMat,
    );
    stripeBar.position.set(0, 0.55, 0);
    group.add(stripeBar);

    const coneGeo = new THREE.ConeGeometry(0.24, 0.75, 12);
    const cone1 = new THREE.Mesh(coneGeo, baseMat);
    cone1.position.set(-0.68, 0.375, -1.65);
    const cone2 = new THREE.Mesh(coneGeo, baseMat);
    cone2.position.set(0.68, 0.375, -1.65);
    group.add(cone1, cone2);

    const post = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 1.5, 8),
      darkMat,
    );
    post.position.set(0, 0.75, 0);
    group.add(post);

    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    const beacon = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.2, 0.3, 12),
      beaconMat,
    );
    beacon.position.set(0, 1.55, 0);
    group.add(beacon);

    return { group, brakeLights, beaconLight: beacon };
  }

  const isTruck = hazard.type === 'truck';
  const bodyColor =
    hazard.type === 'braking_car'
      ? colorblindSafe
        ? 0xf59e0b
        : 0xf43f5e
      : hazard.colorHex;

  const hullMat = new THREE.MeshStandardMaterial({
    color: bodyColor,
    roughness: 0.28,
    metalness: 0.6,
  });
  const cabinMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.12,
    metalness: 0.85,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.72,
    metalness: 0.25,
  });
  const wheelMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.85,
    metalness: 0.1,
  });
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 0.9,
    roughness: 0.25,
  });

  if (isTruck) {
    const cargo = new THREE.Mesh(
      new THREE.BoxGeometry(2.22, 2.38, 5.2),
      new THREE.MeshStandardMaterial({
        color: 0xe2e8f0,
        roughness: 0.5,
        metalness: 0.32,
      }),
    );
    cargo.position.set(0, 1.55, -0.5);
    group.add(cargo);

    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.12, 1.88, 1.8), hullMat);
    cab.position.set(0, 1.25, 2.9);
    group.add(cab);

    const chassis = new THREE.Mesh(
      new THREE.BoxGeometry(2.26, 0.45, 7.0),
      trimMat,
    );
    chassis.position.set(0, 0.45, 0.3);
    group.add(chassis);
  } else {
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(1.82, 0.68, 4.1),
      hullMat,
    );
    hull.position.set(0, 0.58, 0);
    group.add(hull);

    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.54, 0.56, 2.1),
      cabinMat,
    );
    cabin.position.set(0, 1.15, -0.15);
    group.add(cabin);

    const bumper = new THREE.Mesh(
      new THREE.BoxGeometry(1.86, 0.26, 4.22),
      trimMat,
    );
    bumper.position.set(0, 0.32, 0);
    group.add(bumper);
  }

  const wheelGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 12);
  wheelGeo.rotateZ(Math.PI / 2);
  const wheelOffsets = isTruck
    ? [
        [-1.05, 0.34, -2.2],
        [1.05, 0.34, -2.2],
        [-1.05, 0.34, 2.4],
        [1.05, 0.34, 2.4],
      ]
    : [
        [-0.88, 0.34, -1.3],
        [0.88, 0.34, -1.3],
        [-0.88, 0.34, 1.3],
        [0.88, 0.34, 1.3],
      ];
  for (const [wx, wy, wz] of wheelOffsets) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.position.set(wx, wy, wz);
    group.add(w);
  }

  const tailZ = isTruck ? -3.12 : -2.07;
  const tailY = isTruck ? 0.85 : 0.68;
  const leftBrake = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.16, 0.08),
    brakeMat.clone(),
  );
  leftBrake.position.set(-0.62, tailY, tailZ);
  const rightBrake = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.16, 0.08),
    brakeMat.clone(),
  );
  rightBrake.position.set(0.62, tailY, tailZ);
  group.add(leftBrake, rightBrake);
  brakeLights.push(leftBrake, rightBrake);

  const shadowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(isTruck ? 2.6 : 2.1, isTruck ? 7.6 : 4.6),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.45,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0, 0.02, 0);
  group.add(shadowDisc);

  return { group, brakeLights };
}

export class DrivingSceneRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isHeadless: boolean;

  private qualityPreset: QualityPreset = 'balanced';
  private lightingPreset: LightingPreset = 'dusk';
  private webgpuSupported = false;
  private smoothedFrameTimeMs = 16.6;

  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private fog: THREE.FogExp2;

  private roadGeometry: THREE.BufferGeometry;
  private roadMesh: THREE.Mesh;
  private roadTexture: THREE.CanvasTexture;

  private leftPostsInstanced: THREE.InstancedMesh;
  private rightPostsInstanced: THREE.InstancedMesh;
  private treesTrunksInstanced: THREE.InstancedMesh;
  private treesCanopyInstanced: THREE.InstancedMesh;

  private cockpitRig: THREE.Group;
  private steeringWheelGroup: THREE.Group;
  private dashWarningStripMat: THREE.MeshStandardMaterial;
  private dashLaneBarMesh: THREE.Mesh;
  private headlightsGroup: THREE.Group;

  // Live 2D canvas instrument screen inside 3D dashboard binnacle
  private dashScreenCanvas: HTMLCanvasElement;
  private dashScreenCtx: CanvasRenderingContext2D;
  private dashScreenTexture: THREE.CanvasTexture;
  private lastDashDrawTime = 0;

  private hazardNodes = new Map<
    number,
    {
      group: THREE.Group;
      brakeLights: THREE.Mesh[];
      beaconLight?: THREE.Mesh;
    }
  >();

  private smoothedHeadYawRad = 0;
  private smoothedHeadPitchRad = 0;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialPreset: QualityPreset = 'balanced',
    initialLighting: LightingPreset = 'dusk',
  ) {
    this.container = container;
    this.qualityPreset = initialPreset;
    this.lightingPreset = initialLighting;

    this.isHeadless =
      typeof navigator !== 'undefined' &&
      (navigator.webdriver || /HeadlessChrome/i.test(navigator.userAgent));

    // Probe WebGPU adapter capability for accurate graphics backend diagnostics
    if (typeof navigator !== 'undefined' && 'gpu' in navigator) {
      try {
        const gpu = (
          navigator as unknown as {
            gpu?: { requestAdapter?: () => Promise<unknown> };
          }
        ).gpu;
        gpu
          ?.requestAdapter?.()
          .then((adapter) => {
            this.webgpuSupported = Boolean(adapter);
          })
          .catch(() => {
            this.webgpuSupported = false;
          });
      } catch {
        this.webgpuSupported = false;
      }
    }

    const preset = QUALITY_PRESETS[initialPreset];
    const lightCfg = LIGHTING_PRESETS[initialLighting];

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.isHeadless ? false : preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.12;

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isHeadless
        ? 1
        : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = !this.isHeadless && preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.renderer.domElement.setAttribute('data-testid', 'driving-canvas');
    this.renderer.domElement.className = 'block w-full h-full select-none';
    container.innerHTML = '';
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(lightCfg.skyHex);
    this.fog = new THREE.FogExp2(lightCfg.fogHex, lightCfg.fogDensity);
    this.scene.fog = this.fog;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(
      new RoomEnvironment(),
      0.04,
    ).texture;
    pmrem.dispose();

    this.camera = new THREE.PerspectiveCamera(64, width / height, 0.1, 320);

    this.hemiLight = new THREE.HemisphereLight(
      lightCfg.hemiSkyHex,
      lightCfg.hemiGroundHex,
      lightCfg.hemiIntensity,
    );
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(
      lightCfg.sunHex,
      lightCfg.sunIntensity,
    );
    this.sunLight.position.set(35, 65, -45);
    this.scene.add(this.sunLight);

    // Ground terrain plane
    const groundGeo = new THREE.PlaneGeometry(1600, 1600);
    groundGeo.rotateX(-Math.PI / 2);
    const groundMat = new THREE.MeshStandardMaterial({
      color: 0x0b1320,
      roughness: 0.95,
      metalness: 0.05,
    });
    const groundMesh = new THREE.Mesh(groundGeo, groundMat);
    groundMesh.position.y = -0.25;
    this.scene.add(groundMesh);

    // Horizon mountain silhouette range
    const vistaGroup = new THREE.Group();
    const peakMat = new THREE.MeshStandardMaterial({
      color: 0x162238,
      roughness: 0.9,
      metalness: 0.1,
    });
    for (let i = -6; i <= 6; i++) {
      const h = 28 + Math.abs(Math.sin(i * 1.7)) * 38;
      const peak = new THREE.Mesh(
        new THREE.ConeGeometry(34 + (i % 3) * 10, h, 5),
        peakMat,
      );
      peak.position.set(i * 42, h * 0.45 - 2, -230 - Math.abs(i) * 8);
      vistaGroup.add(peak);
    }
    this.scene.add(vistaGroup);
    this.camera.userData.vistaGroup = vistaGroup;
    this.camera.userData.groundMesh = groundMesh;

    // Dynamic curved road ribbon geometry
    const segs = ROAD_CONFIG.visibleSegments;
    this.roadGeometry = new THREE.BufferGeometry();
    const positions = new Float32Array((segs + 1) * 2 * 3);
    const uvs = new Float32Array((segs + 1) * 2 * 2);
    const indices: number[] = [];

    for (let i = 0; i < segs; i++) {
      const a = i * 2;
      const b = i * 2 + 1;
      const c = (i + 1) * 2;
      const d = (i + 1) * 2 + 1;
      indices.push(a, b, c, b, d, c);
    }
    this.roadGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(positions, 3),
    );
    this.roadGeometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.roadGeometry.setIndex(indices);

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    this.roadTexture = createRoadAsphaltTexture(maxAniso);
    const roadMat = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      color: 0xffffff,
      roughness: 0.68,
      metalness: 0.14,
    });
    this.roadMesh = new THREE.Mesh(this.roadGeometry, roadMat);
    this.roadMesh.frustumCulled = false;
    this.scene.add(this.roadMesh);

    // Instanced roadside reflector posts
    const postGeo = new THREE.BoxGeometry(0.14, 0.85, 0.14);
    const leftPostMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    const rightPostMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    this.leftPostsInstanced = new THREE.InstancedMesh(postGeo, leftPostMat, 45);
    this.rightPostsInstanced = new THREE.InstancedMesh(
      postGeo,
      rightPostMat,
      45,
    );
    this.leftPostsInstanced.frustumCulled = false;
    this.rightPostsInstanced.frustumCulled = false;
    this.scene.add(this.leftPostsInstanced, this.rightPostsInstanced);

    // Instanced roadside pine trees
    const treeCount = 80;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.32, 1.6, 7);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3f2e21,
      roughness: 0.9,
    });
    const canopyGeo = new THREE.ConeGeometry(1.55, 4.2, 7);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x153e35,
      roughness: 0.75,
    });
    this.treesTrunksInstanced = new THREE.InstancedMesh(
      trunkGeo,
      trunkMat,
      treeCount,
    );
    this.treesCanopyInstanced = new THREE.InstancedMesh(
      canopyGeo,
      canopyMat,
      treeCount,
    );
    this.treesTrunksInstanced.frustumCulled = false;
    this.treesCanopyInstanced.frustumCulled = false;
    this.scene.add(this.treesTrunksInstanced, this.treesCanopyInstanced);

    // Live 2D canvas texture for diegetic 3D instrument binnacle
    this.dashScreenCanvas = document.createElement('canvas');
    this.dashScreenCanvas.width = 256;
    this.dashScreenCanvas.height = 96;
    this.dashScreenCtx = this.dashScreenCanvas.getContext('2d')!;
    this.dashScreenTexture = new THREE.CanvasTexture(this.dashScreenCanvas);
    this.dashScreenTexture.colorSpace = THREE.SRGBColorSpace;

    const {
      cockpitRig,
      steeringWheelGroup,
      dashWarningStripMat,
      dashLaneBarMesh,
      headlightsGroup,
    } = this.createDriverCockpitRig();
    this.cockpitRig = cockpitRig;
    this.steeringWheelGroup = steeringWheelGroup;
    this.dashWarningStripMat = dashWarningStripMat;
    this.dashLaneBarMesh = dashLaneBarMesh;
    this.headlightsGroup = headlightsGroup;
    this.headlightsGroup.visible = lightCfg.headlightsActive;
    this.scene.add(this.cockpitRig);

    this.renderer.compile(this.scene, this.camera);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  private createDriverCockpitRig() {
    const cockpitRig = new THREE.Group();

    const dashMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.65,
      metalness: 0.25,
    });
    const cowlMat = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.4,
      metalness: 0.45,
    });
    const hoodMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.24,
      metalness: 0.72,
    });

    // 1. Sculpted front hood
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(1.72, 0.14, 1.35),
      hoodMat,
    );
    hood.position.set(0, -0.44, -1.45);
    hood.rotation.x = 0.06;
    cockpitRig.add(hood);

    // 2. Main dashboard deck
    const dashDeck = new THREE.Mesh(
      new THREE.BoxGeometry(1.85, 0.24, 0.62),
      dashMat,
    );
    dashDeck.position.set(0, -0.46, -0.72);
    cockpitRig.add(dashDeck);

    // 3. Sleek low-profile instrument binnacle hood
    const binnacle = new THREE.Mesh(
      new THREE.BoxGeometry(0.56, 0.12, 0.3),
      cowlMat,
    );
    binnacle.position.set(0, -0.34, -0.68);
    cockpitRig.add(binnacle);

    // 3b. Digital Gauge Screen mounted on front face of binnacle
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.48, 0.095),
      new THREE.MeshBasicMaterial({ map: this.dashScreenTexture }),
    );
    screenPlane.position.set(0, -0.335, -0.528);
    cockpitRig.add(screenPlane);

    // 4. Diegetic dashboard attention-warning LED bar along windshield base
    const dashWarningStripMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 0.6,
      roughness: 0.2,
    });
    const warningStrip = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.016, 0.03),
      dashWarningStripMat,
    );
    warningStrip.position.set(0, -0.33, -0.88);
    cockpitRig.add(warningStrip);

    // 5. Diegetic lane-keeping indicator bar on binnacle top
    const dashLaneBarMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.02, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.9,
      }),
    );
    dashLaneBarMesh.position.set(0, -0.275, -0.53);
    cockpitRig.add(dashLaneBarMesh);

    // 6. Left & Right Windshield A-Pillars
    const pillarGeo = new THREE.BoxGeometry(0.075, 0.95, 0.09);
    const leftPillar = new THREE.Mesh(pillarGeo, dashMat);
    leftPillar.position.set(-0.88, 0.08, -0.72);
    leftPillar.rotation.z = -0.22;
    leftPillar.rotation.x = -0.35;

    const rightPillar = new THREE.Mesh(pillarGeo, dashMat);
    rightPillar.position.set(0.88, 0.08, -0.72);
    rightPillar.rotation.z = 0.22;
    rightPillar.rotation.x = -0.35;
    cockpitRig.add(leftPillar, rightPillar);

    // 6b. Interior Rear-View Mirror & Exterior Side Mirrors
    const mirrorFrameMat = new THREE.MeshStandardMaterial({
      color: 0x090d16,
      roughness: 0.5,
      metalness: 0.4,
    });
    const mirrorGlassMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      roughness: 0.08,
      metalness: 0.92,
    });
    const rearMirrorStem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.012, 0.012, 0.1, 8),
      mirrorFrameMat,
    );
    rearMirrorStem.position.set(0, 0.34, -0.58);
    const rearMirrorHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.068, 0.025),
      mirrorFrameMat,
    );
    rearMirrorHousing.position.set(0, 0.285, -0.58);
    const rearMirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.295, 0.052),
      mirrorGlassMat,
    );
    rearMirrorGlass.position.set(0, 0.285, -0.566);
    cockpitRig.add(rearMirrorStem, rearMirrorHousing, rearMirrorGlass);

    // 7. Ground-projected headlight beams on asphalt ahead (visible in dusk & night presets)
    const headlightsGroup = new THREE.Group();
    const beamMat = new THREE.MeshBasicMaterial({
      color: 0xe0f2fe,
      transparent: true,
      opacity: 0.06,
      depthWrite: false,
    });
    const beamGeo = new THREE.PlaneGeometry(2.6, 22);
    beamGeo.rotateX(-Math.PI / 2);
    const leftBeam = new THREE.Mesh(beamGeo, beamMat);
    leftBeam.position.set(-0.85, -1.12, -13.5);
    const rightBeam = new THREE.Mesh(beamGeo, beamMat);
    rightBeam.position.set(0.85, -1.12, -13.5);
    headlightsGroup.add(leftBeam, rightBeam);
    cockpitRig.add(headlightsGroup);

    // 8. Multi-part 3D Steering Wheel Group
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(0, -0.31, -0.46);
    steeringWheelGroup.rotation.x = 0.32;

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.45,
      metalness: 0.3,
    });
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.28,
      metalness: 0.8,
    });
    const centerMarkMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.4,
      roughness: 0.3,
    });

    const wheelRim = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.024, 12, 32),
      rimMat,
    );
    steeringWheelGroup.add(wheelRim);

    const topMark = new THREE.Mesh(
      new THREE.TorusGeometry(0.185, 0.026, 10, 12, 0.24),
      centerMarkMat,
    );
    topMark.rotation.z = Math.PI * 0.5 - 0.12;
    steeringWheelGroup.add(topMark);

    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.055, 0.06, 0.04, 16),
      rimMat,
    );
    hub.rotation.x = Math.PI / 2;
    steeringWheelGroup.add(hub);

    const horizontalSpoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.34, 0.028, 0.02),
      spokeMat,
    );
    const verticalSpoke = new THREE.Mesh(
      new THREE.BoxGeometry(0.032, 0.17, 0.02),
      spokeMat,
    );
    verticalSpoke.position.set(0, -0.085, 0);
    steeringWheelGroup.add(horizontalSpoke, verticalSpoke);

    cockpitRig.add(steeringWheelGroup);

    return {
      cockpitRig,
      steeringWheelGroup,
      dashWarningStripMat,
      dashLaneBarMesh,
      headlightsGroup,
    };
  }

  private updateCockpitInstrumentTexture(
    vehicle: VehicleState,
    attentionState: AttentionState,
  ): void {
    const ctx = this.dashScreenCtx;
    ctx.fillStyle = '#060a12';
    ctx.fillRect(0, 0, 256, 96);

    // Subtle top border bar
    ctx.fillStyle =
      attentionState === 'DISTRACTED'
        ? '#ef4444'
        : attentionState === 'POSSIBLY_DISTRACTED'
        ? '#f59e0b'
        : '#0ea5e9';
    ctx.fillRect(0, 0, 256, 4);

    // Speed readout inside 3D cluster
    const speedKmh = Math.round(vehicle.speed * 3.6);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 34px monospace';
    ctx.fillText(`${speedKmh}`, 18, 46);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('KM/H', 82, 44);

    // Gear badge
    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 22px monospace';
    ctx.fillText(`D${vehicle.gear}`, 196, 42);

    // RPM progress bar at bottom of binnacle screen
    ctx.fillStyle = '#1e293b';
    ctx.fillRect(18, 64, 220, 12);
    ctx.fillStyle = vehicle.rpmNormalized > 0.85 ? '#ef4444' : '#38bdf8';
    ctx.fillRect(18, 64, Math.round(220 * vehicle.rpmNormalized), 12);

    this.dashScreenTexture.needsUpdate = true;
  }

  public applyQualityPreset(presetName: QualityPreset): void {
    this.qualityPreset = presetName;
    const preset = QUALITY_PRESETS[presetName];
    this.renderer.setPixelRatio(
      this.isHeadless
        ? 1
        : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = !this.isHeadless && preset.shadows;
  }

  public applyLightingPreset(lightingName: LightingPreset): void {
    this.lightingPreset = lightingName;
    const cfg = LIGHTING_PRESETS[lightingName];
    this.scene.background = new THREE.Color(cfg.skyHex);
    this.fog.color.setHex(cfg.fogHex);
    this.fog.density = cfg.fogDensity;
    this.hemiLight.color.setHex(cfg.hemiSkyHex);
    this.hemiLight.groundColor.setHex(cfg.hemiGroundHex);
    this.hemiLight.intensity = cfg.hemiIntensity;
    this.sunLight.color.setHex(cfg.sunHex);
    this.sunLight.intensity = cfg.sunIntensity;
    this.headlightsGroup.visible = cfg.headlightsActive;
  }

  public getDiagnostics(): RendererDiagnostics {
    const fps = Math.min(
      120,
      Math.max(1, Math.round(1000 / Math.max(1, this.smoothedFrameTimeMs))),
    );
    return {
      activeBackend: this.isHeadless
        ? 'WebGL 2 (Software Headless Fallback)'
        : 'WebGL 2 (Hardware Accelerated)',
      webgpuSupported: this.webgpuSupported,
      webgpuNote: this.webgpuSupported
        ? 'WebGPU adapter detected; unified WebGL 2 PBR pipeline active for cross-device shader parity'
        : 'WebGPU adapter unavailable on this browser/GPU — WebGL 2 fallback active',
      frameTimeMs: Number(this.smoothedFrameTimeMs.toFixed(1)),
      fps,
      qualityPreset: this.qualityPreset,
      lightingPreset: this.lightingPreset,
    };
  }

  private handleResize(): void {
    if (!this.container) return;
    const width = Math.max(1, this.container.clientWidth || window.innerWidth);
    const height = Math.max(
      1,
      this.container.clientHeight || window.innerHeight,
    );
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  public syncHazards(
    hazards: RoadHazard[],
    currentS: number,
    timeSec: number,
    drawDistance: number,
  ): void {
    const activeIds = new Set<number>();

    for (const h of hazards) {
      activeIds.add(h.id);
      let node = this.hazardNodes.get(h.id);
      if (!node) {
        node = buildCompositeHazardGroup(h);
        this.hazardNodes.set(h.id, node);
        this.scene.add(node.group);
      }

      const relS = h.s - currentS;
      if (relS < -35 || relS > drawDistance) {
        node.group.visible = false;
        continue;
      }

      node.group.visible = true;
      const sample = getRoadSample(h.s);
      const normalX = Math.cos(sample.headingRad);
      const normalZ = Math.sin(sample.headingRad);

      const worldX = sample.centerX + h.lateralOffset * normalX;
      const worldZ = -h.s + h.lateralOffset * normalZ;

      node.group.position.set(worldX, sample.elevationY, worldZ);
      node.group.rotation.y = -sample.headingRad;

      const flash = Math.sin(timeSec * 18) > 0;
      for (const bMesh of node.brakeLights) {
        const mat = bMesh.material as THREE.MeshStandardMaterial;
        if (h.telegraphActive || h.brakeTriggered) {
          mat.emissiveIntensity = flash ? 3.2 : 1.4;
        } else {
          mat.emissiveIntensity = 0.55;
        }
      }

      if (node.beaconLight) {
        const mat = node.beaconLight.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = flash ? 3.5 : 0.4;
      }
    }

    for (const [id, node] of this.hazardNodes.entries()) {
      if (!activeIds.has(id)) {
        this.scene.remove(node.group);
        this.hazardNodes.delete(id);
      }
    }
  }

  public renderFrame(
    vehicle: VehicleState,
    hazards: RoadHazard[],
    attentionState: AttentionState,
    headYawDeg: number,
    headPitchDeg: number,
    isTitleScreen: boolean,
    timeSec: number,
    dt: number,
    reducedMotion = false,
  ): void {
    this.smoothedFrameTimeMs =
      this.smoothedFrameTimeMs * 0.92 + dt * 1000 * 0.08;

    const pose = getInterpolatedVehiclePose(vehicle);
    const baseS = pose.s;
    const presetCfg = QUALITY_PRESETS[this.qualityPreset];

    const segLen = ROAD_CONFIG.segmentLength;
    const segs = ROAD_CONFIG.visibleSegments;
    const halfWidth =
      ROAD_CONFIG.totalRoadWidth * 0.5 + ROAD_CONFIG.shoulderWidth;

    const posAttr = this.roadGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const uvAttr = this.roadGeometry.getAttribute('uv') as THREE.BufferAttribute;

    const startSegmentIndex = Math.floor(baseS / segLen) - 4;

    for (let i = 0; i <= segs; i++) {
      const segIdx = startSegmentIndex + i;
      const s = segIdx * segLen;
      const sample = getRoadSample(s);

      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);

      const leftX = sample.centerX - halfWidth * nx;
      const leftZ = -s - halfWidth * nz;

      const rightX = sample.centerX + halfWidth * nx;
      const rightZ = -s + halfWidth * nz;

      const vCoord = s * 0.085;

      posAttr.setXYZ(i * 2, leftX, sample.elevationY, leftZ);
      posAttr.setXYZ(i * 2 + 1, rightX, sample.elevationY, rightZ);

      uvAttr.setXY(i * 2, 0, vCoord);
      uvAttr.setXY(i * 2 + 1, 1, vCoord);
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    this.roadGeometry.computeVertexNormals();

    // Update Instanced roadside reflector posts
    const postSpacing = 10;
    const firstPostIdx = Math.floor(baseS / postSpacing) - 2;
    for (let i = 0; i < 45; i++) {
      const s = (firstPostIdx + i) * postSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);

      _pos.set(
        sample.centerX - ROAD_CONFIG.guardrailOffset * nx,
        sample.elevationY + 0.42,
        -s - ROAD_CONFIG.guardrailOffset * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.leftPostsInstanced.setMatrixAt(i, _mat4);

      _pos.set(
        sample.centerX + ROAD_CONFIG.guardrailOffset * nx,
        sample.elevationY + 0.42,
        -s + ROAD_CONFIG.guardrailOffset * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.rightPostsInstanced.setMatrixAt(i, _mat4);
    }
    this.leftPostsInstanced.instanceMatrix.needsUpdate = true;
    this.rightPostsInstanced.instanceMatrix.needsUpdate = true;

    // Update Instanced roadside pine trees (scaled to quality preset)
    const activeTrees = Math.min(80, presetCfg.sceneryCount);
    const treeSpacing = 6.5;
    const firstTreeIdx = Math.floor(baseS / treeSpacing) - 3;
    for (let i = 0; i < 80; i++) {
      if (i >= activeTrees) {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos, _quat, _scale);
        this.treesTrunksInstanced.setMatrixAt(i, _mat4);
        this.treesCanopyInstanced.setMatrixAt(i, _mat4);
        continue;
      }
      const idx = firstTreeIdx + i;
      const s = idx * treeSpacing;
      const sample = getRoadSample(s);
      const side = idx % 2 === 0 ? -1 : 1;
      const distOut = 9.5 + (Math.abs(idx * 17) % 14) * 1.1;
      const scaleMod = 0.85 + (Math.abs(idx * 31) % 35) / 100;

      const x = sample.centerX + side * distOut;
      const z = -s;

      _quat.identity();
      _scale.set(scaleMod, scaleMod, scaleMod);

      _pos.set(x, sample.elevationY + 0.8 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.treesTrunksInstanced.setMatrixAt(i, _mat4);

      _pos.set(x, sample.elevationY + 2.7 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.treesCanopyInstanced.setMatrixAt(i, _mat4);
    }
    this.treesTrunksInstanced.instanceMatrix.needsUpdate = true;
    this.treesCanopyInstanced.instanceMatrix.needsUpdate = true;

    const vistaGroup = this.camera.userData.vistaGroup as THREE.Group;
    const groundMesh = this.camera.userData.groundMesh as THREE.Mesh;
    if (vistaGroup) vistaGroup.position.z = -baseS;
    if (groundMesh) groundMesh.position.z = -baseS;

    this.syncHazards(hazards, baseS, timeSec, presetCfg.drawDistance);

    // Update diegetic 3D instrument binnacle screen at ~12Hz
    if (timeSec - this.lastDashDrawTime > 0.08) {
      this.lastDashDrawTime = timeSec;
      this.updateCockpitInstrumentTexture(vehicle, attentionState);
    }

    const playerRoad = getRoadSample(baseS);
    const nx = Math.cos(playerRoad.headingRad);
    const nz = Math.sin(playerRoad.headingRad);

    const carWorldX = playerRoad.centerX + pose.lateralOffset * nx;
    const carWorldY = playerRoad.elevationY;
    const carWorldZ = -baseS + pose.lateralOffset * nz;

    const carYaw = -playerRoad.headingRad - vehicle.headingOffset;
    const pitchVisual = reducedMotion ? 0 : vehicle.pitchOffset;
    const rollVisual = reducedMotion ? 0 : vehicle.rollOffset;

    this.cockpitRig.position.set(carWorldX, carWorldY + 1.18, carWorldZ);
    this.cockpitRig.rotation.set(pitchVisual, carYaw, rollVisual, 'YXZ');
    this.cockpitRig.visible = !isTitleScreen;

    this.steeringWheelGroup.rotation.z = -pose.steerAngle * 1.65;

    if (attentionState === 'DISTRACTED') {
      this.dashWarningStripMat.color.setHex(0xef4444);
      this.dashWarningStripMat.emissive.setHex(0xef4444);
      this.dashWarningStripMat.emissiveIntensity =
        1.5 + Math.sin(timeSec * 20) * 1.0;
    } else if (attentionState === 'POSSIBLY_DISTRACTED') {
      this.dashWarningStripMat.color.setHex(0xf59e0b);
      this.dashWarningStripMat.emissive.setHex(0xf59e0b);
      this.dashWarningStripMat.emissiveIntensity = 1.2;
    } else {
      this.dashWarningStripMat.color.setHex(0x10b981);
      this.dashWarningStripMat.emissive.setHex(0x10b981);
      this.dashWarningStripMat.emissiveIntensity = 0.5;
    }

    const laneShiftClamped = THREE.MathUtils.clamp(
      (pose.lateralOffset - ROAD_CONFIG.playerDefaultLaneOffset) * 0.08,
      -0.18,
      0.18,
    );
    this.dashLaneBarMesh.position.x = laneShiftClamped;

    if (isTitleScreen) {
      const orbitOffset = Math.sin(timeSec * 0.45) * 2.8;
      this.camera.position.set(
        carWorldX + orbitOffset,
        carWorldY + 3.4,
        carWorldZ + 5.5,
      );
      const lookAheadSample = getRoadSample(baseS + 28);
      _lookTarget.set(
        lookAheadSample.centerX,
        lookAheadSample.elevationY + 1.0,
        -(baseS + 28),
      );
      this.camera.lookAt(_lookTarget);
    } else {
      // Restrained camera motion: subtle impact bump without disorienting shake
      const shakeAmt = reducedMotion
        ? 0
        : vehicle.trauma * vehicle.trauma * 0.025;
      const shakeX = Math.sin(timeSec * 42) * shakeAmt;
      const shakeY = Math.cos(timeSec * 48) * shakeAmt;

      this.camera.position.set(
        carWorldX + shakeX,
        carWorldY + 1.22 + shakeY,
        carWorldZ,
      );

      const targetHeadYawRad = THREE.MathUtils.degToRad(-headYawDeg * 0.72);
      const targetHeadPitchRad = THREE.MathUtils.degToRad(
        -headPitchDeg * 0.55,
      );

      const dampFactor = 1 - Math.exp(-8.5 * Math.max(0.001, dt));
      this.smoothedHeadYawRad +=
        (targetHeadYawRad - this.smoothedHeadYawRad) * dampFactor;
      this.smoothedHeadPitchRad +=
        (targetHeadPitchRad - this.smoothedHeadPitchRad) * dampFactor;

      this.camera.rotation.set(
        pitchVisual + this.smoothedHeadPitchRad - 0.03,
        carYaw + this.smoothedHeadYawRad,
        rollVisual,
        'YXZ',
      );
    }

    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.roadGeometry.dispose();
    this.roadTexture.dispose();
    this.dashScreenTexture.dispose();
    this.renderer.dispose();
  }
}
