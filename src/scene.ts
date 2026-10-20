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

import { ParticleEngine } from './particles.ts';
import type { StepCollisionEvent } from './vehicle.ts';

function createRoadAsphaltTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // 1. Deep realistic dark asphalt base
  ctx.fillStyle = '#181e28';
  ctx.fillRect(0, 0, 1024, 1024);

  // 2. Micro aggregate stone specks
  for (let i = 0; i < 18000; i++) {
    const x = (i * 79) % 1024;
    const y = (i * 157) % 1024;
    const v = 26 + ((i * 31) % 24);
    ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 9})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // 3. Dark tar crack sealant lines
  ctx.strokeStyle = '#0f141c';
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(180, 0);
  ctx.bezierCurveTo(220, 280, 140, 680, 210, 1024);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(760, 0);
  ctx.bezierCurveTo(720, 320, 810, 720, 750, 1024);
  ctx.stroke();

  // 4. Paved shoulders (left & right)
  ctx.fillStyle = '#263140';
  ctx.fillRect(0, 0, 112, 1024);
  ctx.fillRect(912, 0, 112, 1024);

  // 5. Corrugated warning rumble strips
  for (let y = 0; y < 1024; y += 48) {
    ctx.fillStyle = y % 96 === 0 ? '#f59e0b' : '#1e293b';
    ctx.fillRect(80, y, 32, 28);
    ctx.fillRect(912, y, 32, 28);
  }

  // 6. Solid outer reflective white road edge lines
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(116, 0, 16, 1024);
  ctx.fillRect(892, 0, 16, 1024);

  // 7. Center double yellow highway divider + passing dash
  for (let y = 0; y < 1024; y += 96) {
    ctx.fillStyle = '#fbbf24';
    ctx.fillRect(504, y + 10, 16, 56);
    // Reflective cat's eye road stud with silver housing & crystal
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(507, y + 74, 10, 10);
    ctx.fillStyle = '#fef08a';
    ctx.fillRect(509, y + 76, 6, 6);
  }

  // 8. Pronounced dark rubber braking skid marks
  ctx.fillStyle = 'rgba(10, 15, 24, 0.45)';
  // Left lane tire paths
  ctx.fillRect(230, 0, 44, 1024);
  ctx.fillRect(350, 0, 44, 1024);
  // Right lane tire paths
  ctx.fillRect(630, 0, 44, 1024);
  ctx.fillRect(750, 0, 44, 1024);

  // Heavy emergency braking skid marks in right lane
  ctx.fillStyle = 'rgba(7, 10, 18, 0.65)';
  ctx.beginPath();
  ctx.moveTo(638, 180);
  ctx.quadraticCurveTo(644, 450, 656, 780);
  ctx.lineTo(670, 780);
  ctx.quadraticCurveTo(658, 450, 652, 180);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(758, 180);
  ctx.quadraticCurveTo(764, 450, 776, 780);
  ctx.lineTo(790, 780);
  ctx.quadraticCurveTo(778, 450, 772, 180);
  ctx.fill();

  // 9. Painted speed stencil "80" on right lane asphalt
  ctx.fillStyle = 'rgba(248, 250, 252, 0.28)';
  ctx.font = 'bold 120px monospace';
  ctx.fillText('80', 660, 560);

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
    // High-visibility Construction Work Zone Barrier Trailer & Arrow Board
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.45,
      metalness: 0.15,
    });
    const whiteStripeMat = new THREE.MeshStandardMaterial({
      color: 0xf8fafc,
      roughness: 0.3,
      metalness: 0.2,
    });
    const steelMat = new THREE.MeshStandardMaterial({
      color: 0x334155,
      roughness: 0.5,
      metalness: 0.75,
    });

    // 1. Trailer chassis & wheels
    const trailerBase = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.35, 3.6), steelMat);
    trailerBase.position.set(0, 0.42, 0);
    group.add(trailerBase);

    const wheelGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.22, 12);
    wheelGeo.rotateZ(Math.PI / 2);
    const wheelMat = new THREE.MeshStandardMaterial({ color: 0x090d16, roughness: 0.85 });
    const wL = new THREE.Mesh(wheelGeo, wheelMat);
    wL.position.set(-1.12, 0.36, 0);
    const wR = new THREE.Mesh(wheelGeo, wheelMat);
    wR.position.set(1.12, 0.36, 0);
    group.add(wL, wR);

    // 2. High-visibility Orange & White Barricade Boards
    const barGeo = new THREE.BoxGeometry(2.05, 0.24, 0.08);
    for (let b = 0; b < 3; b++) {
      const bar = new THREE.Mesh(barGeo, b % 2 === 0 ? orangeMat : whiteStripeMat);
      bar.position.set(0, 0.85 + b * 0.32, -1.2);
      group.add(bar);
    }

    // 3. Illuminated LED Directional Arrow Board
    const boardFrame = new THREE.Mesh(new THREE.BoxGeometry(1.9, 1.25, 0.16), steelMat);
    boardFrame.position.set(0, 2.2, 0.3);
    group.add(boardFrame);

    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.2,
      roughness: 0.2,
    });

    // Sequential Arrow LED matrix indicators
    for (let col = -3; col <= 3; col++) {
      const led = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.1, 8),
        beaconMat,
      );
      led.rotation.x = Math.PI / 2;
      led.position.set(col * 0.24, 2.2, 0.39);
      group.add(led);
    }

    // Top dual flashing beacon lights
    const beaconTopL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10),
      beaconMat,
    );
    beaconTopL.position.set(-0.75, 2.95, 0.3);
    const beaconTopR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.22, 10),
      beaconMat.clone(),
    );
    beaconTopR.position.set(0.75, 2.95, 0.3);
    group.add(beaconTopL, beaconTopR);

    // 4. Weighted reflective construction barrels & cones on approach
    const barrelGeo = new THREE.CylinderGeometry(0.3, 0.32, 0.95, 12);
    const barrel = new THREE.Mesh(barrelGeo, orangeMat);
    barrel.position.set(hazard.laneIndex === 1 ? -0.85 : 0.85, 0.475, -2.4);
    const barrelStripe = new THREE.Mesh(
      new THREE.CylinderGeometry(0.305, 0.315, 0.28, 12),
      whiteStripeMat,
    );
    barrelStripe.position.set(0, 0.12, 0);
    barrel.add(barrelStripe);
    group.add(barrel);

    return { group, brakeLights, beaconLight: beaconTopL };
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
    roughness: 0.24,
    metalness: 0.65,
  });
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x0f172a,
    roughness: 0.1,
    metalness: 0.9,
  });
  const trimMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.7,
    metalness: 0.3,
  });
  const chromeMat = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.15,
    metalness: 0.95,
  });
  const tireRubberMat = new THREE.MeshStandardMaterial({
    color: 0x090d16,
    roughness: 0.9,
    metalness: 0.05,
  });
  const rimAlloyMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.25,
    metalness: 0.85,
  });
  const headlightMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 1.8,
    roughness: 0.15,
  });
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  if (isTruck) {
    // -------------------------------------------------------------------------
    // Heavy Commercial Box Delivery Truck with Reflective Chevron Safety Tape
    // -------------------------------------------------------------------------
    // 1. Aerodynamic Cab Chassis
    const cab = new THREE.Mesh(new THREE.BoxGeometry(2.18, 1.95, 1.9), hullMat);
    cab.position.set(0, 1.35, 2.75);
    group.add(cab);

    // Cab windshield & side windows
    const cabWindshield = new THREE.Mesh(new THREE.BoxGeometry(2.06, 0.85, 0.15), glassMat);
    cabWindshield.position.set(0, 1.65, 3.72);
    cabWindshield.rotation.x = -0.15;
    group.add(cabWindshield);

    // Front Chrome Bumper & Grille
    const frontBumper = new THREE.Mesh(new THREE.BoxGeometry(2.26, 0.42, 0.45), chromeMat);
    frontBumper.position.set(0, 0.45, 3.75);
    group.add(frontBumper);

    // Dual Headlights
    const hL = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.1), headlightMat);
    hL.position.set(-0.85, 0.52, 3.98);
    const hR = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.2, 0.1), headlightMat);
    hR.position.set(0.85, 0.52, 3.98);
    group.add(hL, hR);

    // 2. High-Capacity Cargo Box
    const cargoBox = new THREE.Mesh(
      new THREE.BoxGeometry(2.32, 2.55, 5.3),
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.45,
        metalness: 0.2,
      }),
    );
    cargoBox.position.set(0, 1.72, -0.65);
    group.add(cargoBox);

    // Rear Safety Chevron Hazard Panel (Yellow & Black Stripes)
    const chevronCanvas = document.createElement('canvas');
    chevronCanvas.width = 256;
    chevronCanvas.height = 128;
    const cctx = chevronCanvas.getContext('2d')!;
    cctx.fillStyle = '#fbbf24';
    cctx.fillRect(0, 0, 256, 128);
    cctx.fillStyle = '#0f172a';
    for (let x = -64; x < 320; x += 48) {
      cctx.beginPath();
      cctx.moveTo(x, 128);
      cctx.lineTo(x + 32, 128);
      cctx.lineTo(x + 56, 0);
      cctx.lineTo(x + 24, 0);
      cctx.fill();
    }
    const chevronTex = new THREE.CanvasTexture(chevronCanvas);
    const chevronMat = new THREE.MeshStandardMaterial({
      map: chevronTex,
      roughness: 0.4,
    });
    const chevronMesh = new THREE.Mesh(new THREE.PlaneGeometry(2.28, 0.65), chevronMat);
    chevronMesh.position.set(0, 0.62, -3.32);
    chevronMesh.rotation.y = Math.PI;
    group.add(chevronMesh);

    // Side diesel fuel tanks & boarding steps
    const fuelTankGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.4, 12);
    fuelTankGeo.rotateX(Math.PI / 2);
    const tankL = new THREE.Mesh(fuelTankGeo, chromeMat);
    tankL.position.set(-1.12, 0.45, 1.1);
    const tankR = new THREE.Mesh(fuelTankGeo, chromeMat);
    tankR.position.set(1.12, 0.45, 1.1);
    group.add(tankL, tankR);

    // Heavy dual wheels (6 wheels total: 2 front, 4 dual rear)
    const tireGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.28, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.24, 0.24, 0.29, 10);
    rimGeo.rotateZ(Math.PI / 2);

    const wheelSpecs = [
      [-1.08, 0.42, 2.6],
      [1.08, 0.42, 2.6],
      [-1.12, 0.42, -1.8],
      [1.12, 0.42, -1.8],
      [-1.12, 0.42, -2.6],
      [1.12, 0.42, -2.6],
    ];
    for (const [wx, wy, wz] of wheelSpecs) {
      const tire = new THREE.Mesh(tireGeo, tireRubberMat);
      tire.position.set(wx, wy, wz);
      const rim = new THREE.Mesh(rimGeo, rimAlloyMat);
      tire.add(rim);
      group.add(tire);
    }
  } else {
    // -------------------------------------------------------------------------
    // Sleek Sports Sedan with Aerodynamic Profile, Grille & Alloy Rims
    // -------------------------------------------------------------------------
    // 1. Lower Body Chassis
    const lowerBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.84, 0.52, 4.2),
      hullMat,
    );
    lowerBody.position.set(0, 0.5, 0);
    group.add(lowerBody);

    // 2. Sculpted Hood & Trunk Wedge
    const hoodCrease = new THREE.Mesh(
      new THREE.BoxGeometry(1.68, 0.14, 1.5),
      hullMat,
    );
    hoodCrease.position.set(0, 0.74, 1.25);
    hoodCrease.rotation.x = -0.06;
    group.add(hoodCrease);

    // 3. Cabin Greenhouse (Windshield, Roof, Windows)
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.52, 0.58, 2.15),
      glassMat,
    );
    cabin.position.set(0, 1.05, -0.15);
    group.add(cabin);

    // Sleek Roof Panel in matching body paint
    const roof = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.05, 1.6), hullMat);
    roof.position.set(0, 1.35, -0.18);
    group.add(roof);

    // 4. Front Radiator Grille & Diffuser
    const grille = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.22, 0.05), trimMat);
    grille.position.set(0, 0.48, 2.12);
    group.add(grille);

    // Dual Projector Headlights
    const hL = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.08), headlightMat);
    hL.position.set(-0.68, 0.58, 2.11);
    const hR = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.14, 0.08), headlightMat);
    hR.position.set(0.68, 0.58, 2.11);
    group.add(hL, hR);

    // Side Exterior Mirrors
    const mirrorGeo = new THREE.BoxGeometry(0.18, 0.1, 0.12);
    const mirL = new THREE.Mesh(mirrorGeo, trimMat);
    mirL.position.set(-0.96, 0.98, 0.65);
    const mirR = new THREE.Mesh(mirrorGeo, trimMat);
    mirR.position.set(0.96, 0.98, 0.65);
    group.add(mirL, mirR);

    // 5. High-Detail Wheels with 5-Spoke Alloy Rims
    const tireGeo = new THREE.CylinderGeometry(0.33, 0.33, 0.24, 14);
    tireGeo.rotateZ(Math.PI / 2);
    const rimGeo = new THREE.CylinderGeometry(0.2, 0.2, 0.25, 8);
    rimGeo.rotateZ(Math.PI / 2);

    const wheelOffsets = [
      [-0.88, 0.33, -1.3],
      [0.88, 0.33, -1.3],
      [-0.88, 0.33, 1.3],
      [0.88, 0.33, 1.3],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const tire = new THREE.Mesh(tireGeo, tireRubberMat);
      tire.position.set(wx, wy, wz);
      const rim = new THREE.Mesh(rimGeo, rimAlloyMat);
      tire.add(rim);
      group.add(tire);
    }

    // Rear Bumper Diffuser & Dual Chrome Exhaust Tips
    const diffuser = new THREE.Mesh(new THREE.BoxGeometry(1.68, 0.16, 0.1), trimMat);
    diffuser.position.set(0, 0.28, -2.11);
    group.add(diffuser);

    const tipGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.12, 8);
    tipGeo.rotateX(Math.PI / 2);
    const tipL = new THREE.Mesh(tipGeo, chromeMat);
    tipL.position.set(-0.52, 0.27, -2.15);
    const tipR = new THREE.Mesh(tipGeo, chromeMat);
    tipR.position.set(0.52, 0.27, -2.15);
    group.add(tipL, tipR);
  }

  // Dual Wide Red LED Taillights / Brake Lights
  const tailZ = isTruck ? -3.32 : -2.11;
  const tailY = isTruck ? 0.88 : 0.65;
  const leftBrake = new THREE.Mesh(
    new THREE.BoxGeometry(isTruck ? 0.42 : 0.44, 0.16, 0.08),
    brakeMat.clone(),
  );
  leftBrake.position.set(-0.68, tailY, tailZ);
  const rightBrake = new THREE.Mesh(
    new THREE.BoxGeometry(isTruck ? 0.42 : 0.44, 0.16, 0.08),
    brakeMat.clone(),
  );
  rightBrake.position.set(0.68, tailY, tailZ);
  group.add(leftBrake, rightBrake);
  brakeLights.push(leftBrake, rightBrake);

  // Soft Ambient Contact Shadow Under Vehicle
  const shadowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(isTruck ? 2.6 : 2.1, isTruck ? 7.8 : 4.6),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.55,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0, 0.02, 0);
  group.add(shadowDisc);

  return { group, brakeLights };
}

