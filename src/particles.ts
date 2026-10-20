import * as THREE from 'three';

/**
 * Lightweight, high-performance GPU particle pool for collision sparks,
 * guardrail metal scrape flashes, and tire skid smoke puffs.
 */
export class ParticleEngine {
  private particleCount = 180;
  private geometry: THREE.BufferGeometry;
  private material: THREE.PointsMaterial;
  private points: THREE.Points;

  private positions: Float32Array;
  private colors: Float32Array;
  private velocities: Float32Array;
  private lifetimes: Float32Array;
  private maxLifetimes: Float32Array;
  private activeCount = 0;

  constructor(scene: THREE.Scene) {
    this.positions = new Float32Array(this.particleCount * 3);
    this.colors = new Float32Array(this.particleCount * 3);
    this.velocities = new Float32Array(this.particleCount * 3);
    this.lifetimes = new Float32Array(this.particleCount);
    this.maxLifetimes = new Float32Array(this.particleCount);

    // Initialize all off-screen
    for (let i = 0; i < this.particleCount; i++) {
      this.positions[i * 3 + 1] = -500;
      this.lifetimes[i] = 0;
    }

    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute(
      'position',
      new THREE.BufferAttribute(this.positions, 3),
    );
    this.geometry.setAttribute(
      'color',
      new THREE.BufferAttribute(this.colors, 3),
    );

    this.material = new THREE.PointsMaterial({
      size: 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  /**
   * Spawns an energetic burst of sparks and debris at impact position.
   */
  public emitImpactSparks(
    worldX: number,
    worldY: number,
    worldZ: number,
    count = 28,
    isGuardrail = false,
  ): void {
    let spawned = 0;
    for (let i = 0; i < this.particleCount && spawned < count; i++) {
      if (this.lifetimes[i] <= 0) {
        this.positions[i * 3] = worldX + (Math.random() - 0.5) * 0.4;
        this.positions[i * 3 + 1] = worldY + Math.random() * 0.5;
        this.positions[i * 3 + 2] = worldZ + (Math.random() - 0.5) * 0.4;

        // Eject forward and outward with high velocity
        const angle = Math.random() * Math.PI * 2;
        const speed = 4.5 + Math.random() * 8.5;
        this.velocities[i * 3] = Math.cos(angle) * speed;
        this.velocities[i * 3 + 1] = 2.0 + Math.random() * 6.5;
        this.velocities[i * 3 + 2] = -Math.sin(angle) * speed;

        const maxLife = 0.35 + Math.random() * 0.45;
        this.lifetimes[i] = maxLife;
        this.maxLifetimes[i] = maxLife;

        // Bright golden-amber/orange spark or fiery red-orange
        if (isGuardrail) {
          this.colors[i * 3] = 1.0;
          this.colors[i * 3 + 1] = 0.85;
          this.colors[i * 3 + 2] = 0.25;
        } else {
          this.colors[i * 3] = 1.0;
          this.colors[i * 3 + 1] = 0.45 + Math.random() * 0.4;
          this.colors[i * 3 + 2] = 0.1;
        }

        spawned++;
      }
    }
  }

  /**
   * Advances particle physics with gravity and drag.
   */
  public update(dt: number): void {
    const posAttr = this.geometry.getAttribute('position') as THREE.BufferAttribute;
    const colAttr = this.geometry.getAttribute('color') as THREE.BufferAttribute;
    let hasLiveParticles = false;

    for (let i = 0; i < this.particleCount; i++) {
      if (this.lifetimes[i] > 0) {
        hasLiveParticles = true;
        this.lifetimes[i] -= dt;

        if (this.lifetimes[i] <= 0) {
          this.positions[i * 3 + 1] = -500;
          continue;
        }

        // Apply velocity and gravity
        this.positions[i * 3] += this.velocities[i * 3] * dt;
        this.positions[i * 3 + 1] += this.velocities[i * 3 + 1] * dt;
        this.positions[i * 3 + 2] += this.velocities[i * 3 + 2] * dt;

        this.velocities[i * 3 + 1] -= 9.81 * dt; // gravity
        this.velocities[i * 3] *= 0.95; // air drag
        this.velocities[i * 3 + 2] *= 0.95;

        // Fade brightness as lifetime expires
        const lifeRatio = this.lifetimes[i] / this.maxLifetimes[i];
        this.colors[i * 3 + 1] *= Math.max(0.2, lifeRatio);
      }
    }

    if (hasLiveParticles) {
      posAttr.needsUpdate = true;
      colAttr.needsUpdate = true;
    }
  }

  public dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
