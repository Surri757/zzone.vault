"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import type { Asset } from "@/lib/types";

// =============================================================================
// MarketMountainRidge — the market rendered as a living ink-wash mountain range.
//
// Each featured stock becomes one mountain arranged on a ring. The geometry is
// carved entirely by real quote data, every frame:
//
//   peak height  ← heat          (|changePct|, how hard it's moving)
//   ridge shape  ← trend[]       (real intraday series → the mountain's skyline)
//   steepness    ← volatility    (day range → how jagged the peaks are)
//   foot width   ← liquidity     (volume → how broad the base is)
//   body color   ← change24h     (cinnabar red ↓ · carbon · acid green ↑)
//
// On every tick the height/color uniforms damp toward the latest quote, so the
// range breathes with the market instead of snapping. This is the visual core
// of the overview — not a decoration layered on top, but the data itself made
// spatial.
// =============================================================================

export interface MarketMountainRidgeProps {
  assets: Asset[];
  /** Live quotes keyed by asset id; drives the per-frame height/color updates. */
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
  highlightedIds?: string[];
  animate?: boolean;
}

const PALETTE = {
  carbon: new THREE.Color("#070906"),
  soot: new THREE.Color("#141a16"),
  mineral: new THREE.Color("#3a4d42"),
  acid: new THREE.Color("#7fb7a3"),
  cinnabar: new THREE.Color("#d45a42"),
  parchment: new THREE.Color("#e5ddca")
};

