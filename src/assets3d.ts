import * as THREE from 'three';
import type { MapPreset } from './config.ts';
import type { RoadHazard } from './road.ts';

export interface BuiltVehicleNode {
  group: THREE.Group;
  brakeLights: THREE.Mesh[];
  wheels: THREE.Object3D[];
  frontWheelPivots?: THREE.Object3D[];
  beaconLight?: THREE.Mesh;
  strobeLights?: THREE.Mesh[];
}

// Shared reusable materials & geometries for high performance and zero GC bloat
const sharedGeometries = {
  tire: (() => {
    const g = new THREE.CylinderGeometry(0.34, 0.34, 0.26, 18);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  rim: (() => {
    const g = new THREE.CylinderGeometry(0.22, 0.22, 0.27, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  brakeDisc: (() => {
    const g = new THREE.CylinderGeometry(0.17, 0.17, 0.24, 12);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  spokeH: new THREE.BoxGeometry(0.28, 0.04, 0.38),
  spokeV: new THREE.BoxGeometry(0.28, 0.38, 0.04),
  truckTire: (() => {
    const g = new THREE.CylinderGeometry(0.44, 0.44, 0.3, 16);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  truckRim: (() => {
    const g = new THREE.CylinderGeometry(0.25, 0.25, 0.31, 10);
    g.rotateZ(Math.PI / 2);
    return g;
  })(),
  exhaustTip: (() => {
    const g = new THREE.CylinderGeometry(0.048, 0.052, 0.14, 10);
    g.rotateX(Math.PI / 2);
    return g;
  })(),
};

const sharedMaterials = {
  tireRubber: new THREE.MeshStandardMaterial({
    color: 0x0b0f17,
    roughness: 0.88,
    metalness: 0.08,
  }),
  alloySilver: new THREE.MeshStandardMaterial({
    color: 0xcbd5e1,
    roughness: 0.22,
    metalness: 0.88,
  }),
  alloyDark: new THREE.MeshStandardMaterial({
    color: 0x334155,
    roughness: 0.28,
    metalness: 0.85,
  }),
  brakeRotor: new THREE.MeshStandardMaterial({
    color: 0x64748b,
    roughness: 0.35,
    metalness: 0.8,
  }),
  caliperRed: new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    roughness: 0.3,
    metalness: 0.4,
  }),
  carbonTrim: new THREE.MeshStandardMaterial({
    color: 0x111827,
    roughness: 0.45,
    metalness: 0.35,
  }),
  chrome: new THREE.MeshStandardMaterial({
    color: 0xf1f5f9,
    roughness: 0.12,
    metalness: 0.96,
  }),
  cabinGlass: new THREE.MeshStandardMaterial({
    color: 0x090f1d,
    roughness: 0.08,
    metalness: 0.92,
  }),
  headlightLed: new THREE.MeshStandardMaterial({
    color: 0xffffff,
    emissive: 0xe0f2fe,
    emissiveIntensity: 2.2,
    roughness: 0.1,
  }),
  amberMarker: new THREE.MeshStandardMaterial({
    color: 0xfbbf24,
    emissive: 0xf59e0b,
    emissiveIntensity: 1.6,
    roughness: 0.2,
  }),
  plateWhite: new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    roughness: 0.4,
    metalness: 0.1,
  }),
};

function createSportWheelAssembly(darkRim = false): THREE.Group {
  const wheelGroup = new THREE.Group();
  const tire = new THREE.Mesh(sharedGeometries.tire, sharedMaterials.tireRubber);
  const rim = new THREE.Mesh(
    sharedGeometries.rim,
    darkRim ? sharedMaterials.alloyDark : sharedMaterials.alloySilver,
  );
  const rotor = new THREE.Mesh(
    sharedGeometries.brakeDisc,
    sharedMaterials.brakeRotor,
  );
  const spoke1 = new THREE.Mesh(
    sharedGeometries.spokeH,
    darkRim ? sharedMaterials.alloyDark : sharedMaterials.alloySilver,
  );
  const spoke2 = new THREE.Mesh(
    sharedGeometries.spokeV,
    darkRim ? sharedMaterials.alloyDark : sharedMaterials.alloySilver,
  );
  wheelGroup.add(tire, rim, rotor, spoke1, spoke2);
  return wheelGroup;
}

/**
 * Builds the high-detail 12-part Player Hero GT Sports Coupe (visible in Chase Cam & Title Showcase).
 * Forward direction is -Z; Rear bumper & taillights face +Z toward the chase camera.
 */
export function buildPlayerHeroCar(): BuiltVehicleNode {
  const group = new THREE.Group();
  const brakeLights: THREE.Mesh[] = [];
  const wheels: THREE.Object3D[] = [];
  const frontWheelPivots: THREE.Object3D[] = [];

  const bodyPaintMat = new THREE.MeshPhysicalMaterial({
    color: 0x0284c7, // Performance Metallic Cyan-Blue
    roughness: 0.18,
    metalness: 0.78,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });

  // 1. Sculpted Widebody Lower Chassis & Side Fenders
  const lowerChassis = new THREE.Mesh(
    new THREE.BoxGeometry(1.9, 0.46, 4.32),
    bodyPaintMat,
  );
  lowerChassis.position.set(0, 0.44, 0);
  group.add(lowerChassis);

  // 2. Front Carbon Splitter & Side Aero Skirts
  const splitter = new THREE.Mesh(
    new THREE.BoxGeometry(1.94, 0.07, 0.48),
    sharedMaterials.carbonTrim,
  );
  splitter.position.set(0, 0.21, -1.98);
  group.add(splitter);

  const sideSkirtGeo = new THREE.BoxGeometry(1.94, 0.08, 2.5);
  const skirts = new THREE.Mesh(sideSkirtGeo, sharedMaterials.carbonTrim);
  skirts.position.set(0, 0.21, 0);
  group.add(skirts);

  // 3. Sculpted Hood & Front Fascia (Front is at -Z)
  const hoodSlope = new THREE.Mesh(
    new THREE.BoxGeometry(1.74, 0.16, 1.55),
    bodyPaintMat,
  );
  hoodSlope.position.set(0, 0.68, -1.25);
  hoodSlope.rotation.x = 0.08;
  group.add(hoodSlope);

  // Front grille & intake mesh (-Z)
  const frontGrille = new THREE.Mesh(
    new THREE.BoxGeometry(1.36, 0.24, 0.08),
    sharedMaterials.carbonTrim,
  );
  frontGrille.position.set(0, 0.4, -2.14);
  group.add(frontGrille);

  // Front LED Headlights (-Z)
  const hlGeo = new THREE.BoxGeometry(0.42, 0.12, 0.1);
  const hlLeft = new THREE.Mesh(hlGeo, sharedMaterials.headlightLed);
  hlLeft.position.set(-0.68, 0.56, -2.13);
  const hlRight = new THREE.Mesh(hlGeo, sharedMaterials.headlightLed);
  hlRight.position.set(0.68, 0.56, -2.13);
  group.add(hlLeft, hlRight);

  // 4. Aerodynamic Fastback Cabin Greenhouse
  const cabinGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.54, 0.54, 2.05),
    sharedMaterials.cabinGlass,
  );
  cabinGlass.position.set(0, 0.96, 0.12);
  group.add(cabinGlass);

  // Fastback rear deck slope (+Z)
  const fastbackDeck = new THREE.Mesh(
    new THREE.BoxGeometry(1.52, 0.32, 1.15),
    bodyPaintMat,
  );
  fastbackDeck.position.set(0, 0.88, 1.25);
  fastbackDeck.rotation.x = -0.24;
  group.add(fastbackDeck);

  // Carbon Roof Panel
  const roofPanel = new THREE.Mesh(
    new THREE.BoxGeometry(1.44, 0.05, 1.45),
    sharedMaterials.carbonTrim,
  );
  roofPanel.position.set(0, 1.24, 0.04);
  group.add(roofPanel);

  // 5. Aerodynamic Wing Mirrors
  const mirrorGeo = new THREE.BoxGeometry(0.2, 0.09, 0.14);
  const mirL = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  mirL.position.set(-0.98, 0.88, -0.58);
  const mirR = new THREE.Mesh(mirrorGeo, bodyPaintMat);
  mirR.position.set(0.98, 0.88, -0.58);
  group.add(mirL, mirR);

  // 6. Active GT Swan-Neck Rear Wing (+Z)
  const pylonGeo = new THREE.BoxGeometry(0.05, 0.26, 0.22);
  const pylonL = new THREE.Mesh(pylonGeo, sharedMaterials.carbonTrim);
  pylonL.position.set(-0.52, 0.86, 1.88);
  pylonL.rotation.x = -0.25;
  const pylonR = new THREE.Mesh(pylonGeo, sharedMaterials.carbonTrim);
  pylonR.position.set(0.52, 0.86, 1.88);
  pylonR.rotation.x = -0.25;
  const wingBlade = new THREE.Mesh(
    new THREE.BoxGeometry(1.76, 0.045, 0.3),
    sharedMaterials.carbonTrim,
  );
  wingBlade.position.set(0, 0.99, 1.94);
  wingBlade.rotation.x = 0.09;
  const wingEndplateGeo = new THREE.BoxGeometry(0.03, 0.16, 0.34);
  const endL = new THREE.Mesh(wingEndplateGeo, bodyPaintMat);
  endL.position.set(-0.88, 0.98, 1.94);
  const endR = new THREE.Mesh(wingEndplateGeo, bodyPaintMat);
  endR.position.set(0.88, 0.98, 1.94);
  group.add(pylonL, pylonR, wingBlade, endL, endR);

  // 7. Rear Diffuser, Quad Chrome Exhausts & Full-Width LED Brake Light Bar (+Z)
  const rearDiffuser = new THREE.Mesh(
    new THREE.BoxGeometry(1.78, 0.22, 0.14),
    sharedMaterials.carbonTrim,
  );
  rearDiffuser.position.set(0, 0.28, 2.13);
  group.add(rearDiffuser);

  const exhaustOffsets = [-0.62, -0.48, 0.48, 0.62];
  for (const ex of exhaustOffsets) {
    const tip = new THREE.Mesh(
      sharedGeometries.exhaustTip,
      sharedMaterials.chrome,
    );
    tip.position.set(ex, 0.26, 2.18);
    group.add(tip);
  }

  // Rear license plate
  const plate = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.12, 0.02),
    sharedMaterials.plateWhite,
  );
  plate.position.set(0, 0.44, 2.17);
  group.add(plate);

  // Full-width LED taillight bar & dual bright brake clusters
  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 1.4,
    roughness: 0.15,
  });
  const centerLightBar = new THREE.Mesh(
    new THREE.BoxGeometry(1.68, 0.055, 0.06),
    brakeMat,
  );
  centerLightBar.position.set(0, 0.66, 2.15);

  const leftBrakeCluster = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.14, 0.08),
    brakeMat,
  );
  leftBrakeCluster.position.set(-0.64, 0.64, 2.15);

  const rightBrakeCluster = new THREE.Mesh(
    new THREE.BoxGeometry(0.48, 0.14, 0.08),
    brakeMat,
  );
  rightBrakeCluster.position.set(0.64, 0.64, 2.15);

  group.add(centerLightBar, leftBrakeCluster, rightBrakeCluster);
  brakeLights.push(centerLightBar, leftBrakeCluster, rightBrakeCluster);

  // 8. Four Steerable & Rotating Sport Wheel Assemblies
  const wheelCoords: Array<[number, number, number, boolean]> = [
    [-0.91, 0.34, -1.34, true], // Front Left
    [0.91, 0.34, -1.34, true], // Front Right
    [-0.91, 0.34, 1.32, false], // Rear Left
    [0.91, 0.34, 1.32, false], // Rear Right
  ];

  for (const [wx, wy, wz, isFront] of wheelCoords) {
    const pivot = new THREE.Group();
    pivot.position.set(wx, wy, wz);
    const wheelMesh = createSportWheelAssembly(false);
    pivot.add(wheelMesh);
    group.add(pivot);
    wheels.push(wheelMesh);
    if (isFront) {
      frontWheelPivots.push(pivot);
    }
  }

  // 9. Soft Ground Contact Shadow Plane
  const shadowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(2.25, 4.75),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0, 0.02, 0);
  group.add(shadowDisc);

  return { group, brakeLights, wheels, frontWheelPivots };
}