function buildHighwayGantry(title: string, sub: string): {
  group: THREE.Group;
  warningBeacons: THREE.Mesh[];
} {
  const group = new THREE.Group();
  const trussMat = new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.45,
    metalness: 0.8,
  });

  // Vertical steel support columns safely behind left & right guardrails
  const colGeo = new THREE.CylinderGeometry(0.18, 0.22, 6.8, 8);
  const leftCol = new THREE.Mesh(colGeo, trussMat);
  leftCol.position.set(-6.8, 3.4, 0);
  const rightCol = new THREE.Mesh(colGeo, trussMat);
  rightCol.position.set(6.8, 3.4, 0);
  group.add(leftCol, rightCol);

  // Horizontal overhead truss beam spanning across both lanes
  const beam = new THREE.Mesh(new THREE.BoxGeometry(14.4, 0.55, 0.65), trussMat);
  beam.position.set(0, 6.2, 0);
  group.add(beam);

  // Highway green guide sign with canvas texture
  const signCanvas = document.createElement('canvas');
  signCanvas.width = 512;
  signCanvas.height = 160;
  const ctx = signCanvas.getContext('2d')!;
  ctx.fillStyle = '#15803d'; // interstate green
  ctx.fillRect(0, 0, 512, 160);
  ctx.strokeStyle = '#f8fafc';
  ctx.lineWidth = 6;
  ctx.strokeRect(6, 6, 500, 148);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px monospace';
  ctx.textAlign = 'center';
  ctx.fillText(title, 256, 65);
  ctx.font = 'bold 24px sans-serif';
  ctx.fillStyle = '#fef08a';
  ctx.fillText(sub, 256, 115);

  const signTex = new THREE.CanvasTexture(signCanvas);
  signTex.colorSpace = THREE.SRGBColorSpace;
  const signMat = new THREE.MeshStandardMaterial({
    map: signTex,
    roughness: 0.35,
    metalness: 0.1,
  });
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(6.4, 2.0), signMat);
  signMesh.position.set(0, 5.7, 0.35);
  group.add(signMesh);

  // Warning amber beacons
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
  beacon1.position.set(-3.1, 6.8, 0.35);
  const beacon2 = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.18, 0.28, 8),
    beaconMat.clone(),
  );
  beacon2.position.set(3.1, 6.8, 0.35);
  group.add(beacon1, beacon2);
  warningBeacons.push(beacon1, beacon2);

  return { group, warningBeacons };
}