// Vertex shader: displaces a plane into a mountain. The displacement has three
// layers — a radial falloff so the peak is centered, a noise ridge driven by
// the trend texture, and a jitter scaled by volatility — all summed and lifted
// by the uniform peak height.
const mountainVertexShader = /* glsl */ `
  uniform float uPeakHeight;
  uniform float uVolatility;
  uniform float uTime;
  uniform sampler2D uTrendMap;
  attribute vec2 aLocal;

  varying float vHeight;
  varying vec2 vLocal;
  varying vec3 vWorldPos;

  // Cheap value noise so ridges look organic without an external texture.
  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  void main() {
    // aLocal is the vertex position in unit-square space [-1, 1] relative to
    // the mountain's own center. Radius from center drives the cone falloff.
    float radius = length(aLocal);

    // Cone profile: sharp peak in the middle, broad skirt at the foot.
    // pow makes the peak pronounced and the base spread wide.
    float cone = pow(max(0.0, 1.0 - radius), 1.6);

    // Trend-driven ridge: sample the trend texture along the radial angle so
    // the skyline silhouette follows the real intraday series.
    float angle = atan(aLocal.y, aLocal.x);
    float ridgeSample = texture2D(uTrendMap, vec2((angle + 3.14159) / 6.28318, radius)).r;
    float ridge = (ridgeSample - 0.5) * uVolatility * 1.8;

    // Fine jitter for crags, scaled by volatility — calm stocks are smooth
    // domes, volatile stocks are jagged peaks.
    float crag = (vnoise(aLocal * 6.0 + uTime * 0.04) - 0.5) * uVolatility * 0.9;
    float microCrag = (vnoise(aLocal * 18.0) - 0.5) * uVolatility * 0.35;

    float displacement = cone * uPeakHeight + ridge * cone + crag + microCrag;

    vHeight = displacement;
    vLocal = aLocal;

    vec3 displaced = position + vec3(0.0, displacement, 0.0);
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos.xyz;
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

// Fragment shader: colors the mountain by height + change direction, with a
// parchment ridge highlight near the peak and an ink-wash darkening at the base.
const mountainFragmentShader = /* glsl */ `
  precision highp float;

  uniform vec3 uColorUp;
  uniform vec3 uColorDown;
  uniform float uChange;       // signed changePct, drives color blend
  uniform float uPeakHeight;
  uniform float uTime;

  varying float vHeight;
  varying vec2 vLocal;
  varying vec3 vWorldPos;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  void main() {
    // Height ratio 0..1 across this mountain's current displacement.
    float heightRatio = uPeakHeight > 0.01 ? clamp(vHeight / (uPeakHeight * 1.3), 0.0, 1.0) : 0.0;

    // Direction blend: how far toward up/down color this mountain leans.
    // Squash tiny moves so flat stocks stay neutral mineral tone.
    float dir = clamp(uChange / 4.0, -1.0, 1.0);
    vec3 base = mix(vec3(0.229, 0.302, 0.259), uColorUp, max(0.0, dir) * 0.85);
    base = mix(base, uColorDown, max(0.0, -dir) * 0.85);

    // Vertical stratigraphy: darker at the foot, lighter mineral near the top.
    vec3 color = mix(vec3(0.045, 0.055, 0.045), base, smoothstep(0.0, 0.55, heightRatio));

    // Parchment ridge line: a thin bright highlight tracing the upper crest.
    float ridgeLine = smoothstep(0.72, 0.92, heightRatio) - smoothstep(0.92, 1.0, heightRatio);
    color += vec3(0.76, 0.73, 0.65) * ridgeLine * 0.22;

    // Paper-fibre grain so the surface reads as ink on paper, not plastic.
    float fibre = (hash(vLocal * 220.0 + uTime * 0.01) - 0.5);
    color += vec3(0.76, 0.73, 0.65) * fibre * 0.022;

    // Distance fade into the fog so distant mountains dissolve into atmosphere.
    float depth = clamp((-vWorldPos.z + 4.0) / 12.0, 0.0, 1.0);
    color *= 0.55 + depth * 0.45;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Build a radial trend texture (DataTexture) from the real intraday series:
// the angle around the mountain encodes successive trend points, the radius
// band fades them toward the foot. One texture per asset, rebuilt when the
// trend array changes.
function buildTrendTexture(trend: number[]): THREE.DataTexture {
  const size = 64;
  const data = new Uint8Array(size * size);
  const clamped = trend.length > 1 ? trend : [50, 50];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1);
      // Map the column to a trend sample (angle around the mountain).
      const idx = Math.min(clamped.length - 1, Math.floor(u * clamped.length));
      const value = clamped[idx] / 100; // normalized 0..1
      // Fade toward the foot (bottom rows = base, keep some signal).
      const radial = y / (size - 1);
      const faded = value * (0.35 + 0.65 * radial);
      data[y * size + x] = Math.max(0, Math.min(255, Math.round(faded * 255)));
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RedFormat, THREE.UnsignedByteType);
  tex.needsUpdate = true;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

interface MountainInstance {
  assetId: string;
  symbol: string;
  name: string;
  position: THREE.Vector3;
  baseScale: number;
  trendTexture: THREE.DataTexture;
  // Animated uniform targets (damped each frame toward the live quote).
  peakHeight: number;
  change: number;
  volatility: number;
}