let cachedChevronTex: THREE.CanvasTexture | null = null;
function getChevronSafetyTexture(): THREE.CanvasTexture {
  if (cachedChevronTex) return cachedChevronTex;
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
    cctx.lineTo(x + 28, 128);
    cctx.lineTo(x + 56, 0);
    cctx.lineTo(x + 28, 0);
    cctx.fill();
  }
  cachedChevronTex = new THREE.CanvasTexture(chevronCanvas);
  cachedChevronTex.colorSpace = THREE.SRGBColorSpace;
  return cachedChevronTex;
}

/**
 * Builds composite 3D AI Traffic Vehicles & Construction Work Zones.
 * All traffic vehicles face -Z (forward direction of travel) so their rear bumper,
 * exhausts, and red brake lights (+Z) face the approaching player.
 */
export function buildCompositeHazardGroup(
  hazard: RoadHazard,
  colorblindSafe = false,
): BuiltVehicleNode {
  const group = new THREE.Group();
  const brakeLights: THREE.Mesh[] = [];
  const wheels: THREE.Object3D[] = [];
  const strobeLights: THREE.Mesh[] = [];

  if (hazard.type === 'work_zone') {
    const orangeMat = new THREE.MeshStandardMaterial({
      color: 0xf97316,
      roughness: 0.42,
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
      metalness: 0.78,
    });

    // 1. Trailer chassis & wheels
    const trailerBase = new THREE.Mesh(
      new THREE.BoxGeometry(2.1, 0.36, 3.6),
      steelMat,
    );
    trailerBase.position.set(0, 0.42, -0.2);
    group.add(trailerBase);

    const wL = new THREE.Mesh(
      sharedGeometries.tire,
      sharedMaterials.tireRubber,
    );
    wL.position.set(-1.1, 0.34, -0.2);
    const wR = new THREE.Mesh(
      sharedGeometries.tire,
      sharedMaterials.tireRubber,
    );
    wR.position.set(1.1, 0.34, -0.2);
    group.add(wL, wR);

    // 2. Crash Attenuator Cushion & Chevron Barricade Boards facing approaching player (+Z)
    const cushion = new THREE.Mesh(
      new THREE.BoxGeometry(2.04, 0.72, 0.9),
      orangeMat,
    );
    cushion.position.set(0, 0.68, 1.35);
    group.add(cushion);

    const chevronPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(2.0, 0.68),
      new THREE.MeshStandardMaterial({
        map: getChevronSafetyTexture(),
        roughness: 0.35,
      }),
    );
    chevronPlane.position.set(0, 0.68, 1.82);
    group.add(chevronPlane);

    // 3. Illuminated LED Directional Arrow Board facing approaching player (+Z)
    const boardFrame = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 1.28, 0.18),
      steelMat,
    );
    boardFrame.position.set(0, 2.15, 0.2);
    group.add(boardFrame);

    const beaconMat = new THREE.MeshStandardMaterial({
      color: 0xfbbf24,
      emissive: 0xf59e0b,
      emissiveIntensity: 2.4,
      roughness: 0.2,
    });

    for (let col = -3; col <= 3; col++) {
      const led = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, 0.06, 8),
        beaconMat,
      );
      led.rotation.x = Math.PI / 2;
      led.position.set(col * 0.24, 2.15, 0.31);
      group.add(led);
    }

    const beaconTopL = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.24, 10),
      beaconMat,
    );
    beaconTopL.position.set(-0.8, 2.9, 0.2);
    const beaconTopR = new THREE.Mesh(
      new THREE.CylinderGeometry(0.14, 0.14, 0.24, 10),
      beaconMat.clone(),
    );
    beaconTopR.position.set(0.8, 2.9, 0.2);
    group.add(beaconTopL, beaconTopR);

    // 4. Approach safety drums strictly inside the work zone bounding box (+Z approach side)
    const barrelGeo = new THREE.CylinderGeometry(0.28, 0.3, 0.92, 12);
    const stripeGeo = new THREE.CylinderGeometry(0.29, 0.305, 0.26, 12);
    for (const bx of [-0.72, 0.72]) {
      const barrel = new THREE.Mesh(barrelGeo, orangeMat);
      barrel.position.set(bx, 0.46, 2.25);
      const stripe = new THREE.Mesh(stripeGeo, whiteStripeMat);
      stripe.position.set(0, 0.12, 0);
      barrel.add(stripe);
      group.add(barrel);
    }

    return { group, brakeLights, wheels, beaconLight: beaconTopL };
  }

  const isTruck = hazard.type === 'truck';
  const isSuv = hazard.type === 'suv';
  const isCoupe = hazard.type === 'coupe';
  const isPatrol = hazard.type === 'patrol';

  const bodyColor =
    hazard.type === 'braking_car'
      ? colorblindSafe
        ? 0xf59e0b
        : 0xe11d48
      : isPatrol
      ? 0x0f172a
      : hazard.colorHex;

  const hullMat = new THREE.MeshPhysicalMaterial({
    color: bodyColor,
    roughness: 0.22,
    metalness: 0.68,
    clearcoat: 0.85,
    clearcoatRoughness: 0.14,
  });

  const brakeMat = new THREE.MeshStandardMaterial({
    color: 0xef4444,
    emissive: 0xef4444,
    emissiveIntensity: 1.1,
    roughness: 0.2,
  });

  if (isTruck) {
    // -------------------------------------------------------------------------
    // Heavy Commercial Freight Box Truck (Front Cab at -Z, Rear Cargo Door at +Z)
    // -------------------------------------------------------------------------
    const cabMat = new THREE.MeshPhysicalMaterial({
      color: hazard.colorHex,
      roughness: 0.28,
      metalness: 0.6,
      clearcoat: 0.7,
    });

    // 1. Cab-Over-Engine Tractor (-Z front)
    const cab = new THREE.Mesh(
      new THREE.BoxGeometry(2.22, 2.05, 1.85),
      cabMat,
    );
    cab.position.set(0, 1.38, -2.65);
    group.add(cab);

    // Aerodynamic Roof Wind Fairing on Cab
    const fairing = new THREE.Mesh(
      new THREE.BoxGeometry(2.16, 0.65, 1.35),
      cabMat,
    );
    fairing.position.set(0, 2.62, -2.55);
    fairing.rotation.x = 0.28;
    group.add(fairing);

    // Cab Front Windshield & Grille (-Z)
    const cabWindshield = new THREE.Mesh(
      new THREE.BoxGeometry(2.08, 0.82, 0.12),
      sharedMaterials.cabinGlass,
    );
    cabWindshield.position.set(0, 1.72, -3.56);
    cabWindshield.rotation.x = 0.1;
    group.add(cabWindshield);

    const frontBumper = new THREE.Mesh(
      new THREE.BoxGeometry(2.28, 0.44, 0.35),
      sharedMaterials.chrome,
    );
    frontBumper.position.set(0, 0.45, -3.55);
    group.add(frontBumper);

    const hL = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.1),
      sharedMaterials.headlightLed,
    );
    hL.position.set(-0.86, 0.54, -3.72);
    const hR = new THREE.Mesh(
      new THREE.BoxGeometry(0.36, 0.2, 0.1),
      sharedMaterials.headlightLed,
    );
    hR.position.set(0.86, 0.54, -3.72);
    group.add(hL, hR);

    // Vertical Chrome Exhaust Stacks behind cab
    const stackGeo = new THREE.CylinderGeometry(0.065, 0.065, 2.6, 10);
    const stackL = new THREE.Mesh(stackGeo, sharedMaterials.chrome);
    stackL.position.set(-1.12, 1.85, -1.62);
    const stackR = new THREE.Mesh(stackGeo, sharedMaterials.chrome);
    stackR.position.set(1.12, 1.85, -1.62);
    group.add(stackL, stackR);

    // 2. High-Capacity Corrugated Cargo Box (+Z rear)
    const cargoBox = new THREE.Mesh(
      new THREE.BoxGeometry(2.36, 2.62, 5.25),
      new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        roughness: 0.42,
        metalness: 0.22,
      }),
    );
    cargoBox.position.set(0, 1.76, 1.02);
    group.add(cargoBox);

    // Side Reflective Amber Safety Strips
    const sideStripGeo = new THREE.BoxGeometry(2.38, 0.08, 5.15);
    const sideStrip = new THREE.Mesh(
      sideStripGeo,
      sharedMaterials.amberMarker,
    );
    sideStrip.position.set(0, 0.52, 1.02);
    group.add(sideStrip);

    // Rear Chevron Hazard Panel & Underride Guard facing player (+Z)
    const chevronMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(2.3, 0.58),
      new THREE.MeshStandardMaterial({
        map: getChevronSafetyTexture(),
        roughness: 0.38,
      }),
    );
    chevronMesh.position.set(0, 0.62, 3.66);
    group.add(chevronMesh);

    const underrideBar = new THREE.Mesh(
      new THREE.BoxGeometry(2.24, 0.16, 0.16),
      sharedMaterials.carbonTrim,
    );
    underrideBar.position.set(0, 0.34, 3.62);
    group.add(underrideBar);

    // Rear top marker lights (+Z)
    for (const mx of [-0.95, 0, 0.95]) {
      const topMarker = new THREE.Mesh(
        new THREE.BoxGeometry(0.18, 0.08, 0.06),
        brakeMat,
      );
      topMarker.position.set(mx, 2.98, 3.65);
      group.add(topMarker);
    }

    // Side Chrome Fuel Tanks
    const tankGeo = new THREE.CylinderGeometry(0.28, 0.28, 1.35, 12);
    tankGeo.rotateX(Math.PI / 2);
    const tankL = new THREE.Mesh(tankGeo, sharedMaterials.chrome);
    tankL.position.set(-1.12, 0.46, -0.95);
    const tankR = new THREE.Mesh(tankGeo, sharedMaterials.chrome);
    tankR.position.set(1.12, 0.46, -0.95);
    group.add(tankL, tankR);

    // 6 Heavy Truck Wheels
    const wheelSpecs = [
      [-1.1, 0.44, -2.55],
      [1.1, 0.44, -2.55],
      [-1.12, 0.44, 1.75],
      [1.12, 0.44, 1.75],
      [-1.12, 0.44, 2.75],
      [1.12, 0.44, 2.75],
    ];
    for (const [wx, wy, wz] of wheelSpecs) {
      const wGroup = new THREE.Group();
      wGroup.position.set(wx, wy, wz);
      const tire = new THREE.Mesh(
        sharedGeometries.truckTire,
        sharedMaterials.tireRubber,
      );
      const rim = new THREE.Mesh(
        sharedGeometries.truckRim,
        sharedMaterials.alloySilver,
      );
      wGroup.add(tire, rim);
      group.add(wGroup);
      wheels.push(wGroup);
    }

    // Truck Rear Brake Lights (+Z)
    const leftBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.18, 0.08),
      brakeMat.clone(),
    );
    leftBrake.position.set(-0.78, 0.42, 3.66);
    const rightBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.18, 0.08),
      brakeMat.clone(),
    );
    rightBrake.position.set(0.78, 0.42, 3.66);
    group.add(leftBrake, rightBrake);
    brakeLights.push(leftBrake, rightBrake);
  } else if (isSuv) {
    // -------------------------------------------------------------------------
    // Luxury Performance SUV / Crossover (Front at -Z, Rear Tailgate at +Z)
    // -------------------------------------------------------------------------
    const lowerBody = new THREE.Mesh(
      new THREE.BoxGeometry(1.96, 0.62, 4.62),
      hullMat,
    );
    lowerBody.position.set(0, 0.56, 0);
    group.add(lowerBody);

    // Lower cladding & skid plates
    const cladding = new THREE.Mesh(
      new THREE.BoxGeometry(1.99, 0.16, 4.64),
      sharedMaterials.carbonTrim,
    );
    cladding.position.set(0, 0.28, 0);
    group.add(cladding);

    // SUV Long Greenhouse Cabin
    const suvCabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.68, 0.64, 2.85),
      sharedMaterials.cabinGlass,
    );
    suvCabin.position.set(0, 1.14, 0.35);
    group.add(suvCabin);

    const suvRoof = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 0.06, 2.65),
      hullMat,
    );
    suvRoof.position.set(0, 1.47, 0.35);
    group.add(suvRoof);

    // Brushed Aluminum Roof Rails
    const railGeo = new THREE.BoxGeometry(0.05, 0.06, 2.3);
    const railL = new THREE.Mesh(railGeo, sharedMaterials.alloySilver);
    railL.position.set(-0.68, 1.52, 0.35);
    const railR = new THREE.Mesh(railGeo, sharedMaterials.alloySilver);
    railR.position.set(0.68, 1.52, 0.35);
    group.add(railL, railR);

    // Front Grille & Headlights (-Z)
    const grille = new THREE.Mesh(
      new THREE.BoxGeometry(1.3, 0.32, 0.08),
      sharedMaterials.carbonTrim,
    );
    grille.position.set(0, 0.58, -2.3);
    group.add(grille);

    const hL = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.16, 0.08),
      sharedMaterials.headlightLed,
    );
    hL.position.set(-0.72, 0.68, -2.3);
    const hR = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.16, 0.08),
      sharedMaterials.headlightLed,
    );
    hR.position.set(0.72, 0.68, -2.3);
    group.add(hL, hR);

    // Rear Roof Spoiler & Tailgate Brake Lights (+Z)
    const spoiler = new THREE.Mesh(
      new THREE.BoxGeometry(1.62, 0.07, 0.26),
      hullMat,
    );
    spoiler.position.set(0, 1.45, 1.78);
    group.add(spoiler);

    const leftBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.2, 0.08),
      brakeMat.clone(),
    );
    leftBrake.position.set(-0.7, 0.78, 2.31);
    const rightBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.48, 0.2, 0.08),
      brakeMat.clone(),
    );
    rightBrake.position.set(0.7, 0.78, 2.31);
    const centerBrakeStrip = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 0.05, 0.07),
      brakeMat.clone(),
    );
    centerBrakeStrip.position.set(0, 0.82, 2.31);
    group.add(leftBrake, rightBrake, centerBrakeStrip);
    brakeLights.push(leftBrake, rightBrake, centerBrakeStrip);

    // SUV Wheels
    const wheelOffsets = [
      [-0.93, 0.34, -1.45],
      [0.93, 0.34, -1.45],
      [-0.93, 0.34, 1.45],
      [0.93, 0.34, 1.45],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const w = createSportWheelAssembly(false);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    }
  } else {
    // -------------------------------------------------------------------------
    // Executive Sport Sedan / GT Coupe / Highway Patrol (Front at -Z, Rear at +Z)
    // -------------------------------------------------------------------------
    const lowerBody = new THREE.Mesh(
      new THREE.BoxGeometry(isCoupe ? 1.9 : 1.85, 0.5, 4.35),
      hullMat,
    );
    lowerBody.position.set(0, 0.48, 0);
    group.add(lowerBody);

    // White doors for Highway Patrol livery
    if (isPatrol) {
      const patrolDoorPanel = new THREE.Mesh(
        new THREE.BoxGeometry(1.87, 0.44, 1.95),
        sharedMaterials.plateWhite,
      );
      patrolDoorPanel.position.set(0, 0.49, 0.05);
      group.add(patrolDoorPanel);
    }

    // Hood slope (-Z front)
    const hoodCrease = new THREE.Mesh(
      new THREE.BoxGeometry(1.68, 0.14, 1.45),
      hullMat,
    );
    hoodCrease.position.set(0, 0.7, -1.25);
    hoodCrease.rotation.x = 0.07;
    group.add(hoodCrease);

    // Cabin Greenhouse
    const cabin = new THREE.Mesh(
      new THREE.BoxGeometry(1.52, 0.56, 2.15),
      sharedMaterials.cabinGlass,
    );
    cabin.position.set(0, 1.02, 0.15);
    group.add(cabin);

    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(1.42, 0.05, 1.6),
      isPatrol ? sharedMaterials.plateWhite : hullMat,
    );
    roof.position.set(0, 1.32, 0.15);
    group.add(roof);

    // Patrol Roof Emergency Lightbar
    if (isPatrol) {
      const barBase = new THREE.Mesh(
        new THREE.BoxGeometry(1.18, 0.06, 0.22),
        sharedMaterials.carbonTrim,
      );
      barBase.position.set(0, 1.38, 0.1);
      const redStrobe = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.08, 0.18),
        new THREE.MeshStandardMaterial({
          color: 0xef4444,
          emissive: 0xef4444,
          emissiveIntensity: 2.5,
        }),
      );
      redStrobe.position.set(-0.28, 1.42, 0.1);
      const blueStrobe = new THREE.Mesh(
        new THREE.BoxGeometry(0.52, 0.08, 0.18),
        new THREE.MeshStandardMaterial({
          color: 0x3b82f6,
          emissive: 0x38bdf8,
          emissiveIntensity: 2.5,
        }),
      );
      blueStrobe.position.set(0.28, 1.42, 0.1);
      group.add(barBase, redStrobe, blueStrobe);
      strobeLights.push(redStrobe, blueStrobe);
    }

    // Coupe Rear Spoiler (+Z)
    if (isCoupe || hazard.type === 'braking_car') {
      const wing = new THREE.Mesh(
        new THREE.BoxGeometry(1.66, 0.05, 0.24),
        sharedMaterials.carbonTrim,
      );
      wing.position.set(0, 0.88, 2.02);
      group.add(wing);
    }

    // Front Radiator Grille & Headlights (-Z)
    const grille = new THREE.Mesh(
      new THREE.BoxGeometry(1.24, 0.22, 0.06),
      sharedMaterials.carbonTrim,
    );
    grille.position.set(0, 0.44, -2.16);
    group.add(grille);

    const hL = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.13, 0.08),
      sharedMaterials.headlightLed,
    );
    hL.position.set(-0.68, 0.56, -2.16);
    const hR = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.13, 0.08),
      sharedMaterials.headlightLed,
    );
    hR.position.set(0.68, 0.56, -2.16);
    group.add(hL, hR);

    // Side Exterior Mirrors
    const mirrorGeo = new THREE.BoxGeometry(0.18, 0.09, 0.12);
    const mirL = new THREE.Mesh(mirrorGeo, sharedMaterials.carbonTrim);
    mirL.position.set(-0.96, 0.94, -0.55);
    const mirR = new THREE.Mesh(mirrorGeo, sharedMaterials.carbonTrim);
    mirR.position.set(0.96, 0.94, -0.55);
    group.add(mirL, mirR);

    // Rear Bumper Diffuser, License Plate & Dual Chrome Exhausts (+Z)
    const diffuser = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.18, 0.1),
      sharedMaterials.carbonTrim,
    );
    diffuser.position.set(0, 0.28, 2.16);
    group.add(diffuser);

    const plate = new THREE.Mesh(
      new THREE.BoxGeometry(0.38, 0.11, 0.02),
      sharedMaterials.plateWhite,
    );
    plate.position.set(0, 0.46, 2.18);
    group.add(plate);

    const tipL = new THREE.Mesh(
      sharedGeometries.exhaustTip,
      sharedMaterials.chrome,
    );
    tipL.position.set(-0.54, 0.26, 2.2);
    const tipR = new THREE.Mesh(
      sharedGeometries.exhaustTip,
      sharedMaterials.chrome,
    );
    tipR.position.set(0.54, 0.26, 2.2);
    group.add(tipL, tipR);

    // Wide Red LED Taillights / Brake Lights facing player (+Z)
    const leftBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.15, 0.08),
      brakeMat.clone(),
    );
    leftBrake.position.set(-0.66, 0.64, 2.16);
    const rightBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.46, 0.15, 0.08),
      brakeMat.clone(),
    );
    rightBrake.position.set(0.66, 0.64, 2.16);
    const highMountBrake = new THREE.Mesh(
      new THREE.BoxGeometry(0.68, 0.045, 0.06),
      brakeMat.clone(),
    );
    highMountBrake.position.set(0, 1.24, 1.22);
    group.add(leftBrake, rightBrake, highMountBrake);
    brakeLights.push(leftBrake, rightBrake, highMountBrake);

    // 4 Sport Alloy Wheels
    const wheelOffsets = [
      [-0.89, 0.34, -1.32],
      [0.89, 0.34, -1.32],
      [-0.89, 0.34, 1.32],
      [0.89, 0.34, 1.32],
    ];
    for (const [wx, wy, wz] of wheelOffsets) {
      const w = createSportWheelAssembly(isCoupe || isPatrol);
      w.position.set(wx, wy, wz);
      group.add(w);
      wheels.push(w);
    }
  }

  // Soft Ambient Contact Shadow Under Vehicle
  const shadowDisc = new THREE.Mesh(
    new THREE.PlaneGeometry(isTruck ? 2.65 : 2.15, isTruck ? 7.9 : 4.75),
    new THREE.MeshBasicMaterial({
      color: 0x020617,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
    }),
  );
  shadowDisc.rotation.x = -Math.PI / 2;
  shadowDisc.position.set(0, 0.02, 0);
  group.add(shadowDisc);

  return { group, brakeLights, wheels, strobeLights };
}

