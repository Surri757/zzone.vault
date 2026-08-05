"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Asset } from "@/lib/types";

// =============================================================================
// FocusPulseRing — a vertical halo that rises above the selected stock's peak.
//
// The ring is a closed loop drawn in 3D space above the mountain. Its shape is
// carved by the asset's real intraday series: each sample becomes a vertex, so
// the ring's silhouette IS the price path. The latest tick is brightest; older
// ones fade. The ring expands with each new tick and slowly orbits, so the
// focused stock visibly pulses with every live update.
//
// When no asset is highlighted, the ring fades out completely.
// =============================================================================

export interface FocusPulseRingProps {
  assets: Asset[];
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
  highlightedIds?: string[];
  animate?: boolean;
}

const RING_SAMPLES = 64;       // vertex count around the ring
const RING_RADIUS = 0.85;      // base ring radius
const RING_HEIGHT = 2.6;       // how high above the peak the ring floats

export function FocusPulseRing({
  assets,
  liveQuotes,
  highlightedIds = [],
  animate = true
}: FocusPulseRingProps) {
  const groupRef = useRef<THREE.Group>(null);
  const lineRef = useRef<THREE.Line>(null);
  const glowRef = useRef<THREE.Line>(null);
  const { camera } = useThree();

  // Resolve which asset is focused (first highlighted id that exists).
  const focusedAsset = useMemo(() => {
    const id = highlightedIds[0];
    return assets.find((a) => a.id === id) ?? null;
  }, [assets, highlightedIds]);

  // Compute the focused mountain's ring position (must match the layout in
  // MarketMountainRidge / MarketFlowField).
  const focusPosition = useMemo(() => {
    if (!focusedAsset) return null;
    const count = assets.length;
    const index = assets.findIndex((a) => a.id === focusedAsset.id);
    if (index < 0) return null;
    const ringRadius = count <= 1 ? 0 : 2.4;
    const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
    return new THREE.Vector3(
      Math.cos(angle) * ringRadius,
      RING_HEIGHT,
      Math.sin(angle) * ringRadius
    );
  }, [focusedAsset, assets]);

  // Ring geometry: a buffer we rewrite each frame from the live series so the
  // silhouette tracks the real price path.
  const ringGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(RING_SAMPLES * 3);
    const colors = new Float32Array(RING_SAMPLES * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geo;
  }, []);

  // A second, wider geometry for the soft outer glow (same vertices, scaled).
  const glowGeometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const positions = new Float32Array(RING_SAMPLES * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    return geo;
  }, []);

  const acidColor = useMemo(() => new THREE.Color("#7fb7a3"), []);
  const cinnabarColor = useMemo(() => new THREE.Color("#d45a42"), []);
  const parchmentColor = useMemo(() => new THREE.Color("#e5ddca"), []);
  const scratchColor = useMemo(() => new THREE.Color(), []);

  // Visibility tween: fade the whole group in/out based on whether something
  // is focused.
  const visibilityRef = useRef(0);

  useFrame((state, delta) => {
    const target = focusPosition;
    const group = groupRef.current;
    if (!group) return;

    // Fade visibility toward 1 when focused, 0 otherwise.
    const targetVis = target ? 1 : 0;
    visibilityRef.current = THREE.MathUtils.damp(
      visibilityRef.current,
      targetVis,
      4.0,
      delta
    );
    group.visible = visibilityRef.current > 0.01;
    if (!group.visible) return;

    // Position the group under the focused mountain.
    if (target) {
      group.position.x = THREE.MathUtils.damp(group.position.x, target.x, 5.0, delta);
      group.position.y = THREE.MathUtils.damp(group.position.y, target.y, 5.0, delta);
      group.position.z = THREE.MathUtils.damp(group.position.z, target.z, 5.0, delta);
    }

    // Slow self-rotation so the ring reads as a living halo.
    if (animate) {
      group.rotation.y += delta * 0.35;
    }

    // Rewrite ring vertices from the live price series. The series is the
    // asset's trend (normalized 13..87); we map it to radial deviations so the
    // ring's silhouette oscillates with the price path.
    const trend = focusedAsset?.trend ?? [];
    const live = focusedAsset ? liveQuotes?.get(focusedAsset.id) : undefined;
    const change = live?.changePct ?? focusedAsset?.change24h ?? 0;
    const tone = change >= 0 ? acidColor : cinnabarColor;

    const positions = ringGeometry.attributes.position.array as Float32Array;
    const colors = ringGeometry.attributes.color.array as Float32Array;
    const glowPositions = glowGeometry.attributes.position.array as Float32Array;

    for (let i = 0; i < RING_SAMPLES; i++) {
      const t = i / RING_SAMPLES;
      const angle = t * Math.PI * 2;
      // Sample the trend path; if short, stretch it around the ring.
      const trendIdx = Math.min(
        Math.max(0, trend.length - 1),
        Math.floor(t * Math.max(trend.length, 1))
      );
      const trendValue = trend[trendIdx] ?? 50;
      // Normalize 13..87 → -1..1 radial deviation.
      const deviation = ((trendValue - 50) / 37) * 0.42;
      const r = RING_RADIUS * (1 + deviation);

      // Add a gentle vertical wave so the ring isn't perfectly flat.
      const yWave = Math.sin(angle * 3 + state.clock.elapsedTime * 0.8) * 0.12;

      const x = Math.cos(angle) * r;
      const z = Math.sin(angle) * r;
      positions[i * 3] = x;
      positions[i * 3 + 1] = yWave;
      positions[i * 3 + 2] = z;

      // Glow ring is a slightly larger copy.
      glowPositions[i * 3] = x * 1.18;
      glowPositions[i * 3 + 1] = yWave;
      glowPositions[i * 3 + 2] = z * 1.18;

      // Color: fade from bright (most recent tick, i near 0/RING_SAMPLES) to
      // dim toward the back of the ring.
      const recency = 1 - Math.abs(t - 0.5) * 1.6;
      const recencyClamped = Math.max(0, recency);
      scratchColor.copy(parchmentColor).lerp(tone, 0.6);
      colors[i * 3] = scratchColor.r * (0.3 + recencyClamped * 0.7);
      colors[i * 3 + 1] = scratchColor.g * (0.3 + recencyClamped * 0.7);
      colors[i * 3 + 2] = scratchColor.b * (0.3 + recencyClamped * 0.7);
    }

    ringGeometry.attributes.position.needsUpdate = true;
    ringGeometry.attributes.color.needsUpdate = true;
    glowGeometry.attributes.position.needsUpdate = true;

    // Subtle camera bias: when focused, drift the camera slightly toward the
    // focused mountain so it reads as the subject, without fighting OrbitControls.
    if (target && animate) {
      const desiredX = target.x * 0.25;
      const desiredZ = 7.2 + target.z * 0.15;
      camera.position.x = THREE.MathUtils.damp(camera.position.x, desiredX, 1.2, delta);
      camera.position.z = THREE.MathUtils.damp(camera.position.z, desiredZ, 1.2, delta);
    }
  });

  return (
    <group ref={groupRef} visible={false}>
      {/* Soft outer glow */}
      {/* @ts-expect-error three line intrinsic */}
      <line ref={glowRef} geometry={glowGeometry}>
        <lineBasicMaterial
          color={parchmentColor}
          transparent
          opacity={0.12}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </line>
      {/* Main ring */}
      {/* @ts-expect-error three line intrinsic */}
      <line ref={lineRef} geometry={ringGeometry}>
        <lineBasicMaterial
          vertexColors
          transparent
          opacity={0.92}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </line>
    </group>
  );
}