function SingleMountain({
  instance,
  liveQuotes,
  highlighted,
  animate
}: {
  instance: MountainInstance;
  liveQuotes?: MarketMountainRidgeProps["liveQuotes"];
  highlighted: boolean;
  animate: boolean;
}) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  // Per-instance uniforms (created once; we mutate .value each frame).
  const uniforms = useMemo(
    () => ({
      uPeakHeight: { value: instance.peakHeight },
      uVolatility: { value: instance.volatility },
      uChange: { value: instance.change },
      uTime: { value: 0 },
      uTrendMap: { value: instance.trendTexture },
      uColorUp: { value: PALETTE.acid.clone() },
      uColorDown: { value: PALETTE.cinnabar.clone() }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // The geometry carries an `aLocal` attribute = vertex position in the unit
  // square, so the vertex shader can compute radius/angle regardless of the
  // mesh's world scale.
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2, 48, 48);
    geo.rotateX(-Math.PI / 2);
    const local = new Float32Array(geo.attributes.position.count * 2);
    const pos = geo.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      local[i * 2] = pos.getX(i);
      local[i * 2 + 1] = pos.getZ(i);
    }
    geo.setAttribute("aLocal", new THREE.BufferAttribute(local, 2));
    return geo;
  }, []);

  useFrame((state, delta) => {
    if (!materialRef.current) return;

    // Resolve the latest quote for this asset and damp the uniforms toward it,
    // so a new tick eases the mountain rather than snapping.
    const live = liveQuotes?.get(instance.assetId);
    const targetPeak = Math.max(0.4, Math.min(3.2, (Math.abs(live?.changePct ?? instance.change) / 5) * 2.4 + 0.4));
    const targetChange = live?.changePct ?? instance.change;

    if (animate) {
      uniforms.uPeakHeight.value = THREE.MathUtils.damp(
        uniforms.uPeakHeight.value,
        targetPeak,
        3.5,
        delta
      );
      uniforms.uChange.value = THREE.MathUtils.damp(
        uniforms.uChange.value,
        targetChange,
        4.0,
        delta
      );
      uniforms.uTime.value = state.clock.elapsedTime;
    }

    // Highlight pulse: a highlighted mountain lifts slightly and brightens.
    const targetLift = highlighted ? 0.35 : 0;
    if (meshRef.current) {
      meshRef.current.position.y = THREE.MathUtils.damp(
        meshRef.current.position.y,
        instance.position.y + targetLift,
        4.0,
        delta
      );
    }
  });

  return (
    <mesh
      ref={meshRef}
      geometry={geometry}
      position={[instance.position.x, instance.position.y, instance.position.z]}
      scale={[instance.baseScale, 1, instance.baseScale]}
    >
      <shaderMaterial
        ref={materialRef}
        vertexShader={mountainVertexShader}
        fragmentShader={mountainFragmentShader}
        uniforms={uniforms}
        transparent
      />
    </mesh>
  );
}

export function MarketMountainRidge({
  assets,
  liveQuotes,
  highlightedIds = [],
  animate = true
}: MarketMountainRidgeProps) {
  const highlightedSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  // Arrange assets on a ring; each mountain's base scale grows with liquidity.
  const instances = useMemo<MountainInstance[]>(() => {
    const count = assets.length;
    const ringRadius = count <= 1 ? 0 : 2.4;
    return assets.map((asset, index) => {
      const angle = (index / Math.max(count, 1)) * Math.PI * 2 - Math.PI / 2;
      return {
        assetId: asset.id,
        symbol: asset.symbol,
        name: asset.name,
        position: new THREE.Vector3(
          Math.cos(angle) * ringRadius,
          0,
          Math.sin(angle) * ringRadius
        ),
        baseScale: 0.85 + asset.liquidity * 0.9,
        trendTexture: buildTrendTexture(asset.trend),
        peakHeight: Math.max(0.4, Math.min(3.2, asset.heat * 2.4 + 0.4)),
        change: asset.change24h,
        volatility: Math.max(0.12, asset.volatility)
      };
    });
  }, [assets]);

  // A translucent ground plane catches the mountains' bases so they appear to
  // rise from a shared ink-wash ground rather than floating.
  const groundGeometry = useMemo(() => new THREE.CircleGeometry(8, 64), []);
  const groundUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: PALETTE.soot.clone() }
    }),
    []
  );

  useFrame((state) => {
    groundUniforms.uTime.value = state.clock.elapsedTime;
  });

  return (
    <group position={[0, -0.2, 0]}>
      {/* Shared ground wash */}
      <mesh geometry={groundGeometry} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.05, 0]}>
        <meshBasicMaterial
          color={PALETTE.soot}
          transparent
          opacity={0.55}
          depthWrite={false}
        />
      </mesh>

      {instances.map((instance) => (
        <SingleMountain
          key={instance.assetId}
          instance={instance}
          liveQuotes={liveQuotes}
          highlighted={highlightedSet.has(instance.assetId)}
          animate={animate}
        />
      ))}
    </group>
  );
}
