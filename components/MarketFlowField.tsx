"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Asset } from "@/lib/types";

// =============================================================================
// MarketFlowField — the living currents around the mountain range.
//
// Two coupled layers, both driven by the same live quotes:
//
//   1. Data river — a luminous ring flowing between the mountains.
//      flow speed ← overall market momentum (mean |changePct|)
//      band width ← total liquidity (volume breath)
//      color      ← advancer/decliner balance (acid vs cinnabar)
//
//   2. Force-field particles — ~1800 motes drifting above the range, each
//      pulled or pushed by every mountain treated as a gravity well.
//      Up wells (changePct > 0) attract particles and lift them, glowing acid.
//      Down wells (changePct < 0) repel and sink them, glowing cinnabar.
//      Volatility sets the swirl radius — wild stocks whip up tight eddies.
//
// The force math runs in the vertex shader (GPU), so thousands of particles
// update every frame against all wells without touching the CPU.
// =============================================================================

export interface MarketFlowFieldProps {
  assets: Asset[];
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
  animate?: boolean;
}

const PARTICLE_COUNT = 1800;
const MAX_WELLS = 8;

// ---- River shader -----------------------------------------------------------
// A flat ring whose fragment shader paints flowing streaks. Flow direction and
// speed come from market momentum; color from the advance/decline balance.
const riverVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const riverFragmentShader = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform float uFlow;        // market momentum → flow speed
  uniform float uWidth;       // liquidity → river breadth factor
  uniform vec3 uColorUp;
  uniform vec3 uColorDown;
  uniform float uAdvanceRatio; // 0..1, share of advancers

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
               mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
  }

  void main() {
    // Polar coords on the ring: angle around, radius across the band.
    vec2 centered = vUv - 0.5;
    float radius = abs(centered.y) * 2.0;          // 0 at center band → 1 at edges
    float angle = centered.x + 0.5;                // 0..1 around the ring

    // Band mask: soft falloff so the river glows brightest at its heart and
    // dissolves at the banks. uWidth widens or narrows the lit core.
    float core = 1.0 - smoothstep(0.0, mix(0.18, 0.42, uWidth), radius);
    if (core < 0.01) discard;

    // Flowing streaks: layered noise scrolling with time × momentum.
    float drift = uTime * (0.25 + uFlow * 1.8);
    float streak = vnoise(vec2(angle * 24.0 - drift, radius * 4.0));
    streak = pow(streak, 1.6);
    float fineStreak = vnoise(vec2(angle * 60.0 - drift * 2.2, radius * 8.0));
    streak = mix(streak, fineStreak, 0.35);

    // Color: blend up/down by advancer ratio, then modulate by streak density.
    vec3 tint = mix(uColorDown, uColorUp, uAdvanceRatio);
    vec3 color = tint * (0.4 + streak * 1.1);

    float alpha = core * (0.18 + streak * 0.55);
    gl_FragColor = vec4(color, alpha);
  }
`;

// ---- Particle force-field shader -------------------------------------------
// Each particle's vertex shader sums the gravitational pull of every well.
// Wells with positive change attract (pull toward the well + lift), negative
// change repel (push away + sink). All on the GPU.
const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAspect;
  uniform vec3 uWells[${MAX_WELLS}];     // xy = position, z = signed changePct
  uniform float uVolatility[${MAX_WELLS}];
  uniform int uWellCount;
  uniform float uIntensity;              // global market activity 0..1

  attribute vec2 aSeed;                  // per-particle random seed
  attribute float aSize;

  varying float vForce;
  varying float vLift;

  void main() {
    // Base orbital motion: each particle drifts on its own slow orbit.
    float orbit = uTime * (0.08 + aSeed.x * 0.14);
    vec3 pos = position;
    pos.x += cos(orbit + aSeed.y * 6.28) * (0.3 + aSeed.x * 0.5);
    pos.z += sin(orbit * 0.8 + aSeed.y * 6.28) * (0.3 + aSeed.x * 0.5);

    // Sum force contributions from all gravity wells (mountains).
    vec2 force = vec2(0.0);
    float lift = 0.0;
    for (int i = 0; i < ${MAX_WELLS}; i++) {
      if (i >= uWellCount) break;
      vec3 well = uWells[i];
      vec2 toWell = well.xy - pos.xz;
      float dist = length(toWell) + 0.35;
      float invDist = 1.0 / dist;
      // Signed strength: positive change = attract, negative = repel.
      float strength = well.z * invDist * invDist * 0.9;
      force += normalize(toWell) * strength;
      // Lift: up-wells push particles upward, down-wells pull them down.
      lift += strength * uVolatility[i] * 1.4;
    }

    pos.xz += force * (0.8 + uIntensity * 1.2);
    pos.y += lift + sin(uTime * 0.6 + aSeed.y * 9.0) * 0.12;

    vForce = force.x * 0.5 + force.y * 0.5;
    vLift = lift;

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (300.0 / -mvPosition.z) * (0.6 + uIntensity * 0.8);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = /* glsl */ `
  precision highp float;
  varying float vForce;
  varying float vLift;

  void main() {
    // Soft circular point.
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;
    float glow = smoothstep(0.5, 0.0, r);

    // Color by direction: lifted (up-well) → acid, sunk (down-well) → cinnabar.
    vec3 acid = vec3(0.498, 0.718, 0.639);
    vec3 cinnabar = vec3(0.831, 0.353, 0.259);
    vec3 parchment = vec3(0.898, 0.867, 0.792);
    vec3 tint = mix(parchment, acid, clamp(vLift * 2.5, 0.0, 1.0));
    tint = mix(tint, cinnabar, clamp(-vLift * 2.5, 0.0, 1.0));

    float alpha = glow * (0.35 + abs(vLift) * 0.6 + abs(vForce) * 0.3);
    gl_FragColor = vec4(tint * (0.7 + glow * 0.6), alpha);
  }
