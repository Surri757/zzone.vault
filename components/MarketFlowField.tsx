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

// ---- Particle choreographed shader ----------------------------------------
// Particles follow deliberate, readable motion patterns instead of random drift.
// Each particle picks one of three trajectories by its aPhase attribute:
//   phase 0 — ring current: orbits the mountain ring at speed driven by momentum
//   phase 1 — meteor fall:   streaks down from on high at an angle (meteor shower)
//   phase 2 — converge burst: pulses inward to the center, then explodes outward
// Speed and twinkle frequency are both ~3× the earlier random version.
const particleVertexShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uWells[${MAX_WELLS}];
  uniform float uVolatility[${MAX_WELLS}];
  uniform int uWellCount;
  uniform float uIntensity;        // market momentum 0..1, speeds everything up
  uniform float uConverge;         // 0..1, drives the converge-burst pulse

  attribute vec2 aSeed;
  attribute float aSize;
  attribute float aPhase;          // 0 ring | 1 meteor | 2 converge

  varying float vLift;
  varying float vTwinkle;
  varying float vPhase;

  void main() {
    float t = uTime;
    vec3 pos = position;
    float lift = 0.0;

    if (aPhase < 0.5) {
      // ---- Ring current: orbit the mountain ring ----
      float orbitRadius = 1.8 + aSeed.x * 2.6;
      float baseAngle = aSeed.y * 6.28318;
      // High-speed flow: momentum + a baseline so it's always alive.
      float speed = (0.5 + uIntensity * 2.2) * (0.7 + aSeed.x * 0.6);
      float angle = baseAngle + t * speed;
      pos.x = cos(angle) * orbitRadius;
      pos.z = sin(angle) * orbitRadius;
      pos.y = 0.8 + aSeed.x * 2.4 + sin(t * 1.8 + baseAngle * 3.0) * 0.4;
      lift = sin(t * 2.0 + baseAngle) * 0.3;
    } else if (aPhase < 1.5) {
      // ---- Meteor fall: streak down from the sky at an angle ----
      float cycle = fract((t * (0.18 + uIntensity * 0.5) + aSeed.y) );
      float startAngle = aSeed.y * 6.28318;
      float radial = 3.8 + aSeed.x * 1.5;
      // Start high and outside, fall toward the ring center diagonally.
      pos.x = cos(startAngle) * radial * (1.0 - cycle * 0.55);
      pos.z = sin(startAngle) * radial * (1.0 - cycle * 0.55);
      pos.y = 5.5 - cycle * 5.0 + aSeed.x * 0.8;
      lift = -0.6 + cycle * 0.3;
    } else {
      // ---- Converge burst: pulse toward center then explode out ----
      // The converge uniform breathes 0→1→0; particles track it.
      float pulse = uConverge;
      float cycle = fract(t * (0.12 + uIntensity * 0.4) + aSeed.x);
      float angle = aSeed.y * 6.28318 + t * 0.3;
      // radius: large → small (converge) → large (burst)
      float radius = mix(4.2, 0.5, pulse) + cycle * (1.0 - pulse) * 3.0;
      pos.x = cos(angle) * radius;
      pos.z = sin(angle) * radius;
      pos.y = 1.0 + aSeed.x * 2.0 + pulse * 2.0;
      lift = pulse * 0.8 - 0.2;
    }

    // Gravity-well tint: still sample the wells so color follows the market.
    vec2 force = vec2(0.0);
    for (int i = 0; i < ${MAX_WELLS}; i++) {
      if (i >= uWellCount) break;
      vec3 well = uWells[i];
      vec2 toWell = well.xy - pos.xz;
      float dist = length(toWell) + 0.4;
      float strength = well.z / (dist * dist);
      force += normalize(toWell) * strength;
      lift += strength * uVolatility[i];
    }

    vLift = lift;
    vPhase = aPhase;

    // High-frequency twinkle: each particle flickers fast, phase-offset.
    vTwinkle = 0.5 + 0.5 * sin(t * (8.0 + aSeed.x * 14.0) + aSeed.y * 20.0);

    vec4 mvPosition = modelViewMatrix * vec4(pos, 1.0);
    gl_PointSize = aSize * (340.0 / -mvPosition.z) * (0.7 + uIntensity * 1.1) * (0.6 + vTwinkle * 0.6);
    gl_Position = projectionMatrix * mvPosition;
  }
`;

const particleFragmentShader = /* glsl */ `
  precision highp float;
  varying float vLift;
  varying float vTwinkle;
  varying float vPhase;

  void main() {
    vec2 c = gl_PointCoord - 0.5;
    float r = length(c);
    if (r > 0.5) discard;

    // Brighter core + softer halo for a luminous mote, not a flat dot.
    float core = smoothstep(0.18, 0.0, r);
    float halo = smoothstep(0.5, 0.1, r);
    float glow = core * 0.8 + halo * 0.4;

    vec3 acid = vec3(0.498, 0.718, 0.639);
    vec3 cinnabar = vec3(0.831, 0.353, 0.259);
    vec3 parchment = vec3(0.898, 0.867, 0.792);
    vec3 meteor = vec3(0.92, 0.88, 0.74);

    vec3 tint = mix(parchment, acid, clamp(vLift * 3.0, 0.0, 1.0));
    tint = mix(tint, cinnabar, clamp(-vLift * 3.0, 0.0, 1.0));
    // Meteors read warm-white hot.
    tint = mix(tint, meteor, step(0.5, vPhase) * step(vPhase, 1.5));

    // Twinkle modulates both brightness and alpha — fast flicker.
    float bright = 0.5 + vTwinkle * 0.9;
    float alpha = glow * (0.3 + abs(vLift) * 0.5) * bright;
    gl_FragColor = vec4(tint * bright, alpha);
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
    const phases = new Float32Array(PARTICLE_COUNT);
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const angle = Math.random() * Math.PI * 2;
      const radius = 0.8 + Math.random() * 3.8;
      positions[i * 3] = Math.cos(angle) * radius;
      positions[i * 3 + 1] = 0.6 + Math.random() * 2.8;
      positions[i * 3 + 2] = Math.sin(angle) * radius;
      seeds[i * 2] = Math.random();
      seeds[i * 2 + 1] = Math.random();
      sizes[i] = 0.03 + Math.random() * 0.06;
      // Choreography split: ~55% ring current, ~30% meteor, ~15% converge burst.
      const roll = Math.random();
      phases[i] = roll < 0.55 ? 0 : roll < 0.85 ? 1 : 2;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 2));
    geo.setAttribute("aSize", new THREE.BufferAttribute(sizes, 1));
    geo.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
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
      uIntensity: { value: 0.3 },
      uConverge: { value: 0.0 }
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
      const pu = particleMaterialRef.current.uniforms;
      pu.uIntensity.value = THREE.MathUtils.damp(pu.uIntensity.value, momentum, 2.5, delta);
      // Converge-burst: a breathing pulse whose strength scales with volatility.
      // High-volatility markets trigger dramatic gather-then-explode cycles.
      const burstStrength = Math.min(1, avgVolatility * 1.6);
      const pulse = 0.5 + 0.5 * Math.sin(state.clock.elapsedTime * 0.7);
      pu.uConverge.value = THREE.MathUtils.damp(
        pu.uConverge.value,
        pulse * burstStrength,
        3.0,
        delta
      );
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
