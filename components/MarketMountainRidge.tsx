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
// =============================================================================
// Ink-wash mountain shaders — rebuilt to read as real Chinese landscape painting.
//
// Research sources:
//   - 皴法 (texture strokes):披麻皴/斧劈皴 give mountains mass via directional
//     brush strokes along the slope, not flat shading.
//   - 层次远近 (depth layering): near mountains are dark and crisp, far ones
//     dissolve into mist — achieved via distance fog + atmospheric scattering.
//   - Heightmap displacement + analytic normals (Inigo Quilez raymarching/terrain):
//     fbm noise carves natural ridges; sampling neighbors gives the surface
//     normal so light wraps around the form instead of a flat-shaded cone.
// =============================================================================

// Shared noise so both shaders stay in sync. fbm (fractal Brownian motion)
// layers 5 octaves of value noise — the standard for natural terrain.
const noiseAndFbm = /* glsl */ `
  float hash21(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash21(i), hash21(i + vec2(1.0, 0.0)), f.x),
      mix(hash21(i + vec2(0.0, 1.0)), hash21(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }
  // 5-octave fbm with domain rotation — produces organic mountain ridgelines.
  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      value += amplitude * vnoise(p);
      p = rotation * p * 2.03 + 11.7;
      amplitude *= 0.5;
    }
    return value;
  }
`;

// The height function: a mountain shape driven by peak height, trend data
// (real intraday series modulating the ridge silhouette), volatility
// (jaggedness), and fbm for natural terrain detail. Shared between the vertex
// shader (displacement) and a tiny neighbor-sample for the normal.
const heightFunction = /* glsl */ `
  uniform float uPeakHeight;
  uniform float uVolatility;
  uniform float uTime;
  uniform sampler2D uTrendMap;

  float mountainHeight(vec2 local) {
    float radius = length(local);
    // Base mountain dome: tall narrow peak, broad foot. pow sharpens the summit.
    float dome = pow(max(0.0, 1.0 - radius * 0.85), 1.8);

    // Trend ridge: the real price path sculpts the skyline as you orbit.
    float angle = atan(local.y, local.x);
    float trendU = (angle + 3.14159) / 6.28318;
    float ridgeSample = texture2D(uTrendMap, vec2(trendU, radius)).r;
    float trendRidge = (ridgeSample - 0.5) * uVolatility * 2.4 * dome;

    // fbm terrain detail — multi-scale ridges and gullies. The first octave
    // gives major ridge lines; higher octaves add crags scaled by volatility.
    vec2 terrainUV = local * 2.2;
    float major = fbm(terrainUV + vec2(uTime * 0.02, 0.0));
    float minor = fbm(terrainUV * 3.5 - vec2(5.0, uTime * 0.015));
    float detail = (major - 0.5) * 1.6 + (minor - 0.5) * 0.7 * uVolatility;

    // Ridged noise: sharpen fbm into crests rather than rolling hills, so the
    // silhouette has the crisp peaks of an ink-wash mountain.
    float ridged = 1.0 - abs(major - 0.5) * 2.0;
    ridged = pow(ridged, 2.0) * uVolatility * 1.2;

    return dome * uPeakHeight + trendRidge + detail * dome * 0.8 + ridged * dome;
  }
`;

const mountainVertexShader = /* glsl */ `
  ${noiseAndFbm}
  ${heightFunction}
  attribute vec2 aLocal;

  varying float vHeight;
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    float h = mountainHeight(aLocal);
    vHeight = h;
    vLocal = aLocal;

    // Analytic normal: sample the height field at three nearby points and cross
    // the offsets. This is what gives the mountain real shading — without it the
    // surface is flat-shaded and reads as a cone, not stone.
    float eps = 0.04;
    float hx = mountainHeight(aLocal + vec2(eps, 0.0));
    float hz = mountainHeight(aLocal + vec2(0.0, eps));
    vec3 tangentX = normalize(vec3(eps, hx - h, 0.0));
    vec3 tangentZ = normalize(vec3(0.0, hz - h, eps));
    vec3 normal = normalize(cross(tangentZ, tangentX));

    vec3 displaced = position + vec3(0.0, h, 0.0);
    vec4 worldPos = modelMatrix * vec4(displaced, 1.0);
    vWorldPos = worldPos.xyz;
    vNormal = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * worldPos;
  }
`;