`;

// Build the river ring geometry: a flat annulus lying on the ground plane.
function buildRiverGeometry(innerRadius: number, outerRadius: number, segments: number) {
  const geo = new THREE.RingGeometry(innerRadius, outerRadius, segments, 1);
  geo.rotateX(-Math.PI / 2);
  return geo;
}

export function MarketFlowField({ assets, liveQuotes, animate = true }: MarketFlowFieldProps) {
  const ringRadius = 2.4;
  const riverInner = ringRadius - 0.7;
  const riverOuter = ringRadius + 0.7;

  // ---- River ----
  const riverGeometry = useMemo(
    () => buildRiverGeometry(riverInner, riverOuter, 128),
    [riverInner, riverOuter]
  );
  const riverUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uFlow: { value: 0.2 },
      uWidth: { value: 0.4 },
      uColorUp: { value: new THREE.Color("#7fb7a3") },
      uColorDown: { value: new THREE.Color("#d45a42") },
      uAdvanceRatio: { value: 0.5 }
    }),
    []
  );
  const riverMaterialRef = useRef<THREE.ShaderMaterial>(null);

  // ---- Particles ----
  const particleGeometry = useMemo(() => {
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const seeds = new Float32Array(PARTICLE_COUNT * 2);
    const sizes = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      // Distribute particles in a disc around the mountains, slightly above.
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.8 + Math.random() * 3.8;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.6 + Math.random() * 2.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i * 2] = Math.random();
      seeds[i * 2 + 1] = Math.random();
      sizes[i] = 0.02 + Math.random() * 0.05;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 2));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    return geo;
  }, []);

  // Well arrays: packed positions + per-well volatility, uploaded each frame.
  const wellArrays = useMemo(() => {
    const positions = new Float32Array(MAX_WELLS * 3);
    const volatility = new Float32Array(MAX_WELLS);
    return { positions, volatility };
  }, []);

  const particleUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uWells: { value: wellArrays.positions },
      uVolatility: { value: wellArrays.volatility },
      uWellCount: { value: assets.length },
      uIntensity: { value: 0.3 }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wellArrays]
  );
  const particleMaterialRef = useRef<THREE.ShaderMaterial>(null);

  // Precompute the static well layout (matches the mountain ring).
  const wells = useMemo(() => {
    const count = assets.length;
    return assets.map((asset, index) => {
      const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        assetId: asset.id,
        x: Math.cos(angle) * ringRadius,
        z: Math.sin(angle) * ringRadius,
        volatility: Math.max(0.12, asset.volatility)
      };
    });
  }, [assets, ringRadius]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (riverMaterialRef.current) {
      riverMaterialRef.current.uniforms.uTime.value = t;
    }
    if (particleMaterialRef.current) {
      particleMaterialRef.current.uniforms.uTime.value = t;
    }
    if (!animate) return;

    // Recompute market-wide aggregates from live quotes each frame.
    let sumAbsChange = 0;
    let advancers = 0;
    let decliners = 0;
    let sumVolatility = 0;
    let activeCount = 0;

    wells.forEach((well, i) => {
      const live = liveQuotes?.get(well.assetId);
      const change = live?.changePct ?? 0;
      // Pack well position + signed change for the GPU.
      wellArrays.positions[i * 3] = well.x;
      wellArrays.positions[i * 3 + 1] = well.z;
      wellArrays.positions[i * 3 + 2] = change;
      wellArrays.volatility[i] = well.volatility;

      sumAbsChange += Math.abs(change);
      sumVolatility += well.volatility;
      if (change > 0.05) advancers++;
      else if (change < -0.05) decliners++;
      activeCount++;
    });

    const momentum = activeCount > 0 ? Math.min(1, sumAbsChange / (activeCount * 4)) : 0;
    const advanceRatio = advancers + decliners > 0 ? advancers / (advancers + decliners) : 0.5;
    const avgVolatility = activeCount > 0 ? sumVolatility / activeCount : 0.3;

    // Smoothly steer the river + particle uniforms toward the live state.
    if (riverMaterialRef.current) {
      const u = riverMaterialRef.current.uniforms;
      u.uFlow.value = THREE.MathUtils.damp(u.uFlow.value, momentum, 2.5, delta);
      u.uWidth.value = THREE.MathUtils.damp(u.uWidth.value, 0.3 + avgVolatility * 0.7, 2.5, delta);
      u.uAdvanceRatio.value = THREE.MathUtils.damp(u.uAdvanceRatio.value, advanceRatio, 3.0, delta);
    }
    if (particleMaterialRef.current) {
      particleMaterialRef.current.uniforms.uIntensity.value = THREE.MathUtils.damp(
        particleMaterialRef.current.uniforms.uIntensity.value,
        momentum,
        2.5,
        delta
      );
      // Notify the GPU that the well textures changed.
      if (particleGeometry.attributes.position) {
        // wells live in a separate uniform array, just mark via needsUpdate n/a.
      }
    }
  });

  return (
    <group>
      {/* Data river — luminous flowing band encircling the mountain ring. */}
      <mesh geometry={riverGeometry} position={[0, 0.04, 0]}>
        <shaderMaterial
          ref={riverMaterialRef}
          vertexShader={riverVertexShader}
          fragmentShader={riverFragmentShader}
          uniforms={riverUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* Force-field particles — motes drifting in the mountains' gravity. */}
      <points geometry={particleGeometry}>
        <shaderMaterial
          ref={particleMaterialRef}
          vertexShader={particleVertexShader}
          fragmentShader={particleFragmentShader}
          uniforms={particleUniforms}
          transparent
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </points>
    </group>
  );
}