/**
 * Generates procedural skyscraper window facade texture for the Metro Bay Urban Expressway map.
 */
export function createUrbanSkyscraperTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 512;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#0b1120';
  ctx.fillRect(0, 0, 256, 512);

  // Structural mullion grid & lit office windows
  for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 8; col++) {
      const hash = ((row * 37 + col * 19) * 73) % 100;
      if (hash < 45) {
        ctx.fillStyle =
          hash < 12 ? '#fde68a' : hash < 28 ? '#bae6fd' : '#38bdf8';
      } else {
        ctx.fillStyle = '#111827';
      }
      ctx.fillRect(col * 32 + 5, row * 16 + 3, 22, 10);
    }
  }

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/**
 * Generates high-detail road asphalt texture tailored to the active map preset.
 */
export function createRoadAsphaltTexture(
  maxAnisotropy: number,
  mapPreset: MapPreset = 'alpine',
): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  // 1. Base asphalt color tuned slightly by environment
  ctx.fillStyle =
    mapPreset === 'desert'
      ? '#1d1c24'
      : mapPreset === 'urban'
      ? '#141923'
      : '#171d27';
  ctx.fillRect(0, 0, 1024, 1024);

  // 2. Micro aggregate stone grain
  for (let i = 0; i < 20000; i++) {
    const x = (i * 79) % 1024;
    const y = (i * 157) % 1024;
    const v = 24 + ((i * 31) % 24);
    ctx.fillStyle = `rgb(${v}, ${v + 4}, ${v + 8})`;
    ctx.fillRect(x, y, 2, 2);
  }

  // 3. Paved shoulders (left & right)
  ctx.fillStyle = mapPreset === 'desert' ? '#362620' : '#242f3e';
  ctx.fillRect(0, 0, 112, 1024);
  ctx.fillRect(912, 0, 112, 1024);

  // 4. Corrugated warning rumble strips
  for (let y = 0; y < 1024; y += 48) {
    ctx.fillStyle = y % 96 === 0 ? '#f59e0b' : '#1e293b';
    ctx.fillRect(80, y, 32, 28);
    ctx.fillRect(912, y, 32, 28);
  }

  // 5. Solid outer reflective road edge lines
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(116, 0, 16, 1024);
  ctx.fillRect(892, 0, 16, 1024);

  // 6. Center highway divider + reflective cat's-eye road studs
  for (let y = 0; y < 1024; y += 96) {
    ctx.fillStyle = mapPreset === 'urban' ? '#f8fafc' : '#fbbf24';
    ctx.fillRect(504, y + 10, 16, 56);
    ctx.fillStyle = '#94a3b8';
    ctx.fillRect(507, y + 74, 10, 10);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(509, y + 76, 6, 6);
  }

  // 7. Subtle worn rubber tire tracks in both lanes
  ctx.fillStyle = 'rgba(8, 12, 20, 0.42)';
  ctx.fillRect(230, 0, 44, 1024);
  ctx.fillRect(350, 0, 44, 1024);
  ctx.fillRect(630, 0, 44, 1024);
  ctx.fillRect(750, 0, 44, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}