function buildOverpassBridge(): THREE.Group {
  const group = new THREE.Group();
  const concreteMat = new THREE.MeshStandardMaterial({
    color: 0x94a3b8,
    roughness: 0.85,
    metalness: 0.1,
  });
  const asphaltMat = new THREE.MeshStandardMaterial({
    color: 0x1e293b,
    roughness: 0.7,
  });

  // Elevated deck spanning across road at 7.2m height
  const deck = new THREE.Mesh(new THREE.BoxGeometry(24, 1.4, 8.5), concreteMat);
  deck.position.set(0, 7.2, 0);
  group.add(deck);

  const topRoad = new THREE.Mesh(
    new THREE.BoxGeometry(23.8, 0.1, 8.0),
    asphaltMat,
  );
  topRoad.position.set(0, 7.95, 0);
  group.add(topRoad);

  // Dual concrete pillars safely placed beyond road shoulder & guardrail
  const pillarGeo = new THREE.BoxGeometry(1.2, 6.8, 1.4);
  const leftPillar1 = new THREE.Mesh(pillarGeo, concreteMat);
  leftPillar1.position.set(-8.2, 3.4, -2.5);
  const leftPillar2 = new THREE.Mesh(pillarGeo, concreteMat);
  leftPillar2.position.set(-8.2, 3.4, 2.5);

  const rightPillar1 = new THREE.Mesh(pillarGeo, concreteMat);
  rightPillar1.position.set(8.2, 3.4, -2.5);
  const rightPillar2 = new THREE.Mesh(pillarGeo, concreteMat);
  rightPillar2.position.set(8.2, 3.4, 2.5);
  group.add(leftPillar1, leftPillar2, rightPillar1, rightPillar2);

  return group;
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

  private particleEngine: ParticleEngine;
  private leftPostsInstanced: THREE.InstancedMesh;
  private rightPostsInstanced: THREE.InstancedMesh;
  private leftGuardrailsInstanced: THREE.InstancedMesh;
  private rightGuardrailsInstanced: THREE.InstancedMesh;
  private lamppostsInstanced: THREE.InstancedMesh;
  private treesTrunksInstanced: THREE.InstancedMesh;
  private treesCanopyInstanced: THREE.InstancedMesh;
  private autumnTreesTrunksInstanced: THREE.InstancedMesh;
  private autumnTreesCanopyInstanced: THREE.InstancedMesh;
  private bouldersInstanced: THREE.InstancedMesh;

  private highwayGantries: Array<{
    group: THREE.Group;
    spacingS: number;
    warningBeacons: THREE.Mesh[];
  }> = [];
  private overpassBridges: Array<{ group: THREE.Group; spacingS: number }> = [];

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

    // Particle Engine for collisions, metal sparks, and tire smoke
    this.particleEngine = new ParticleEngine(this.scene);

    // Continuous 3D W-Beam Corrugated Guardrails (Left & Right)
    const guardrailGeo = new THREE.BoxGeometry(0.12, 0.42, 4.2);
    const guardrailMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.35,
      metalness: 0.85,
    });
    this.leftGuardrailsInstanced = new THREE.InstancedMesh(
      guardrailGeo,
      guardrailMat,
      45,
    );
    this.rightGuardrailsInstanced = new THREE.InstancedMesh(
      guardrailGeo,
      guardrailMat,
      45,
    );
    this.leftGuardrailsInstanced.frustumCulled = false;
    this.rightGuardrailsInstanced.frustumCulled = false;
    this.scene.add(
      this.leftGuardrailsInstanced,
      this.rightGuardrailsInstanced,
    );

    // Highway Street Light Poles / Lampposts (curved steel masts along shoulder)
    const poleMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.4,
      metalness: 0.75,
    });
    const lamppostGeo = new THREE.CylinderGeometry(0.09, 0.13, 6.4, 8);
    this.lamppostsInstanced = new THREE.InstancedMesh(
      lamppostGeo,
      poleMat,
      30,
    );
    this.lamppostsInstanced.frustumCulled = false;
    this.scene.add(this.lamppostsInstanced);

    // Golden Autumn Birch Trees (rich roadside botanical variety)
    const autumnTreeCount = 45;
    const birchTrunkGeo = new THREE.CylinderGeometry(0.18, 0.25, 2.2, 7);
    const birchTrunkMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      roughness: 0.85,
    });
    const autumnCanopyGeo = new THREE.DodecahedronGeometry(1.95, 1);
    const autumnCanopyMat = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
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

    // Roadside Granite Boulders / Embankment Rocks
    const boulderGeo = new THREE.DodecahedronGeometry(1.2, 0);
    const boulderMat = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.88,
      metalness: 0.12,
    });
    this.bouldersInstanced = new THREE.InstancedMesh(
      boulderGeo,
      boulderMat,
      35,
    );
    this.bouldersInstanced.frustumCulled = false;
    this.scene.add(this.bouldersInstanced);

    // Overhead Highway Sign Gantries (3 interactive portal truss bridges)
    const gantryConfigs = [
      { title: 'EXIT 14 · SAFETY CORRIDOR', sub: 'SPEED LIMIT 80 KM/H · RADAR' },
      { title: 'DISTRACTION STUDY ZONE', sub: 'STAY IN LANE · EYES ON ROAD' },
      { title: 'ROAD SAFETY LAB · EXHIBITION', sub: 'OBJECTIVE REACTION TESTING' },
    ];
    for (let i = 0; i < 3; i++) {
      const g = buildHighwayGantry(
        gantryConfigs[i].title,
        gantryConfigs[i].sub,
      );
      this.highwayGantries.push({
        group: g.group,
        spacingS: 120 + i * 160,
        warningBeacons: g.warningBeacons,
      });
      this.scene.add(g.group);
    }

    // Concrete Overpass Flyover Bridges (2 bridges overhead)
    for (let i = 0; i < 2; i++) {
      const bridge = buildOverpassBridge();
      this.overpassBridges.push({
        group: bridge,
        spacingS: 240 + i * 340,
      });
      this.scene.add(bridge);
    }

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
    collisionEvents?: StepCollisionEvent[],
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

    // 1. Update Instanced roadside reflector posts & 3D W-Beam Guardrails
    const postSpacing = 8.0;
    const firstPostIdx = Math.floor(baseS / postSpacing) - 2;
    for (let i = 0; i < 45; i++) {
      const s = (firstPostIdx + i) * postSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);

      // Left post & W-beam rail
      _pos.set(
        sample.centerX - ROAD_CONFIG.guardrailOffset * nx,
        sample.elevationY + 0.42,
        -s - ROAD_CONFIG.guardrailOffset * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.leftPostsInstanced.setMatrixAt(i, _mat4);
      this.leftGuardrailsInstanced.setMatrixAt(i, _mat4);

      // Right post & W-beam rail
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

    // 2. Update Highway Street Light Poles along right shoulder (every ~26m)
    const lampSpacing = 26.0;
    const firstLampIdx = Math.floor(baseS / lampSpacing) - 2;
    for (let i = 0; i < 30; i++) {
      const s = (firstLampIdx + i) * lampSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(1, 1, 1);
      _pos.set(
        sample.centerX + (ROAD_CONFIG.guardrailOffset + 1.2) * nx,
        sample.elevationY + 3.2,
        -s + (ROAD_CONFIG.guardrailOffset + 1.2) * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.lamppostsInstanced.setMatrixAt(i, _mat4);
    }
    this.lamppostsInstanced.instanceMatrix.needsUpdate = true;

    // 3. Update Instanced roadside pine trees
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
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = idx % 2 === 0 ? -1 : 1;
      const distOut = 9.8 + (Math.abs(idx * 17) % 14) * 1.1;
      const scaleMod = 0.85 + (Math.abs(idx * 31) % 35) / 100;

      const x = sample.centerX + side * distOut * nx;
      const z = -s + side * distOut * nz;

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
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

    // 4. Update Golden Autumn Birch Trees (staggered alongside pine trees)
    const autumnSpacing = 14.0;
    const firstAutumnIdx = Math.floor(baseS / autumnSpacing) - 2;
    for (let i = 0; i < 45; i++) {
      const idx = firstAutumnIdx + i;
      const s = idx * autumnSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = idx % 2 === 0 ? 1 : -1;
      const distOut = 13.8 + (Math.abs(idx * 23) % 12);
      const scaleMod = 0.9 + (Math.abs(idx * 19) % 30) / 100;

      const x = sample.centerX + side * distOut * nx;
      const z = -s + side * distOut * nz;

      _euler.set(0, -sample.headingRad, 0);
      _quat.setFromEuler(_euler);
      _scale.set(scaleMod, scaleMod, scaleMod);

      _pos.set(x, sample.elevationY + 1.1 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.autumnTreesTrunksInstanced.setMatrixAt(i, _mat4);

      _pos.set(x, sample.elevationY + 3.2 * scaleMod, z);
      _mat4.compose(_pos, _quat, _scale);
      this.autumnTreesCanopyInstanced.setMatrixAt(i, _mat4);
    }
    this.autumnTreesTrunksInstanced.instanceMatrix.needsUpdate = true;
    this.autumnTreesCanopyInstanced.instanceMatrix.needsUpdate = true;

    // 5. Update Roadside Granite Boulders
    const boulderSpacing = 18.0;
    const firstBoulderIdx = Math.floor(baseS / boulderSpacing) - 2;
    for (let i = 0; i < 35; i++) {
      const idx = firstBoulderIdx + i;
      const s = idx * boulderSpacing;
      const sample = getRoadSample(s);
      const nx = Math.cos(sample.headingRad);
      const nz = Math.sin(sample.headingRad);
      const side = idx % 2 === 0 ? -1 : 1;
      const distOut = 8.5 + (Math.abs(idx * 29) % 8);
      const scaleMod = 0.7 + (Math.abs(idx * 13) % 60) / 100;

      _euler.set(idx * 0.4, -sample.headingRad + idx * 0.7, 0);
      _quat.setFromEuler(_euler);
      _scale.set(scaleMod * 1.3, scaleMod * 0.85, scaleMod);
      _pos.set(
        sample.centerX + side * distOut * nx,
        sample.elevationY + 0.45 * scaleMod,
        -s + side * distOut * nz,
      );
      _mat4.compose(_pos, _quat, _scale);
      this.bouldersInstanced.setMatrixAt(i, _mat4);
    }
    this.bouldersInstanced.instanceMatrix.needsUpdate = true;

    // 6. Update Overhead Highway Gantries (cycle forward every 480m)
    for (let i = 0; i < this.highwayGantries.length; i++) {
      const g = this.highwayGantries[i];
      while (g.spacingS < baseS - 40) {
        g.spacingS += 480;
      }
      const sample = getRoadSample(g.spacingS);
      g.group.position.set(sample.centerX, sample.elevationY, -g.spacingS);
      g.group.rotation.y = -sample.headingRad;

      // Flash beacons if distracted
      const beaconFlash =
        (attentionState === 'DISTRACTED' ||
          attentionState === 'POSSIBLY_DISTRACTED') &&
        Math.sin(timeSec * 16) > 0;
      for (const b of g.warningBeacons) {
        (b.material as THREE.MeshStandardMaterial).emissiveIntensity =
          beaconFlash ? 3.5 : 0.8;
      }
    }

    // 7. Update Overhead Concrete Overpass Flyover Bridges (cycle forward every 680m)
    for (let i = 0; i < this.overpassBridges.length; i++) {
      const bridge = this.overpassBridges[i];
      while (bridge.spacingS < baseS - 60) {
        bridge.spacingS += 680;
      }
      const sample = getRoadSample(bridge.spacingS);
      bridge.group.position.set(
        sample.centerX,
        sample.elevationY,
        -bridge.spacingS,
      );
      bridge.group.rotation.y = -sample.headingRad; // aligned perpendicular to road
    }

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

    // Collision impact sparks & debris bursts
    if (collisionEvents && collisionEvents.length > 0) {
      for (const ev of collisionEvents) {
        if (ev.type === 'hazard' || ev.type === 'guardrail') {
          this.particleEngine.emitImpactSparks(
            carWorldX,
            carWorldY + 0.38,
            carWorldZ - 0.8,
            34,
            ev.type === 'guardrail',
          );
        }
      }
    }
    this.particleEngine.update(dt);

    this.renderer.render(this.scene, this.camera);
  }

  public dispose(): void {
    this.resizeObserver.disconnect();
    this.particleEngine.dispose();
    this.roadGeometry.dispose();
    this.roadTexture.dispose();
    this.dashScreenTexture.dispose();
    this.renderer.dispose();
  }
}
