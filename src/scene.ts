import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  LIGHTING_PRESETS,
  MAP_PRESETS,
  QUALITY_PRESETS,
  ROAD_CONFIG,
} from './config.ts';
import type {
  AttentionState,
  CameraViewMode,
  LightingPreset,
  MapPreset,
  QualityPreset,
} from './config.ts';
import { getRoadSample, setActiveRoadMapPreset } from './road.ts';
import type { RoadHazard } from './road.ts';
import { getInterpolatedVehiclePose } from './vehicle.ts';
import type { StepCollisionEvent, VehicleState } from './vehicle.ts';
import { ParticleEngine } from './particles.ts';
import {
  buildCompositeHazardGroup,
  buildPlayerHeroCar,
  createRoadAsphaltTexture,
  createUrbanSkyscraperTexture,
} from './assets3d.ts';
import type { BuiltVehicleNode } from './assets3d.ts';

// Pre-allocated scratch math objects to prevent GC in the render loop
const _mat4 = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _scale = new THREE.Vector3();
const _lookTarget = new THREE.Vector3();
const _targetCamPos = new THREE.Vector3();

export interface RendererDiagnostics {
  activeBackend: string;
  webgpuSupported: boolean;
  webgpuNote: string;
  frameTimeMs: number;
  fps: number;
  qualityPreset: QualityPreset;
  lightingPreset: LightingPreset;
  mapPreset?: MapPreset;
  cameraView?: CameraViewMode;
}

function buildHighwayGantry(title: string, sub: string): {
  group: THREE.Group;
  warningBeacons: THREE.Mesh[];
} {
  const group = new THREE.Group();
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.42,
    metalness: 0.82,
  });

  // Vertical steel support columns safely behind left & right guardrails
  const colGeo = new THREE.CylinderGeometry(0.2, 0.24, 7.0, 10);
  const leftCol = new THREE.Mesh(colGeo, trussMat);
  leftCol.position.set(-6.8, 3.5, 0);
  const rightCol = new THREE.Mesh(colGeo, trussMat);
  rightCol.position.set(6.8, 3.5, 0);
  group.add(leftCol, rightCol);

  // Horizontal overhead dual-chord truss beam spanning across both lanes
  const beamUpper = new THREE.Mesh(
    new THREE.BoxGeometry(14.4, 0.28, 0.55),
    trussMat,
  );
  beamUpper.position.set(0, 6.5, 0);
  const beamLower = new THREE.Mesh(
    new THREE.BoxGeometry(14.4, 0.28, 0.55),
    trussMat,
  );
  beamLower.position.set(0, 5.85, 0);
  group.add(beamUpper, beamLower);

  // Highway green guide sign with crisp canvas typography
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 160;
  const ctx = signCanvas.getContext('2d')!;
  ctx.fillStyle = '#0f5132';
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 148);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 34px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 64);
  ctx.font = 'bold 22px sans-serif';
  ctx.fillStyle = '#fde047';
  ctx.fillText(sub, 256, 114);

  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.32,
    metalness: 0.12,
  });
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.6, 2.05), signMat);
  signMesh.position.set(0, 6.1, 0.32);
  group.add(signMesh);

  const warningBeacons: THREE.Mesh[] = [];
  const beaconMat = new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.5,
  });
  const beacon1 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8),
    beaconMat,
  );
  beacon1.position.set(-3.2, 7.0, 0.32);
  const beacon2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8),
    beaconMat.clone(),
  );
  beacon2.position.set(3.2, 7.0, 0.32);
  group.add(beacon1, beacon2);
  warningBeacons.push(beacon1, beacon2);

  return { group, warningBeacons };
}

function buildOverpassBridge(): THREE.Group {
  const group = new THREE.Group();
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.82,
    metalness: 0.12,
  });
  const steelParapetMat = new THREE.MeshStandardMaterial({
    color: 0x475569,
    roughness: 0.45,
    metalness: 0.75,
  });

  // Elevated box-girder deck spanning across road at 7.4m height
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(28, 1.35, 8.8),
    concreteMat,
  );
  deck.position.set(0, 7.4, 0);
  group.add(deck);

  const railNorth = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.45, 0.25),
    steelParapetMat,
  );
  railNorth.position.set(0, 8.3, 4.25);
  const railSouth = new THREE.Mesh(
    new THREE.BoxGeometry(28, 0.45, 0.25),
    steelParapetMat,
  );
  railSouth.position.set(0, 8.3, -4.25);
  group.add(railNorth, railSouth);

  // Dual concrete piers safely placed beyond road shoulder & guardrail (at ±8.6m)
  const pillarGeo = new THREE.BoxGeometry(1.3, 8.8, 1.5);
  for (const px of [-8.6, 8.6]) {
    for (const pz of [-2.6, 2.6]) {
      const pier = new THREE.Mesh(pillarGeo, concreteMat);
      pier.position.set(px, 3.2, pz);
      group.add(pier);
    }
  }

  return group;
}

export class DrivingSceneRenderer {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;

  private qualityPreset: QualityPreset = 'balanced';
  private lightingPreset: LightingPreset = 'dusk';
  private mapPreset: MapPreset = 'alpine';
  private cameraView: CameraViewMode = 'cockpit';
  private webgpuSupported = false;
  private smoothedFrameTimeMs = 16.6;

  private hemiLight: THREE.HemisphereLight;
  private sunLight: THREE.DirectionalLight;
  private headlightSpot: THREE.SpotLight;
  private headlightTarget: THREE.Object3D;
  private fog: THREE.FogExp2;

  private roadGeometry: THREE.BufferGeometry;
  private roadMesh: THREE.Mesh;
  private roadMaterial: THREE.MeshStandardMaterial;
  private roadTexture: THREE.CanvasTexture;

  // Road-following terrain skirt & embankment mesh (never intersects road elevation!)
  private terrainGeometry: THREE.BufferGeometry;
  private terrainMesh: THREE.Mesh;
  private terrainMaterial: THREE.MeshStandardMaterial;
  private waterMesh: THREE.Mesh;
  private vistaPeakMat: THREE.MeshStandardMaterial;

  private particleEngine: ParticleEngine;
  private leftPostsInstanced: THREE.InstancedMesh;
  private rightPostsInstanced: THREE.InstancedMesh;
  private leftGuardrailsInstanced: THREE.InstancedMesh;
  private rightGuardrailsInstanced: THREE.InstancedMesh;
  private lamppostsInstanced: THREE.InstancedMesh;
  private lampHeadsInstanced: THREE.InstancedMesh;
  private treesTrunksInstanced: THREE.InstancedMesh;
  private treesCanopyInstanced: THREE.InstancedMesh;
  private autumnTreesTrunksInstanced: THREE.InstancedMesh;
  private autumnTreesCanopyInstanced: THREE.InstancedMesh;
  private bouldersInstanced: THREE.InstancedMesh;
  private urbanTowersInstanced: THREE.InstancedMesh;
  private desertMesasInstanced: THREE.InstancedMesh;