const mountainFragmentShader = /* glsl */ `
  precision highp float;
  ${noiseAndFbm}

  uniform vec3 uColorUp;
  uniform vec3 uColorDown;
  uniform float uChange;       // signed changePct, drives color blend
  uniform float uPeakHeight;
  uniform float uVolatility;   // day range → how jagged the stroke texture is
  uniform float uTime;
  uniform vec3 uCameraPos;
  uniform vec3 uFogColor;

  varying float vHeight;
  varying vec2 vLocal;
  varying vec3 vWorldPos;
  varying vec3 vNormal;

  void main() {
    float heightRatio = uPeakHeight > 0.01 ? clamp(vHeight / (uPeakHeight * 1.25), 0.0, 1.0) : 0.0;

    // ---- Directional lighting (dramatic chiaroscuro) ----
    // Strong contrast between sunlit and shadowed faces is what gives a mountain
    // mass. Low ambient so shadows go deep; high diffuse so lit faces glow.
    vec3 lightDir = normalize(vec3(-0.5, 0.72, 0.48));
    float diffuse = max(dot(vNormal, lightDir), 0.0);
    // Wrap lighting so the terminator (day/night boundary) is soft, not a hard line.
    float wrapDiffuse = max(dot(vNormal, lightDir) * 0.5 + 0.5, 0.0);
    float ambient = 0.16 + 0.12 * vNormal.y;
    float light = ambient + wrapDiffuse * 1.25 + diffuse * 0.3;

    // Specular sheen on the crest where the surface faces the light — reads as
    // light catching a rocky ridge.
    vec3 halfDir = normalize(lightDir + normalize(uCameraPos - vWorldPos));
    float spec = pow(max(dot(vNormal, halfDir), 0.0), 12.0);

    // Rim light along the silhouette edges.
    vec3 viewDir = normalize(uCameraPos - vWorldPos);
    float rim = pow(1.0 - max(dot(vNormal, viewDir), 0.0), 2.5);

    // ---- Base color by direction + height ----
    float dir = clamp(uChange / 4.0, -1.0, 1.0);
    vec3 upTint = mix(vec3(0.229, 0.302, 0.259), uColorUp, 0.75);
    vec3 downTint = mix(vec3(0.229, 0.302, 0.259), uColorDown, 0.75);
    vec3 dirColor = mix(vec3(0.229, 0.302, 0.259), upTint, max(0.0, dir));
    dirColor = mix(dirColor, downTint, max(0.0, -dir));

    // Vertical stratigraphy: deep ink base, mineral mid, pale crest.
    vec3 footColor = vec3(0.024, 0.032, 0.028);
    vec3 crestColor = vec3(0.85, 0.82, 0.72);
    vec3 heightColor = mix(footColor, dirColor, smoothstep(0.0, 0.55, heightRatio));
    heightColor = mix(heightColor, crestColor, smoothstep(0.7, 1.0, heightRatio) * 0.55);

    vec3 color = heightColor * light;
    color += crestColor * spec * 0.35 * smoothstep(0.4, 1.0, heightRatio);

    // ---- 皴法 (cūn fǎ) brush-stroke texture ----
    // Two layers of stroke texture give the surface the look of painted stone.
    float slope = 1.0 - vNormal.y;

    // (a) Hemp-fibre strokes (披麻皴): narrow high-frequency radial lines warped
    // by fbm. Use a sharp ridge (abs(sin)) so each stroke is a thin dark vein,
    // not a broad band — reads as individual brush drags down the rock face.
    float strokeAngle = atan(vLocal.y, vLocal.x);
    float radialDist = length(vLocal);
    float lineWarp = fbm(vLocal * 4.0 + uTime * 0.02) * 2.0;
    float hempRaw = abs(sin((strokeAngle + lineWarp) * 40.0 + radialDist * 28.0));
    float hempLines = 1.0 - smoothstep(0.0, 0.22, hempRaw);

    // (b) Axe-cut blocks (斧劈皴): faceted steps via quantized fbm, giving
    // chunky rock shelves rather than smooth noise.
    float axeNoise = fbm(vLocal * (10.0 + uVolatility * 18.0));
    float axeCut = step(0.52, axeNoise) * smoothstep(0.48, 0.6, axeNoise);

    // Combine with a strong slope mask — strokes bite hardest on steep rock.
    float strokeMask = pow(slope, 0.6) * (0.65 + 0.35 * (1.0 - heightRatio));
    float inkStrokes = clamp(mix(hempLines, axeCut, 0.5) * strokeMask, 0.0, 1.0);

    // Ink tones with deep contrast:浓墨 (deep) to 淡墨 (light wash).
    float inkTone = mix(0.28, 0.95, fbm(vLocal * 5.0));
    color *= 1.0 - inkStrokes * (1.0 - inkTone) * 1.05;
    // Dry-brush highlights on ridge-facing strokes.
    color += crestColor * inkStrokes * heightRatio * abs(dir) * 0.15;

    // Fine paper-fibre grain across the whole surface.
    float fibre = hash21(vLocal * 320.0) - 0.5;
    color += vec3(0.76, 0.73, 0.65) * fibre * 0.025;

    // Crest highlight + rim glow — brighter so peaks read against the dark sky.
    color += crestColor * rim * 0.28;

    // ---- Atmospheric depth (层次远近) ----
    // Distance fog dissolves far mountains into the background haze, and a
    // vertical mist band (山腰云雾) breaks the mid-section like classical
    // ink-wash "leaving blank" (留白). Stronger falloff so the depth reads.
    float dist = length(uCameraPos - vWorldPos);
    float fogFactor = 1.0 - exp(-pow(dist * 0.11, 2.0));
    color = mix(color, uFogColor, fogFactor * 0.78);

    // Mid-mountain mist band — a horizontal belt of fog around half height,
    // so the peak floats above the cloud and the foot sinks below it. The
    // band drifts and varies in density, breaking the silhouette naturally.
    float mistBand = exp(-pow((heightRatio - 0.45) * 2.8, 2.0));
    float mistNoise = 0.35 + 0.65 * fbm(vLocal * 3.5 + vec2(uTime * 0.04, 0.0));
    color = mix(color, uFogColor * 1.12, mistBand * mistNoise * 0.55);

    // Low ground fog pooling at the foot, where the mountain meets the ground.
    float groundFog = smoothstep(0.2, 0.0, heightRatio) * (0.4 + 0.6 * fbm(vLocal * 5.0 - uTime * 0.02));
    color = mix(color, uFogColor * 0.9, groundFog * 0.3);

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
      uColorDown: { value: PALETTE.cinnabar.clone() },
      uCameraPos: { value: new THREE.Vector3(0, 5, 7) },
      uFogColor: { value: new THREE.Color("#070906") }
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  // Higher-density geometry so the fbm displacement and analytic normals have
  // enough vertices to express real ridge detail (48² → 96²).
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(2, 2, 96, 96);
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
    const targetPeak = Math.max(0.6, Math.min(4.5, (Math.abs(live?.changePct ?? instance.change) / 5) * 3.4 + 0.6));
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
      // Keep the fog/lighting camera-aware so rim + atmospheric depth track
      // the orbiting viewpoint.
      uniforms.uCameraPos.value.copy(state.camera.position);
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
        baseScale: 1.15 + asset.liquidity * 1.1,
        trendTexture: buildTrendTexture(asset.trend),
        peakHeight: Math.max(0.6, Math.min(4.5, asset.heat * 3.4 + 0.6)),
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

  // Distant ridge silhouettes — two rings of low, hazy mountains behind the
  // main peaks. They add the layer depth (层峦叠嶂) that ink-wash landscapes
  // rely on: near peaks are crisp and dark, far ones fade into the mist.
  const distantRidgeUniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uColor: { value: new THREE.Color("#0d1310") },
      uMist: { value: new THREE.Color("#070906") }
    }),
    []
  );
  const distantRidgeRef = useRef<THREE.ShaderMaterial>(null);
  const distantRidgeGeometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(26, 8, 200, 48);
    geo.rotateX(-Math.PI / 2);
    return geo;
  }, []);

  useFrame((state) => {
    groundUniforms.uTime.value = state.clock.elapsedTime;
    if (distantRidgeRef.current) {
      distantRidgeRef.current.uniforms.uTime.value = state.clock.elapsedTime;
    }
  });

  const distantRidgeVertex = useMemo(() => /* glsl */ `
    ${noiseAndFbm}
    uniform float uTime;
    varying float vH;
    varying vec2 vUv;
    void main() {
      vUv = uv;
      // A long ridge line: fbm carves a mountain skyline along X, repeated
      // octaves add foothills. Keep it low so it reads as distant.
      vec2 p = vec2(uv.x * 8.0 + uTime * 0.01, uv.y);
      float ridge = fbm(p) * 0.7 + fbm(p * 3.0) * 0.3;
      float h = pow(ridge, 1.4) * 2.6;
      vH = h;
      vec3 displaced = position + vec3(0.0, h, 0.0);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
    }
  `, [noiseAndFbm]);

  const distantRidgeFragment = useMemo(() => /* glsl */ `
    precision highp float;
    uniform vec3 uColor;
    uniform vec3 uMist;
    varying float vH;
    varying vec2 vUv;
    void main() {
      // Fade the ridge into mist by height and by horizontal position so the
      // edges dissolve — the classic "mountains emerging from clouds" effect.
      float alpha = smoothstep(0.0, 0.4, vH) * 0.85;
      alpha *= smoothstep(0.0, 0.15, vUv.x) * smoothstep(1.0, 0.85, vUv.x);
      vec3 c = mix(uMist, uColor, smoothstep(0.0, 0.6, vH));
      gl_FragColor = vec4(c, alpha);
    }
  `, []);

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

      {/* Distant ridge silhouettes — two layers for depth. */}
      <mesh geometry={distantRidgeGeometry} position={[0, 0.3, -7]}>
        <shaderMaterial
          vertexShader={distantRidgeVertex}
          fragmentShader={distantRidgeFragment}
          uniforms={distantRidgeUniforms}
          transparent
          depthWrite={false}
        />
      </mesh>
      <mesh geometry={distantRidgeGeometry} position={[2, 0.1, -5.5]}>
        <shaderMaterial
          vertexShader={distantRidgeVertex}
          fragmentShader={distantRidgeFragment}
          uniforms={distantRidgeUniforms}
          transparent
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
