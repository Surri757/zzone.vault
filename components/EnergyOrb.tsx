"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, type MutableRefObject } from "react";
import * as THREE from "three";
import type { Asset } from "@/lib/types";

// =============================================================================
// EnergyOrb — seven nested particle rings hovering at the center of the scene.
//
// Each ring is a circle of particles that converge inward (one-by-one, like an
// energy ball assembling) and then keep orbiting. Every ring has its own
// angular velocity — so the whole orb reads as a gyroscope of nested shells,
// each with visibly different momentum. The seven rings use a gold/bronze →
// warm-white gradient so the ring count is legible at a glance.
//
// Lightweight market linkage: the orb breathes with the focused stock's live
// changePct — bigger moves inflate the shells slightly, and a slow traveling
// pulse keeps it alive. The original acid-green field is untouched.
// =============================================================================

interface RingDef {
  radius: number;   // base ring radius (world-ish units, in the ring's plane)
  tiltX: number;    // ring plane orientation (rad)
  tiltZ: number;
  speed: number;    // roll angular velocity — spin around the ring's own axis
  tumbleX: number;  // flip angular velocity — tumble the ring plane around X
  tumbleZ: number;  // roll angular velocity — tumble the ring plane around Z
  count: number;    // particles forming this ring
  color: string;
  phase: number;    // travelling-pulse phase offset
  size: number;     // particle sprite size
}

// 7 rings, gold/bronze → amber → warm white. Distinct tones per ring so you can
// count the shells at a glance. Each ring rolls around its own axis AND tumbles
// around X/Z at its own rate, so the whole orb precesses like a gyroscope —
// every shell flips and rolls in 3D instead of spinning flat.
const RINGS: RingDef[] = [
  { radius: 0.55, tiltX: 0.0,  tiltZ: 0.0,  speed: 0.55, tumbleX: 0.30, tumbleZ: -0.22, count: 150, color: "#8a5a1e", phase: 0.0, size: 0.045 },
  { radius: 0.74, tiltX: 0.5,  tiltZ: 0.3,  speed: 0.72, tumbleX: -0.42, tumbleZ: 0.28,  count: 180, color: "#a86f24", phase: 1.1, size: 0.048 },
  { radius: 0.93, tiltX: 1.0,  tiltZ: -0.4, speed: 0.90, tumbleX: 0.55,  tumbleZ: -0.36, count: 210, color: "#c98a2e", phase: 2.2, size: 0.050 },
  { radius: 1.12, tiltX: 1.5,  tiltZ: 0.2,  speed: 1.06, tumbleX: -0.68, tumbleZ: 0.44,  count: 240, color: "#dfa63c", phase: 3.3, size: 0.052 },
  { radius: 1.30, tiltX: 0.8,  tiltZ: -1.2, speed: 1.24, tumbleX: 0.80,  tumbleZ: -0.52, count: 270, color: "#efc25c", phase: 4.4, size: 0.055 },
  { radius: 1.47, tiltX: 1.2,  tiltZ: -0.8, speed: 1.42, tumbleX: -0.92, tumbleZ: 0.60,  count: 300, color: "#fbd97e", phase: 5.5, size: 0.058 },
  { radius: 1.63, tiltX: 0.3,  tiltZ: -1.6, speed: 1.60, tumbleX: 1.05,  tumbleZ: -0.70, count: 330, color: "#fff0c2", phase: 6.6, size: 0.060 }
];

// Soft round sprite so particles render as glowing motes, not squares.
function makeSoftCircleTexture(): THREE.CanvasTexture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