  private highwayGantries: Array<{
    group: THREE.Group;
    spacingS: number;
    warningBeacons: THREE.Mesh[];
  }> = [];
  private overpassBridges: Array<{ group: THREE.Group; spacingS: number }> = [];

  private playerHeroCar: BuiltVehicleNode;
  private cockpitRig: THREE.Group;
  private steeringWheelGroup: THREE.Group;
  private dashWarningStripMat: THREE.MeshStandardMaterial;
  private dashLaneBarMesh: THREE.Mesh;

  // Live 2D canvas instrument screen inside 3D dashboard binnacle
  private dashScreenCanvas: HTMLCanvasElement;
  private dashScreenCtx: CanvasRenderingContext2D;
  private dashScreenTexture: THREE.CanvasTexture;
  private lastDashDrawTime = 0;

  private hazardNodes = new Map<number, BuiltVehicleNode>();

  private smoothedHeadYawRad = 0;
  private smoothedHeadPitchRad = 0;
  private smoothedCamOffset = new THREE.Vector3(0, 1.22, 0);
  private smoothedLookAheadDist = 28;
  private cameraInitialized = false;
  private resizeObserver: ResizeObserver;

  constructor(
    container: HTMLElement,
    initialPreset: QualityPreset = 'balanced',
    initialLighting: LightingPreset = 'dusk',
    initialMap: MapPreset = 'alpine',
  ) {
    this.container = container;
    this.qualityPreset = initialPreset;
    this.lightingPreset = initialLighting;
    this.mapPreset = initialMap;
    setActiveRoadMapPreset(initialMap);

    // Detect software WebGL per threejs skill specification
    this.isSoftwareGl = (() => {
      if (typeof document === 'undefined') return true;
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

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
    const mapCfg = MAP_PRESETS[initialMap];

    this.renderer = new THREE.WebGLRenderer({
      antialias: this.isSoftwareGl ? false : preset.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.14;

    const width = Math.max(1, container.clientWidth || window.innerWidth);
    const height = Math.max(1, container.clientHeight || window.innerHeight);
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(
      this.isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && preset.shadows;
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

    this.camera = new THREE.PerspectiveCamera(64, width / height, 0.12, 340);

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
    this.sunLight.position.set(40, 72, -50);
    this.scene.add(this.sunLight);

    // Real 3D Headlight SpotLight (never clips or phases through road surface)
    this.headlightSpot = new THREE.SpotLight(
      0xe0f2fe,
      lightCfg.headlightsActive ? 4.5 : 0,
      95,
      Math.PI / 4.2,
      0.55,
      1.2,
    );
    this.headlightTarget = new THREE.Object3D();
    this.scene.add(this.headlightSpot, this.headlightTarget);
    this.headlightSpot.target = this.headlightTarget;

    // Deep horizon floor safely 24m below road so it NEVER intersects valleys
    const deepFloorGeo = new THREE.PlaneGeometry(2400, 2400);
    deepFloorGeo.rotateX(-Math.PI / 2);
    const deepFloorMat = new THREE.MeshStandardMaterial({
      color: mapCfg.terrainColorHex,
      roughness: 0.95,
      metalness: 0.05,
    });
    const deepFloorMesh = new THREE.Mesh(deepFloorGeo, deepFloorMat);
    deepFloorMesh.position.y = -24.0;
    this.scene.add(deepFloorMesh);
    this.camera.userData.deepFloorMesh = deepFloorMesh;

    // Coastal / Bay Ocean Water Plane on Left Embankment (at y = -6.5m, well below any road dip)
    const waterGeo = new THREE.PlaneGeometry(900, 1800);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0369a1,
      roughness: 0.18,
      metalness: 0.82,
    });
    this.waterMesh = new THREE.Mesh(waterGeo, waterMat);
    this.waterMesh.position.set(-465, -6.5, 0);
    this.waterMesh.visible = mapCfg.waterEnabled;
    this.scene.add(this.waterMesh);

    // Horizon mountain / mesa silhouette range
    const vistaGroup = new THREE.Group();
    this.vistaPeakMat = new THREE.MeshStandardMaterial({
      color: mapCfg.vistaColorHex,
      roughness: 0.88,
      metalness: 0.1,
    });
    for (let i = -7; i <= 7; i++) {
      const h = 34 + Math.abs(Math.sin(i * 1.7)) * 44;
      const peak = new THREE.Mesh(
        new THREE.ConeGeometry(38 + (i % 3) * 12, h, 5),
        this.vistaPeakMat,
      );
      peak.position.set(i * 44, h * 0.42 - 4, -255 - Math.abs(i) * 8);
      vistaGroup.add(peak);
    }
    this.scene.add(vistaGroup);
    this.camera.userData.vistaGroup = vistaGroup;

    // 1. Dynamic Curved Road Ribbon Geometry
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
    this.roadTexture = createRoadAsphaltTexture(maxAniso, initialMap);
    this.roadMaterial = new THREE.MeshStandardMaterial({
      map: this.roadTexture,
      color: 0xffffff,
      roughness: 0.64,
      metalness: 0.16,
    });
    this.roadMesh = new THREE.Mesh(this.roadGeometry, this.roadMaterial);
    this.roadMesh.frustumCulled = false;
    this.scene.add(this.roadMesh);

    // 2. Road-Hugging Terrain Skirt & Embankment Geometry (6 columns per row: left vista -> left berm -> road left -> road right -> right berm -> right vista)
    // Guarantees the ground follows every hill and valley of the road without ever poking through!
    this.terrainGeometry = new THREE.BufferGeometry();
    const tCols = 6;
    const tPositions = new Float32Array((segs + 1) * tCols * 3);
    const tIndices: number[] = [];
    for (let i = 0; i < segs; i++) {
      const rowA = i * tCols;
      const rowB = (i + 1) * tCols;
      // Left terrain strips (cols 0-1, 1-2) and Right terrain strips (cols 3-4, 4-5)
      // Note: we also bridge 2-3 slightly below the road (-0.18m) so there is never any seam gap
      for (let col = 0; col < tCols - 1; col++) {
        const a = rowA + col;
        const b = rowA + col + 1;
        const c = rowB + col;
        const d = rowB + col + 1;
        tIndices.push(a, b, c, b, d, c);
      }
    }
    this.terrainGeometry.setAttribute(
      'position',
      new THREE.BufferAttribute(tPositions, 3),
    );
    this.terrainGeometry.setIndex(tIndices);
    this.terrainMaterial = new THREE.MeshStandardMaterial({
      color: mapCfg.terrainColorHex,
      roughness: 0.92,
      metalness: 0.06,
    });
    this.terrainMesh = new THREE.Mesh(
      this.terrainGeometry,
      this.terrainMaterial,
    );
    this.terrainMesh.frustumCulled = false;
    this.scene.add(this.terrainMesh);

    // 3. Instanced Roadside Reflector Posts & Continuous W-Beam Guardrails
    const postGeo = new THREE.BoxGeometry(0.14, 0.85, 0.14);
    const leftPostMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0x38bdf8,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    const rightPostMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.6,
      roughness: 0.3,
    });
    this.leftPostsInstanced = new THREE.InstancedMesh(postGeo, leftPostMat, 48);
    this.rightPostsInstanced = new THREE.InstancedMesh(
      postGeo,
      rightPostMat,
      48,
    );
    this.leftPostsInstanced.frustumCulled = false;
    this.rightPostsInstanced.frustumCulled = false;
    this.scene.add(this.leftPostsInstanced, this.rightPostsInstanced);

    const guardrailGeo = new THREE.BoxGeometry(0.14, 0.38, 8.15);
    const guardrailMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.32,
      metalness: 0.86,
    });
    this.leftGuardrailsInstanced = new THREE.InstancedMesh(
      guardrailGeo,
      guardrailMat,
      48,
    );
    this.rightGuardrailsInstanced = new THREE.InstancedMesh(
      guardrailGeo,
      guardrailMat,
      48,
    );
    this.leftGuardrailsInstanced.frustumCulled = false;
    this.rightGuardrailsInstanced.frustumCulled = false;
    this.scene.add(
      this.leftGuardrailsInstanced,
      this.rightGuardrailsInstanced,
    );

    // 4. Highway Street Light Poles & Glowing LED Luminaires
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.38,
      metalness: 0.78,
    });
    const lamppostGeo = new THREE.CylinderGeometry(0.09, 0.14, 6.6, 8);
    this.lamppostsInstanced = new THREE.InstancedMesh(
      lamppostGeo,
      poleMat,
      32,
    );
    this.lamppostsInstanced.frustumCulled = false;

    const lampHeadGeo = new THREE.BoxGeometry(0.95, 0.12, 0.32);
    const lampHeadMat = new THREE.MeshStandardMaterial({
      color: 0xfef08a,
      emissive: 0xfef08a,
      emissiveIntensity: 1.8,
      roughness: 0.2,
    });
    this.lampHeadsInstanced = new THREE.InstancedMesh(
      lampHeadGeo,
      lampHeadMat,
      32,
    );
    this.lampHeadsInstanced.frustumCulled = false;
    this.scene.add(this.lamppostsInstanced, this.lampHeadsInstanced);

    // 5. Instanced Roadside Pine & Birch Trees
    const treeCount = 80;
    const trunkGeo = new THREE.CylinderGeometry(0.22, 0.34, 1.8, 7);
    const trunkMat = new THREE.MeshStandardMaterial({
      color: 0x3f2e21,
      roughness: 0.9,
    });
    const canopyGeo = new THREE.ConeGeometry(1.65, 4.5, 7);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x144336,
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

    const autumnTreeCount = 45;
    const birchTrunkGeo = new THREE.CylinderGeometry(0.18, 0.26, 2.2, 7);
    const birchTrunkMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.85,
    });
    const autumnCanopyGeo = new THREE.DodecahedronGeometry(2.0, 1);
    const autumnCanopyMat = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      roughness: 0.7,
    });
    this.autumnTreesTrunksInstanced = new THREE.InstancedMesh(
      birchTrunkGeo,
      birchTrunkMat,
      autumnTreeCount,
    );
    this.autumnTreesCanopyInstanced = new THREE.InstancedMesh(
      autumnCanopyGeo,
      autumnCanopyMat,
      autumnTreeCount,
    );
    this.autumnTreesTrunksInstanced.frustumCulled = false;
    this.autumnTreesCanopyInstanced.frustumCulled = false;
    this.scene.add(
      this.autumnTreesTrunksInstanced,
      this.autumnTreesCanopyInstanced,
    );

    // 6. Roadside Granite Boulders
    const boulderGeo = new THREE.DodecahedronGeometry(1.35, 0);
    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.88,
      metalness: 0.12,
    });
    this.bouldersInstanced = new THREE.InstancedMesh(
      boulderGeo,
      boulderMat,
      36,
    );
    this.bouldersInstanced.frustumCulled = false;
    this.scene.add(this.bouldersInstanced);

    // 7. Urban High-Rise Skyscrapers (visible on 'urban' Metro Bay map)
    const towerGeo = new THREE.BoxGeometry(10, 42, 10);
    const towerMat = new THREE.MeshStandardMaterial({
      map: createUrbanSkyscraperTexture(),
      roughness: 0.35,
      metalness: 0.5,
    });
    this.urbanTowersInstanced = new THREE.InstancedMesh(
      towerGeo,
      towerMat,
      36,
    );
    this.urbanTowersInstanced.frustumCulled = false;
    this.urbanTowersInstanced.visible = mapCfg.urbanBuildings;
    this.scene.add(this.urbanTowersInstanced);

    // 8. Desert Sandstone Mesas & Monoliths (visible on 'desert' Red Rock map)
    const mesaGeo = new THREE.CylinderGeometry(4.5, 8.2, 18, 7);
    const mesaMat = new THREE.MeshStandardMaterial({
      color: 0x9a3412,
      roughness: 0.92,
      metalness: 0.08,
    });
    this.desertMesasInstanced = new THREE.InstancedMesh(mesaGeo, mesaMat, 30);
    this.desertMesasInstanced.frustumCulled = false;
    this.desertMesasInstanced.visible = mapCfg.desertMesas;
    this.scene.add(this.desertMesasInstanced);

    // Particle Engine for collisions, metal sparks, and tire smoke
    this.particleEngine = new ParticleEngine(this.scene);

    // Overhead Highway Sign Gantries
    const gantryConfigs = [
      { title: 'SECTOR 14 · EXPRESS CORRIDOR', sub: 'CRUISE 80 KM/H · RADAR ACTIVE' },
      { title: 'ATTENTION TELEMETRY ZONE', sub: 'MAINTAIN LANE DISCIPLINE' },
      { title: 'AUTOMOTIVE SAFETY PROVING GROUND', sub: 'LIVE KINEMATIC TRACKING' },
    ];
    for (let i = 0; i < 3; i++) {
      const g = buildHighwayGantry(
        gantryConfigs[i].title,
        gantryConfigs[i].sub,
      );
      this.highwayGantries.push({
        group: g.group,
        spacingS: 120 + i * 165,
        warningBeacons: g.warningBeacons,
      });
      this.scene.add(g.group);
    }

    // Concrete Overpass Flyover Bridges
    for (let i = 0; i < 2; i++) {
      const bridge = buildOverpassBridge();
      this.overpassBridges.push({
        group: bridge,
        spacingS: 240 + i * 340,
      });
      this.scene.add(bridge);
    }

    // Build Player Hero GT Sports Coupe (visible in Title Showcase, Chase Cam, and Hood Cam)
    this.playerHeroCar = buildPlayerHeroCar();
    this.scene.add(this.playerHeroCar.group);

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
    } = this.createDriverCockpitRig();
    this.cockpitRig = cockpitRig;
    this.steeringWheelGroup = steeringWheelGroup;
    this.dashWarningStripMat = dashWarningStripMat;
    this.dashLaneBarMesh = dashLaneBarMesh;
    this.scene.add(this.cockpitRig);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);
  }

  private createDriverCockpitRig() {
    const cockpitRig = new THREE.Group();

    const dashMat = new THREE.MeshStandardMaterial({
      color: 0x0b101b,
      roughness: 0.58,
      metalness: 0.28,
    });
    const cowlMat = new THREE.MeshStandardMaterial({
      color: 0x161f30,
      roughness: 0.36,
      metalness: 0.48,
    });
    const hoodMat = new THREE.MeshPhysicalMaterial({
      color: 0x0284c7,
      roughness: 0.18,
      metalness: 0.78,
      clearcoat: 1.0,
      clearcoatRoughness: 0.08,
    });

    // 1. Sculpted aerodynamic front hood
    const hood = new THREE.Mesh(
      new THREE.BoxGeometry(1.74, 0.12, 1.38),
      hoodMat,
    );
    hood.position.set(0, -0.45, -1.42);
    hood.rotation.x = 0.06;
    cockpitRig.add(hood);

    // 2. Main carbon/alcantara dashboard deck
    const dashDeck = new THREE.Mesh(
      new THREE.BoxGeometry(1.86, 0.24, 0.62),
      dashMat,
    );
    dashDeck.position.set(0, -0.46, -0.72);
    cockpitRig.add(dashDeck);

    // 3. Sleek low-profile instrument binnacle hood
    const binnacle = new THREE.Mesh(
      new THREE.BoxGeometry(0.58, 0.125, 0.3),
      cowlMat,
    );
    binnacle.position.set(0, -0.34, -0.68);
    cockpitRig.add(binnacle);

    // 3b. Digital OLED Gauge Screen mounted on front face of binnacle
    const screenPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, 0.098),
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
      new THREE.BoxGeometry(1.42, 0.015, 0.028),
      dashWarningStripMat,
    );
    warningStrip.position.set(0, -0.33, -0.88);
    cockpitRig.add(warningStrip);

    // 5. Diegetic lane-keeping indicator bar on binnacle top
    const dashLaneBarMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.14, 0.018, 0.02),
      new THREE.MeshStandardMaterial({
        color: 0x38bdf8,
        emissive: 0x38bdf8,
        emissiveIntensity: 0.9,
      }),
    );
    dashLaneBarMesh.position.set(0, -0.274, -0.53);
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

    // 7. Interior Rear-View Mirror
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
    rearMirrorStem.position.set(0, 0.35, -0.58);
    const rearMirrorHousing = new THREE.Mesh(
      new THREE.BoxGeometry(0.32, 0.068, 0.025),
      mirrorFrameMat,
    );
    rearMirrorHousing.position.set(0, 0.295, -0.58);
    const rearMirrorGlass = new THREE.Mesh(
      new THREE.PlaneGeometry(0.295, 0.052),
      mirrorGlassMat,
    );
    rearMirrorGlass.position.set(0, 0.295, -0.566);
    cockpitRig.add(rearMirrorStem, rearMirrorHousing, rearMirrorGlass);

    // 8. Multi-part 3D GT Sport Steering Wheel Group
    const steeringWheelGroup = new THREE.Group();
    steeringWheelGroup.position.set(0, -0.31, -0.46);
    steeringWheelGroup.rotation.x = 0.32;

    const rimMat = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.42,
      metalness: 0.32,
    });
    const spokeMat = new THREE.MeshStandardMaterial({
      color: 0x64748b,
      roughness: 0.24,
      metalness: 0.85,
    });
    const centerMarkMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      emissive: 0xf59e0b,
      emissiveIntensity: 0.45,
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
    };
  }

  private updateCockpitInstrumentTexture(
    vehicle: VehicleState,
    attentionState: AttentionState,
  ): void {
    const ctx = this.dashScreenCtx;
    ctx.fillStyle = '#05080f';
    ctx.fillRect(0, 0, 256, 96);

    ctx.fillStyle =
      attentionState === 'DISTRACTED'
        ? '#ef4444'
        : attentionState === 'POSSIBLY_DISTRACTED'
        ? '#f59e0b'
        : '#0ea5e9';
    ctx.fillRect(0, 0, 256, 4);

    const speedKmh = Math.round(vehicle.speed * 3.6);
    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 36px monospace';
    ctx.fillText(`${speedKmh}`, 18, 48);
    ctx.fillStyle = '#94a3b8';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('KM/H', 86, 46);

    ctx.fillStyle = '#f59e0b';
    ctx.font = 'bold 24px monospace';
    ctx.fillText(`G${vehicle.gear}`, 196, 44);

    ctx.fillStyle = '#1e293b';
    ctx.fillRect(18, 66, 220, 12);
    ctx.fillStyle = vehicle.rpmNormalized > 0.85 ? '#ef4444' : '#38bdf8';
    ctx.fillRect(18, 66, Math.round(220 * vehicle.rpmNormalized), 12);

    this.dashScreenTexture.needsUpdate = true;
  }

  public applyQualityPreset(presetName: QualityPreset): void {
    this.qualityPreset = presetName;
    const preset = QUALITY_PRESETS[presetName];
    this.renderer.setPixelRatio(
      this.isSoftwareGl
        ? 1
        : Math.min(window.devicePixelRatio || 1, preset.maxPixelRatio),
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl && preset.shadows;
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
    this.headlightSpot.intensity = cfg.headlightsActive ? 4.5 : 0;
  }

  public applyMapPreset(mapName: MapPreset): void {
    this.mapPreset = mapName;
    setActiveRoadMapPreset(mapName);
    const mapCfg = MAP_PRESETS[mapName];

    this.terrainMaterial.color.setHex(mapCfg.terrainColorHex);
    this.vistaPeakMat.color.setHex(mapCfg.vistaColorHex);
    const deepFloor = this.camera.userData.deepFloorMesh as THREE.Mesh;
    if (deepFloor) {
      (deepFloor.material as THREE.MeshStandardMaterial).color.setHex(
        mapCfg.terrainColorHex,
      );
    }

    this.waterMesh.visible = mapCfg.waterEnabled;
    this.urbanTowersInstanced.visible = mapCfg.urbanBuildings;
    this.desertMesasInstanced.visible = mapCfg.desertMesas;

    const maxAniso = this.renderer.capabilities.getMaxAnisotropy();
    const newRoadTex = createRoadAsphaltTexture(maxAniso, mapName);
    this.roadMaterial.map = newRoadTex;
    this.roadMaterial.needsUpdate = true;
    this.roadTexture.dispose();
    this.roadTexture = newRoadTex;
  }

  public setCameraView(view: CameraViewMode): void {
    this.cameraView = view;
  }

  public getCameraView(): CameraViewMode {
    return this.cameraView;
  }

  public clearHazardCache(): void {
    for (const [, node] of this.hazardNodes.entries()) {
      this.scene.remove(node.group);
    }
    this.hazardNodes.clear();
  }

  public getDiagnostics(): RendererDiagnostics {
    const fps = Math.min(
      120,
      Math.max(1, Math.round(1000 / Math.max(1, this.smoothedFrameTimeMs))),
    );
    return {
      activeBackend: this.isSoftwareGl
        ? 'WebGL 2 (Software Headless Fallback)'
        : 'WebGL 2 (Hardware Accelerated)',
      webgpuSupported: this.webgpuSupported,
      webgpuNote: this.webgpuSupported
        ? 'WebGPU adapter detected; unified WebGL 2 PBR pipeline active'
        : 'WebGL 2 PBR pipeline active',
      frameTimeMs: Number(this.smoothedFrameTimeMs.toFixed(1)),
      fps,
      qualityPreset: this.qualityPreset,
      lightingPreset: this.lightingPreset,
      mapPreset: this.mapPreset,
      cameraView: this.cameraView,
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
      // Orient vehicle along road heading AND vertical slope pitchRad so tires sit flush on hills!
      node.group.rotation.set(sample.pitchRad, -sample.headingRad, 0, 'YXZ');

      // Spin AI traffic wheels based on their longitudinal travel s
      const wheelRot = -(h.s / 0.34) % (Math.PI * 200);
      for (const w of node.wheels) {
        w.rotation.x = wheelRot;
      }

      const flash = Math.sin(timeSec * 18) > 0;
      for (const bMesh of node.brakeLights) {
        const mat = bMesh.material as THREE.MeshStandardMaterial;
        if (h.telegraphActive || h.brakeTriggered) {
          mat.emissiveIntensity = flash ? 3.5 : 1.6;
        } else {
          mat.emissiveIntensity = 0.75;
        }
      }

      if (node.beaconLight) {
        const mat = node.beaconLight.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = flash ? 3.6 : 0.4;
      }

      if (node.strobeLights && node.strobeLights.length >= 2) {
        const strobePhase = Math.sin(timeSec * 22) > 0;
        (
          node.strobeLights[0].material as THREE.MeshStandardMaterial
        ).emissiveIntensity = strobePhase ? 3.8 : 0.3;
        (
          node.strobeLights[1].material as THREE.MeshStandardMaterial
        ).emissiveIntensity = strobePhase ? 0.3 : 3.8;
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
    collisionEvents?: StepCollisionEvent[],
  ): void {
    this.smoothedFrameTimeMs =
      this.smoothedFrameTimeMs * 0.92 + dt * 1000 * 0.08;

    const pose = getInterpolatedVehiclePose(vehicle);
    const baseS = pose.s;
    const presetCfg = QUALITY_PRESETS[this.qualityPreset];
    const mapCfg = MAP_PRESETS[this.mapPreset];

    const segLen = ROAD_CONFIG.segmentLength;
    const segs = ROAD_CONFIG.visibleSegments;
    const halfWidth =
      ROAD_CONFIG.totalRoadWidth * 0.5 + ROAD_CONFIG.shoulderWidth;

    const posAttr = this.roadGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;
    const uvAttr = this.roadGeometry.getAttribute('uv') as THREE.BufferAttribute;
    const tPosAttr = this.terrainGeometry.getAttribute(
      'position',
    ) as THREE.BufferAttribute;

    const startSegmentIndex = Math.floor(baseS / segLen) - 6;

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

      // Update Road-Following Terrain Skirt (6 vertices per row)
      // Strictly anchored below sample.elevationY at road edges so ground NEVER pokes through road!
      const rowBase = i * 6;
      const leftVistaDist = 185;
      const leftBermDist = 14;
      const rightBermDist = 14;
      const rightVistaDist = 185;

      const leftSlopeY = mapCfg.waterEnabled
        ? sample.elevationY - 4.2
        : sample.elevationY + 2.4 + Math.sin(segIdx * 0.17) * 1.4;
      const rightSlopeY =
        sample.elevationY + 3.2 + Math.cos(segIdx * 0.19) * 1.8;

      // Col 0: Outer Left Vista
      tPosAttr.setXYZ(
        rowBase + 0,
        sample.centerX - leftVistaDist * nx,
        leftSlopeY,
        -s - leftVistaDist * nz,
      );
      // Col 1: Mid Left Embankment Berm
      tPosAttr.setXYZ(
        rowBase + 1,
        sample.centerX - leftBermDist * nx,
        sample.elevationY - 0.12,
        -s - leftBermDist * nz,
      );
      // Col 2: Inner Left Shoulder Sub-Base (strictly -0.08m below road surface)
      tPosAttr.setXYZ(rowBase + 2, leftX, sample.elevationY - 0.08, leftZ);
      // Col 3: Inner Right Shoulder Sub-Base (strictly -0.08m below road surface)
      tPosAttr.setXYZ(rowBase + 3, rightX, sample.elevationY - 0.08, rightZ);
      // Col 4: Mid Right Embankment Berm
      tPosAttr.setXYZ(
        rowBase + 4,
        sample.centerX + rightBermDist * nx,
        sample.elevationY - 0.12,
        -s + rightBermDist * nz,
      );
      // Col 5: Outer Right Vista
      tPosAttr.setXYZ(
        rowBase + 5,
        sample.centerX + rightVistaDist * nx,
        rightSlopeY,
        -s + rightVistaDist * nz,
      );
    }

    posAttr.needsUpdate = true;
    uvAttr.needsUpdate = true;
    this.roadGeometry.computeVertexNormals();

    tPosAttr.needsUpdate = true;
    this.terrainGeometry.computeVertexNormals();

    // 1. Update Instanced roadside reflector posts & Continuous 3D W-Beam Guardrails
    const postSpacing = 8.0;
    const firstPostIdx = Math.floor(baseS / postSpacing) - 3;
    for (let i = 0; i < 48; i++) {
      const s = (firstPostIdx + i) * postSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);

      _euler.set(sample.pitchRad, -sample.headingRad, 0, 'YXZ');
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);

      _pos.set(
        sample.centerX - ROAD_CONFIG.guardrailOffset * nx,
        sample.elevationY + 0.42,
        -s - ROAD_CONFIG.guardrailOffset * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.leftPostsInstanced.setMatrixAt(i, _mat4);
      this.leftGuardrailsInstanced.setMatrixAt(i, _mat4);

      _pos.set(
        sample.centerX + ROAD_CONFIG.guardrailOffset * nx,
        sample.elevationY + 0.42,
        -s + ROAD_CONFIG.guardrailOffset * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.rightPostsInstanced.setMatrixAt(i, _mat4);
      this.rightGuardrailsInstanced.setMatrixAt(i, _mat4);
    }
    this.leftPostsInstanced.instanceMatrix.needsUpdate = true;
    this.rightPostsInstanced.instanceMatrix.needsUpdate = true;
    this.leftGuardrailsInstanced.instanceMatrix.needsUpdate = true;
    this.rightGuardrailsInstanced.instanceMatrix.needsUpdate = true;

    // 2. Update Highway Street Light Poles & Luminaires along right shoulder
    const lampSpacing = 24.0;
    const firstLampIdx = Math.floor(baseS / lampSpacing) - 2;
    for (let i = 0; i < 32; i++) {
      const s = (firstLampIdx + i) * lampSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = mapCfg.urbanBuildings && i % 2 === 0 ? -1 : 1;

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);

      const poleDist = ROAD_CONFIG.guardrailOffset + 1.25;
      _pos.set(
        sample.centerX + side * poleDist * nx,
        sample.elevationY + 3.3,
        -s + side * poleDist * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.lamppostsInstanced.setMatrixAt(i, _mat4);

      const headDist = ROAD_CONFIG.guardrailOffset + 0.65;
      _pos.set(
        sample.centerX + side * headDist * nx,
        sample.elevationY + 6.55,
        -s + side * headDist * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.lampHeadsInstanced.setMatrixAt(i, _mat4);
    }
    this.lamppostsInstanced.instanceMatrix.needsUpdate = true;
    this.lampHeadsInstanced.instanceMatrix.needsUpdate = true;

    // 3. Update Instanced Trees (hidden or sparse in desert/urban, lush in alpine/coastal)
    const activeTrees =
      this.mapPreset === 'desert' || this.mapPreset === 'urban'
        ? 0
        : Math.min(80, presetCfg.sceneryCount);
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
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = this.mapPreset === 'coastal' ? 1 : idx % 2 === 0 ? -1 : 1;
      const distOut = 10.5 + (Math.abs(idx * 17) % 15) * 1.1;
      const scaleMod = 0.85 + (Math.abs(idx * 31) % 35) / 100;

      const x = sample.centerX + side * distOut * nx;
      const z = -s + side * distOut * nz;

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(scaleMod, scaleMod, scaleMod);

      _pos.set(x, sample.elevationY + 0.85 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.treesTrunksInstanced.setMatrixAt(i, _mat4);

      _pos.set(x, sample.elevationY + 2.85 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.treesCanopyInstanced.setMatrixAt(i, _mat4);
    }
    this.treesTrunksInstanced.instanceMatrix.needsUpdate = true;
    this.treesCanopyInstanced.instanceMatrix.needsUpdate = true;

    // 4. Update Autumn Birch Trees
    const autumnSpacing = 14.0;
    const firstAutumnIdx = Math.floor(baseS / autumnSpacing) - 2;
    for (let i = 0; i < 45; i++) {
      if (this.mapPreset === 'desert' || this.mapPreset === 'urban') {
        _scale.set(0, 0, 0);
        _mat4.compose(_pos, _quat, _scale);
        this.autumnTreesTrunksInstanced.setMatrixAt(i, _mat4);
        this.autumnTreesCanopyInstanced.setMatrixAt(i, _mat4);
        continue;
      }
      const idx = firstAutumnIdx + i;
      const s = idx * autumnSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = this.mapPreset === 'coastal' ? 1 : idx % 2 === 0 ? 1 : -1;
      const distOut = 14.2 + (Math.abs(idx * 23) % 12);
      const scaleMod = 0.9 + (Math.abs(idx * 19) % 30) / 100;

      const x = sample.centerX + side * distOut * nx;
      const z = -s + side * distOut * nz;

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(scaleMod, scaleMod, scaleMod);

      _pos.set(x, sample.elevationY + 1.05 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.autumnTreesTrunksInstanced.setMatrixAt(i, _mat4);

      _pos.set(x, sample.elevationY + 3.15 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.autumnTreesCanopyInstanced.setMatrixAt(i, _mat4);
    }
    this.autumnTreesTrunksInstanced.instanceMatrix.needsUpdate = true;
    this.autumnTreesCanopyInstanced.instanceMatrix.needsUpdate = true;

    // 5. Update Roadside Boulders
    const boulderSpacing = 16.0;
    const firstBoulderIdx = Math.floor(baseS / boulderSpacing) - 2;
    for (let i = 0; i < 36; i++) {
      const idx = firstBoulderIdx + i;
      const s = idx * boulderSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = idx % 2 === 0 ? -1 : 1;
      const distOut = 9.2 + (Math.abs(idx * 29) % 9);
      const scaleMod = 0.75 + (Math.abs(idx * 13) % 65) / 100;

      _euler.set(idx * 0.4, -sample.headingRad + idx * 0.7, 0);
      _quat.setFromEuler(_euler);
      _scale.set(scaleMod * 1.35, scaleMod * 0.85, scaleMod);
      _pos.set(
        sample.centerX + side * distOut * nx,
        sample.elevationY + 0.42 * scaleMod,
        -s + side * distOut * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.bouldersInstanced.setMatrixAt(i, _mat4);
    }
    this.bouldersInstanced.instanceMatrix.needsUpdate = true;

    // 6. Update Urban Skyscrapers (when urban map is active)
    if (mapCfg.urbanBuildings) {
      const towerSpacing = 18.0;
      const firstTowerIdx = Math.floor(baseS / towerSpacing) - 2;
      for (let i = 0; i < 36; i++) {
        const idx = firstTowerIdx + i;
        const s = idx * towerSpacing;
        const sample = getRoadSample(s);
        const nx = Math.cos(sample.headingRad);
        const nz = Math.sin(sample.headingRad);
        const side = idx % 2 === 0 ? 1 : -1;
        const distOut = 20.0 + (Math.abs(idx * 19) % 18);
        const heightScale = 0.65 + (Math.abs(idx * 37) % 85) / 100;

        _euler.set(0, -sample.headingRad, 0);
        _quat.setFromEuler(_euler);
        _scale.set(1.0, heightScale, 1.0);
        _pos.set(
          sample.centerX + side * distOut * nx,
          sample.elevationY + 21 * heightScale - 2,
          -s + side * distOut * nz,
        );
        _mat4.compose(_pos, _quat, _scale);
        this.urbanTowersInstanced.setMatrixAt(i, _mat4);
      }
      this.urbanTowersInstanced.instanceMatrix.needsUpdate = true;
    }

    // 7. Update Desert Sandstone Mesas (when desert map is active)
    if (mapCfg.desertMesas) {
      const mesaSpacing = 24.0;
      const firstMesaIdx = Math.floor(baseS / mesaSpacing) - 2;
      for (let i = 0; i < 30; i++) {
        const idx = firstMesaIdx + i;
        const s = idx * mesaSpacing;
        const sample = getRoadSample(s);
        const nx = Math.cos(sample.headingRad);
        const nz = Math.sin(sample.headingRad);
        const side = idx % 2 === 0 ? -1 : 1;
        const distOut = 24.0 + (Math.abs(idx * 23) % 24);
        const scaleMod = 0.8 + (Math.abs(idx * 41) % 70) / 100;

        _euler.set(0, idx * 0.5, 0);
        _quat.setFromEuler(_euler);
        _scale.set(scaleMod * 1.4, scaleMod, scaleMod * 1.2);
        _pos.set(
          sample.centerX + side * distOut * nx,
          sample.elevationY + 8.5 * scaleMod - 1.5,
          -s + side * distOut * nz,
        );
        _mat4.compose(_pos, _quat, _scale);
        this.desertMesasInstanced.setMatrixAt(i, _mat4);
      }
      this.desertMesasInstanced.instanceMatrix.needsUpdate = true;
    }

    // 8. Update Overhead Highway Gantries
    for (let i = 0; i < this.highwayGantries.length; i++) {
      const g = this.highwayGantries[i];
      while (g.spacingS < baseS - 40) {
        g.spacingS += 495;
      }
      while (g.spacingS > baseS + 495) {
        g.spacingS -= 495;
      }
      const sample = getRoadSample(g.spacingS);
      g.group.position.set(sample.centerX, sample.elevationY, -g.spacingS);
      g.group.rotation.set(sample.pitchRad, -sample.headingRad, 0, 'YXZ');

      const beaconFlash =
        (attentionState === 'DISTRACTED' ||
          attentionState === 'POSSIBLY_DISTRACTED') &&
        Math.sin(timeSec * 16) > 0;
      for (const b of g.warningBeacons) {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity =
          beaconFlash ? 3.5 : 0.8;
      }
    }

    // 9. Update Overhead Concrete Overpass Flyover Bridges
    for (let i = 0; i < this.overpassBridges.length; i++) {
      const bridge = this.overpassBridges[i];
      while (bridge.spacingS < baseS - 60) {
        bridge.spacingS += 680;
      }
      while (bridge.spacingS > baseS + 680) {
        bridge.spacingS -= 680;
      }
      const sample = getRoadSample(bridge.spacingS);
      bridge.group.position.set(
        sample.centerX,
        sample.elevationY,
        -bridge.spacingS,
      );
      bridge.group.rotation.set(sample.pitchRad, -sample.headingRad, 0, 'YXZ');
    }

    const vistaGroup = this.camera.userData.vistaGroup as THREE.Group;
    const deepFloorMesh = this.camera.userData.deepFloorMesh as THREE.Mesh;
    if (vistaGroup) {
      vistaGroup.position.z = -baseS;
      vistaGroup.position.x = getRoadSample(baseS + 180).centerX * 0.5;
    }
    if (deepFloorMesh) deepFloorMesh.position.z = -baseS;
    if (this.waterMesh.visible) this.waterMesh.position.z = -baseS;

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
    const pitchVisual =
      playerRoad.pitchRad + (reducedMotion ? 0 : vehicle.pitchOffset);
    const rollVisual = reducedMotion ? 0 : vehicle.rollOffset;

    // Position & animate Player Hero GT Sports Coupe
    this.playerHeroCar.group.position.set(carWorldX, carWorldY, carWorldZ);
    this.playerHeroCar.group.rotation.set(
      pitchVisual,
      carYaw,
      rollVisual,
      'YXZ',
    );

    for (const w of this.playerHeroCar.wheels) {
      w.rotation.x = -vehicle.wheelRotationRad;
    }
    if (this.playerHeroCar.frontWheelPivots) {
      for (const fp of this.playerHeroCar.frontWheelPivots) {
        fp.rotation.y = -pose.steerAngle * 0.45;
      }
    }
    for (const bLight of this.playerHeroCar.brakeLights) {
      (bLight.material as THREE.MeshStandardMaterial).emissiveIntensity =
        vehicle.brakeLightActive ? 3.8 : 1.1;
    }

    // Position 3D Interior Cockpit Rig
    this.cockpitRig.position.set(carWorldX, carWorldY + 1.18, carWorldZ);
    this.cockpitRig.rotation.set(pitchVisual, carYaw, rollVisual, 'YXZ');

    // Toggle visibility between Cockpit View and Exterior (Chase / Hood / Title) Views
    const showCockpit = !isTitleScreen && this.cameraView === 'cockpit';
    this.cockpitRig.visible = showCockpit;
    this.playerHeroCar.group.visible = !showCockpit;

    // Aim real 3D Headlight SpotLight along the road ahead of the car
    this.headlightSpot.position.set(carWorldX, carWorldY + 0.68, carWorldZ);
    const aheadSample = getRoadSample(baseS + 26);
    this.headlightTarget.position.set(
      aheadSample.centerX + pose.lateralOffset * Math.cos(aheadSample.headingRad),
      aheadSample.elevationY,
      -(baseS + 26) + pose.lateralOffset * Math.sin(aheadSample.headingRad),
    );

    this.steeringWheelGroup.rotation.z = -pose.steerAngle * 1.65;

    if (attentionState === 'DISTRACTED') {
      this.dashWarningStripMat.color.setHex(0xef4444);
      this.dashWarningStripMat.emissive.setHex(0xef4444);
      this.dashWarningStripMat.emissiveIntensity =
        1.6 + Math.sin(timeSec * 20) * 1.0;
    } else if (attentionState === 'POSSIBLY_DISTRACTED') {
      this.dashWarningStripMat.color.setHex(0xf59e0b);
      this.dashWarningStripMat.emissive.setHex(0xf59e0b);
      this.dashWarningStripMat.emissiveIntensity = 1.25;
    } else {
      this.dashWarningStripMat.color.setHex(0x10b981);
      this.dashWarningStripMat.emissive.setHex(0x10b981);
      this.dashWarningStripMat.emissiveIntensity = 0.55;
    }

    const laneShiftClamped = THREE.MathUtils.clamp(
      (pose.lateralOffset - ROAD_CONFIG.playerDefaultLaneOffset) * 0.08,
      -0.18,
      0.18,
    );
    this.dashLaneBarMesh.position.x = laneShiftClamped;

    // Dynamic FOV Speed Sense (63° base -> up to 71° at high speed)
    const speedRatio = Math.min(1, vehicle.speed / 34);
    const targetFov = isTitleScreen
      ? 56
      : reducedMotion
      ? 64
      : 63 + speedRatio * 8.5;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov = THREE.MathUtils.damp(
        this.camera.fov,
        targetFov,
        6,
        Math.max(0.001, dt),
      );
      this.camera.updateProjectionMatrix();
    }

    const forwardX = -Math.sin(carYaw);
    const forwardZ = -Math.cos(carYaw);
    const rightX = Math.cos(carYaw);
    const rightZ = -Math.sin(carYaw);

    if (isTitleScreen) {
      // Smooth showcase camera framing the GT Sports Coupe in the right two-thirds of the viewport
      const sway = Math.sin(timeSec * 0.5) * 0.65;
      _targetCamPos.set(
        carWorldX - forwardX * 5.2 + rightX * (1.55 + sway),
        carWorldY + 1.85,
        carWorldZ - forwardZ * 5.2 + rightZ * (1.55 + sway),
      );
      this.camera.position.copy(_targetCamPos);
      _lookTarget.set(
        carWorldX + forwardX * 8.0 - rightX * 1.1,
        carWorldY + 0.95,
        carWorldZ + forwardZ * 8.0 - rightZ * 1.1,
      );
      this.camera.lookAt(_lookTarget);
      this.cameraInitialized = false;
    } else {
      const shakeAmt = reducedMotion
        ? 0
        : vehicle.trauma * vehicle.trauma * 0.025;
      const shakeX = Math.sin(timeSec * 42) * shakeAmt;
      const shakeY = Math.cos(timeSec * 48) * shakeAmt;

      const targetHeadYawRad = THREE.MathUtils.degToRad(-headYawDeg * 0.72);
      const targetHeadPitchRad = THREE.MathUtils.degToRad(
        -headPitchDeg * 0.55,
      );

      const dampFactor = 1 - Math.exp(-9.5 * Math.max(0.001, dt));
      this.smoothedHeadYawRad +=
        (targetHeadYawRad - this.smoothedHeadYawRad) * dampFactor;
      this.smoothedHeadPitchRad +=
        (targetHeadPitchRad - this.smoothedHeadPitchRad) * dampFactor;

      let desiredLocalOffset: THREE.Vector3;
      if (this.cameraView === 'chase') {
        desiredLocalOffset = _targetCamPos.set(0, 1.92, 5.15);
      } else if (this.cameraView === 'hood') {
        desiredLocalOffset = _targetCamPos.set(0, 1.06, -0.85);
      } else {
        desiredLocalOffset = _targetCamPos.set(0, 1.22, 0);
      }

      if (!this.cameraInitialized) {
        this.smoothedCamOffset.copy(desiredLocalOffset);
        this.cameraInitialized = true;
      } else {
        this.smoothedCamOffset.lerp(
          desiredLocalOffset,
          1 - Math.exp(-10 * Math.max(0.001, dt)),
        );
      }

      // Transform local camera offset by car heading
      const worldCamX =
        carWorldX +
        rightX * this.smoothedCamOffset.x -
        forwardX * this.smoothedCamOffset.z +
        shakeX;
      const worldCamY =
        carWorldY +
        this.smoothedCamOffset.y -
        this.smoothedCamOffset.z * Math.sin(pitchVisual) +
        shakeY;
      const worldCamZ =
        carWorldZ +
        rightZ * this.smoothedCamOffset.x -
        forwardZ * this.smoothedCamOffset.z;

      this.camera.position.set(worldCamX, worldCamY, worldCamZ);

      const basePitchBias = this.cameraView === 'chase' ? -0.11 : -0.028;
      this.camera.rotation.set(
        pitchVisual + this.smoothedHeadPitchRad + basePitchBias,
        carYaw + this.smoothedHeadYawRad,
        rollVisual * (this.cameraView === 'chase' ? 0.55 : 1.0),
        'YXZ',
      );
    }

    // Collision impact sparks & debris bursts
    if (collisionEvents && collisionEvents.length > 0) {
      for (const ev of collisionEvents) {
        if (ev.type === 'hazard' || ev.type === 'guardrail') {
          this.particleEngine.emitImpactSparks(
            carWorldX,
            carWorldY + 0.45,
            carWorldZ - 1.2,
            34,
            ev.type === 'guardrail',
          );
        }
      }
    }
    this.particleEngine.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  public isUsingSoftwareGl(): boolean {
    return this.isSoftwareGl;
  }

  public getWebGLContext(): WebGL2RenderingContext | null {
    return this.renderer.getContext() as WebGL2RenderingContext | null;
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.particleEngine.dispose();
    this.roadGeometry.dispose();
    this.terrainGeometry.dispose();
    this.roadTexture.dispose();
    this.dashScreenTexture.dispose();
    this.renderer.dispose();
  }
}