function Ring({
  def,
  animate,
  texture,
  changeRef
}: {
  def: RingDef;
  animate: boolean;
  texture: THREE.Texture;
  changeRef: MutableRefObject<number>;
}) {
  const spinRef = useRef<THREE.Group>(null);
  const tumbleRef = useRef<THREE.Group>(null);

  // Per-particle data: base angle offset, radial spread within the band, a
  // slight thickness offset, and the current (converging) radius.
  const { offsets, radialOffsets, yOffsets, radiiRef, geometry } = useMemo(() => {
    const positions = new Float32Array(def.count * 3);
    const colors = new Float32Array(def.count * 3);
    const offsets = new Float32Array(def.count);
    const radialOffsets = new Float32Array(def.count);
    const yOffsets = new Float32Array(def.count);
    const radii = new Float32Array(def.count);
    const color = new THREE.Color(def.color);
    // Thin, crisp rings: only a hair of radial jitter + zero thickness, so the
    // shells stay razor-thin and you can clearly count how many there are.
    // Density (count) is what makes each ring read clearly, not width.
    const band = def.radius * 0.03;
    const thickness = 0;
    for (let i = 0; i < def.count; i++) {
      offsets[i] = Math.random() * Math.PI * 2;
      // Hair of radial jitter (±band) keeps neighbouring particles from stacking
      // on the exact same radius, so the ring stays thin but reads as a solid
      // dense line of light.
      radialOffsets[i] = (Math.random() - 0.5) * 2 * band;
      yOffsets[i] = (Math.random() - 0.5) * 2 * thickness;
      // Start scattered across / slightly outside the ring volume so the
      // assembly reads as particles flying in one-by-one.
      radii[i] = def.radius * (0.08 + Math.random() * 1.35);
      // Per-particle brightness for a lively, uneven glow.
      const brightness = 0.55 + Math.random() * 0.45;
      colors[i * 3] = color.r * brightness;
      colors[i * 3 + 1] = color.g * brightness;
      colors[i * 3 + 2] = color.b * brightness;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return { offsets, radialOffsets, yOffsets, radiiRef: { current: radii }, geometry: geo };
  }, [def]);

  useFrame((state, delta) => {
    // Roll the ring around its own axis...
    if (animate && spinRef.current) {
      spinRef.current.rotation.y += def.speed * delta;
    }
    // ...and tumble the whole ring plane around X/Z at its own rate, so each
    // shell flips and rolls in 3D (a precessing gyroscope) instead of spinning
    // flat. The wake from the initial tilt blends into the tumbling motion.
    if (animate && tumbleRef.current) {
      tumbleRef.current.rotation.x += def.tumbleX * delta;
      tumbleRef.current.rotation.z += def.tumbleZ * delta;
    }

    const pos = geometry.attributes.position.array as Float32Array;
    const radii = radiiRef.current;
    const t = state.clock.elapsedTime;
    // Lightweight linkage: ring radius breathes with the focused change, plus
    // a slow travelling pulse so each shell subtly swells and thins.
    const wave =
      def.radius *
      (1 +
        0.035 * Math.sin(t * def.speed * 1.6 + def.phase) +
        changeRef.current * 0.02);
    for (let i = 0; i < def.count; i++) {
      // Converge toward the band radius (base + this particle's radial spread).
      radii[i] = THREE.MathUtils.damp(radii[i], wave * (1 + radialOffsets[i]), 2.2, delta);
      const angle = offsets[i] + t * def.speed;
      pos[i * 3] = Math.cos(angle) * radii[i];
      // Thickness: a fixed vertical offset per particle keeps the band voluminous.
      pos[i * 3 + 1] = yOffsets[i];
      pos[i * 3 + 2] = Math.sin(angle) * radii[i];
    }
    geometry.attributes.position.needsUpdate = true;
  });

  return (
    <group ref={tumbleRef} rotation={[def.tiltX, 0, def.tiltZ]}>
      <group ref={spinRef}>
        <points geometry={geometry}>
          <pointsMaterial
            vertexColors
            map={texture}
            size={def.size}
            sizeAttenuation
            transparent
            opacity={0.92}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </points>
      </group>
    </group>
  );
}

export interface EnergyOrbProps {
  assets: Asset[];
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
  highlightedIds?: string[];
  animate?: boolean;
}

export function EnergyOrb({
  assets,
  liveQuotes,
  highlightedIds = [],
  animate = true
}: EnergyOrbProps) {
  const softTexture = useMemo(() => makeSoftCircleTexture(), []);
  const orbRef = useRef<THREE.Group>(null);
  // Shared sink: the parent dampens the focused change each frame; each ring
  // reads it inside its own useFrame without forcing re-renders.
  const changeRef = useRef<number>(0);

  useFrame((state, delta) => {
    // Resolve the focused stock's live change so the orb breathes with it.
    const focusedId = highlightedIds[0];
    const focusedAsset = assets.find((a) => a.id === focusedId);
    const live = focusedAsset ? liveQuotes?.get(focusedAsset.id) : undefined;
    const target = live?.changePct ?? focusedAsset?.change24h ?? 0;
    changeRef.current = THREE.MathUtils.damp(changeRef.current, target, 3.0, delta);

    // Slow global rotation + a faint scale link to the market move.
    if (orbRef.current && animate) {
      orbRef.current.rotation.y += delta * 0.12;
      const s =
        1 + changeRef.current * 0.02 + Math.sin(state.clock.elapsedTime * 0.9) * 0.01;
      orbRef.current.scale.setScalar(s);
    }
  });

  return (
    <group position={[0, 1.5, 0]}>
      <group ref={orbRef}>
        {/* Soft central core glow — the seat of the energy ball. */}
        <sprite position={[0, 0, 0]} scale={[1.6, 1.6, 1]}>
          <spriteMaterial
            map={softTexture}
            color="#ffd98a"
            transparent
            opacity={0.32}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
        {RINGS.map((def) => (
          <Ring
            key={def.radius}
            def={def}
            animate={animate}
            texture={softTexture}
            changeRef={changeRef}
          />
        ))}
      </group>
    </group>
  );
}