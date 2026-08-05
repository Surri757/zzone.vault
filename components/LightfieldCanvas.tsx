"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Html, OrbitControls } from "@react-three/drei";
import { useReducedMotion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { Asset } from "@/lib/types";
import { MarketMountainRidge } from "@/components/MarketMountainRidge";
import { MarketFlowField } from "@/components/MarketFlowField";
import { FocusPulseRing } from "@/components/FocusPulseRing";

interface StockNode3D {
  id: string;
  position: THREE.Vector3;
  color: string;
}

export interface LightfieldCanvasProps {
  assets: Asset[];
  interactive?: boolean;
  onAssetSelect?: (assetId: string) => void;
  highlightedIds?: string[];
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
}

const inkVertexShader = `
  varying vec2 vUv;

  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const inkFragmentShader = `
  precision highp float;

  varying vec2 vUv;
  uniform float uTime;
  uniform float uAspect;
  uniform vec2 uPointer;

  float hash(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
      f.y
    );
  }

  float fbm(vec2 p) {
    float value = 0.0;
    float amplitude = 0.5;
    mat2 rotation = mat2(0.80, 0.60, -0.60, 0.80);
    for (int i = 0; i < 5; i++) {
      value += amplitude * noise(p);
      p = rotation * p * 2.03 + 11.7;
      amplitude *= 0.5;
    }
    return value;
  }

  void main() {
    vec2 uv = vUv;
    vec2 field = vec2((uv.x - 0.5) * uAspect, uv.y);
    float drift = uTime * 0.018;

    vec3 carbon = vec3(0.026, 0.032, 0.025);
    vec3 soot = vec3(0.075, 0.086, 0.071);
    vec3 mineral = vec3(0.25, 0.32, 0.27);
    vec3 parchment = vec3(0.76, 0.73, 0.65);
    vec3 cinnabar = vec3(0.79, 0.25, 0.16);
    vec3 color = carbon;

    float broadWash = fbm(field * vec2(1.55, 1.15) + vec2(drift, -drift * 0.22));
    color = mix(color, soot, smoothstep(0.38, 0.86, broadWash) * 0.68);

    float backRidge = 0.40
      + fbm(vec2(field.x * 1.65 + 8.0, drift * 0.35)) * 0.17
      + sin(field.x * 2.8 + 1.2) * 0.035;
    float midRidge = 0.29
      + fbm(vec2(field.x * 2.55 + 21.0, drift * 0.18)) * 0.16
      + sin(field.x * 4.2) * 0.025;
    float nearRidge = 0.17
      + fbm(vec2(field.x * 3.35 + 42.0, drift * 0.12)) * 0.18;

    float backMountain = 1.0 - smoothstep(backRidge - 0.025, backRidge + 0.045, uv.y);
    float midMountain = 1.0 - smoothstep(midRidge - 0.020, midRidge + 0.035, uv.y);
    float nearMountain = 1.0 - smoothstep(nearRidge - 0.018, nearRidge + 0.030, uv.y);

    color = mix(color, mineral, backMountain * 0.27);
    color = mix(color, soot, midMountain * 0.82);
    color *= 1.0 - nearMountain * 0.28;

    float backContour = 1.0 - smoothstep(0.0, 0.010, abs(uv.y - backRidge));
    float midContour = 1.0 - smoothstep(0.0, 0.006, abs(uv.y - midRidge));
    color += parchment * (backContour * 0.075 + midContour * 0.045);

    float mistShape = uv.y - 0.48 + (fbm(vec2(field.x * 1.8, drift * 0.4)) - 0.5) * 0.12;
    float mist = exp(-mistShape * mistShape * 62.0);
    float mistBreak = smoothstep(0.25, 0.82, fbm(field * vec2(3.2, 1.4) - drift));
    color += parchment * mist * mistBreak * 0.105;

    vec2 pointer = vec2(uPointer.x * 0.16 * uAspect, uPointer.y * 0.10 + 0.52);
    float pointerFlow = fbm((field - pointer) * 4.0 + vec2(-drift * 2.0, drift));
    float inkFlow = smoothstep(0.54, 0.78, pointerFlow) * (0.36 + 0.64 * uv.y);
    color += mineral * inkFlow * 0.052;

    float sealTrace = 1.0 - smoothstep(
      0.0,
      0.0035,
      abs(uv.y - (0.715 + sin(field.x * 5.5 + drift) * 0.008))
    );
    float sealMask = smoothstep(0.18, 0.30, uv.x) * (1.0 - smoothstep(0.48, 0.68, uv.x));
    color += cinnabar * sealTrace * sealMask * 0.17;

    float fibre = noise(uv * vec2(920.0, 510.0) + uTime * 0.004) - 0.5;
    float verticalFibre = noise(vec2(uv.x * 1600.0, uv.y * 74.0)) - 0.5;
    color += parchment * fibre * 0.018;
    color += parchment * verticalFibre * 0.006;

    float vignette = 1.0 - smoothstep(0.18, 0.92, length((uv - 0.5) * vec2(0.82, 1.0)));
    color *= 0.78 + vignette * 0.22;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function seededRandom(seed: number) {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
}

function generateNodes(assets: Asset[]) {
  const palette = ["#7fb7a3", "#d8d0bd", "#bc9858", "#526d62", "#d45a42"];
  const nodes: StockNode3D[] = [];

  assets.forEach((asset, assetIndex) => {
    const radius = 1.65 + asset.heat * 2.0;
    const angleOffset = (assetIndex / assets.length) * Math.PI * 2;

    asset.trend.forEach((value, trendIndex) => {
      const angle = angleOffset + trendIndex * 0.19;
      const normalized = value / 100;
      const taper = 0.74 + trendIndex / Math.max(asset.trend.length, 1) * 0.32;
      nodes.push({
        id: asset.id,
        position: new THREE.Vector3(
          Math.cos(angle) * radius * taper + (normalized - 0.5) * 1.3,
          (trendIndex - asset.trend.length / 2) * 0.145 + Math.sin(angle * 0.7) * 0.18,
          Math.sin(angle) * radius * 0.8 + (asset.change24h / 100) * 2.7
        ),
        color: palette[(assetIndex + trendIndex) % palette.length]
      });
    });
  });

  return nodes;
}

function InkWashField({ animate }: { animate: boolean }) {
  const materialRef = useRef<THREE.ShaderMaterial>(null);
  const pointerTargetRef = useRef(new THREE.Vector2());
  const { size } = useThree();

  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uAspect: { value: 1 },
      uPointer: { value: new THREE.Vector2() }
    }),
    []
  );

  useEffect(() => {
    function updatePointer(event: PointerEvent) {
      pointerTargetRef.current.set(
        (event.clientX / Math.max(window.innerWidth, 1)) * 2 - 1,
        1 - (event.clientY / Math.max(window.innerHeight, 1)) * 2
      );
    }

    window.addEventListener("pointermove", updatePointer, { passive: true });
    return () => window.removeEventListener("pointermove", updatePointer);
  }, []);

  useFrame((state, delta) => {
    if (!materialRef.current) return;
    if (animate) {
      materialRef.current.uniforms.uTime.value = state.clock.elapsedTime;
      materialRef.current.uniforms.uPointer.value.x = THREE.MathUtils.damp(
        materialRef.current.uniforms.uPointer.value.x,
        pointerTargetRef.current.x,
        2.8,
        delta
      );
      materialRef.current.uniforms.uPointer.value.y = THREE.MathUtils.damp(
        materialRef.current.uniforms.uPointer.value.y,
        pointerTargetRef.current.y,
        2.8,
        delta
      );
    }
    materialRef.current.uniforms.uAspect.value = size.width / Math.max(size.height, 1);
  });

  return (
    <mesh position={[0, 0, -6]} scale={[32, 19, 1]} frustumCulled={false}>
      <planeGeometry args={[1, 1]} />
      <shaderMaterial
        ref={materialRef}
        vertexShader={inkVertexShader}
        fragmentShader={inkFragmentShader}
        uniforms={uniforms}
        depthWrite={false}
        depthTest={false}
      />
    </mesh>
  );
}

function InkContours({ animate }: { animate: boolean }) {
  const groupRef = useRef<THREE.Group>(null);
  const contours = useMemo(() => {
    return Array.from({ length: 5 }, (_, contourIndex) => {
      const points = Array.from({ length: 8 }, (_, pointIndex) => {
        const x = -6.5 + pointIndex * 1.85;
        const wave = Math.sin(pointIndex * 0.9 + contourIndex * 1.35) * 0.35;
        const jitter = (seededRandom(contourIndex * 31 + pointIndex * 7) - 0.5) * 0.44;
        return new THREE.Vector3(
          x,
          -1.7 + contourIndex * 0.34 + wave + jitter,
          -1.2 + contourIndex * 0.38
        );
      });
      return new THREE.CatmullRomCurve3(points).getPoints(96);
    });
  }, []);

  useFrame((state) => {
    if (!groupRef.current || !animate) return;
    groupRef.current.position.x = Math.sin(state.clock.elapsedTime * 0.055) * 0.15;
    groupRef.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.08) * 0.006;
  });

  return (
    <group ref={groupRef}>
      {contours.map((points, index) => (
        <line key={index}>
          <bufferGeometry attach="geometry" setFromPoints={points} />
          <lineBasicMaterial
            attach="material"
            color={index === 3 ? "#8f4637" : "#82988d"}
            transparent
            opacity={index === 3 ? 0.12 : 0.07 + index * 0.012}
            depthWrite={false}
          />
        </line>
      ))}
    </group>
  );
}

function AssetInkTrails({
  assets,
  interactive,
  animate,
  highlightedIds = [],
  liveQuotes,
  onAssetSelect
}: {
  assets: Asset[];
  interactive: boolean;
  animate: boolean;
  highlightedIds?: string[];
  liveQuotes?: Map<string, { changePct: number | null; price: number | null }>;
  onAssetSelect?: (assetId: string) => void;
}) {
  const pointsRef = useRef<THREE.Points>(null);
  const trailsRef = useRef<THREE.Group>(null);
  const lastRaycastRef = useRef(0);
  const hoveredIdRef = useRef<string | null>(null);
  // Static baselines (original z + base color) so the frame loop can apply a
  // live changePct offset on top without accumulating drift each frame.
  const basePositionsRef = useRef<Float32Array>(new Float32Array(0));
  const baseColorsRef = useRef<Float32Array>(new Float32Array(0));
  const { camera, raycaster, pointer, gl } = useThree();
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [hoveredPos, setHoveredPos] = useState<THREE.Vector3 | null>(null);
  const [supportsHover, setSupportsHover] = useState(false);

  useEffect(() => {
    const pointerQuery = window.matchMedia("(hover: hover) and (pointer: fine)");
    const updateCapability = () => setSupportsHover(pointerQuery.matches && window.innerWidth >= 768);
    updateCapability();
    pointerQuery.addEventListener("change", updateCapability);
    window.addEventListener("resize", updateCapability);
    return () => {
      pointerQuery.removeEventListener("change", updateCapability);
      window.removeEventListener("resize", updateCapability);
    };
  }, []);

  useEffect(() => {
    if (supportsHover) return;
    hoveredIdRef.current = null;
    setHoveredId(null);
    setHoveredPos(null);
    gl.domElement.style.cursor = interactive ? "grab" : "default";
  }, [gl, interactive, supportsHover]);

  const { nodes, positions, colors, trails, assetNodeRanges } = useMemo(() => {
    const generated = generateNodes(assets);
    const positionValues: number[] = [];
    const colorValues: number[] = [];
    const grouped = new Map<string, THREE.Vector3[]>();
    const trailColors = new Map<string, string>();
    // Track each asset's contiguous vertex slice so the frame loop can offset
    // just that asset's particles by its live changePct (rise on up, sink on
    // down) without re-generating the whole cloud every tick.
    const ranges = new Map<string, { start: number; count: number; baseColor: THREE.Color }>();
    let cursor = 0;
    const seen = new Set<string>();

    generated.forEach((node) => {
      if (!seen.has(node.id)) {
        seen.add(node.id);
        ranges.set(node.id, {
          start: cursor,
          count: 0,
          baseColor: new THREE.Color(node.color)
        });
      }
      const range = ranges.get(node.id)!;
      range.count += 1;

      positionValues.push(node.position.x, node.position.y, node.position.z);
      const color = new THREE.Color(node.color);
      colorValues.push(color.r, color.g, color.b);
      const trail = grouped.get(node.id) ?? [];
      trail.push(node.position);
      grouped.set(node.id, trail);
      trailColors.set(node.id, node.color);
      cursor += 1;
    });

    return {
      nodes: generated,
      positions: new Float32Array(positionValues),
      colors: new Float32Array(colorValues),
      trails: assets.map((asset) => ({
        assetId: asset.id,
        points: grouped.get(asset.id) ?? [],
        color: trailColors.get(asset.id) ?? "#82988d"
      })),
      assetNodeRanges: ranges
    };
  }, [assets]);

  const highlightedSet = useMemo(() => new Set(highlightedIds), [highlightedIds]);

  // Refresh baselines whenever the generated geometry changes (new assets).
  useEffect(() => {
    basePositionsRef.current = positions.slice();
    baseColorsRef.current = colors.slice();
  }, [positions, colors]);

  // Reusable color scratch objects (avoid per-frame allocation).
  const acidColor = useMemo(() => new THREE.Color("#7fb7a3"), []);
  const cinnabarColor = useMemo(() => new THREE.Color("#d45a42"), []);
  const scratchColor = useMemo(() => new THREE.Color(), []);

  useFrame((state, delta) => {
    // Live data-driven particle motion: each asset's particle slice rises or
    // sinks with its real-time changePct, glows toward the market tone color,
    // and pulses faster the larger the move. This is what makes the field feel
    // "breathing with the market" instead of a static decoration.
    if (animate && pointsRef.current) {
      const geom = pointsRef.current.geometry;
      const posAttr = geom.getAttribute("position") as THREE.BufferAttribute | undefined;
      const colAttr = geom.getAttribute("color") as THREE.BufferAttribute | undefined;
      const basePos = basePositionsRef.current;
      const baseCol = baseColorsRef.current;

      if (posAttr && colAttr && basePos && baseCol) {
        const t = state.clock.elapsedTime;
        for (const [assetId, range] of assetNodeRanges) {
          const live = liveQuotes?.get(assetId);
          const changePct = live?.changePct ?? 0;
          // Vertical lift driven by sign/magnitude of the move (clamped), plus a
          // gentle breathing oscillation whose speed scales with volatility.
          const lift = Math.max(-2.4, Math.min(2.4, changePct / 100 * 2.7));
          const pulseSpeed = 0.5 + Math.min(Math.abs(changePct) / 6, 2.2);
          const pulse = Math.sin(t * pulseSpeed + range.start * 0.3) * 0.06;
          const zOffset = lift + pulse;

          // Color bias: blend the base color toward acid (up) or cinnabar (down)
          // proportional to move size, capped so the palette stays restrained.
          const intensity = Math.min(Math.abs(changePct) / 4, 0.5);
          const target = changePct >= 0 ? acidColor : cinnabarColor;

          for (let i = 0; i < range.count; i++) {
            const vIdx = range.start + i;
            const pIdx = vIdx * 3;
            posAttr.array[pIdx + 2] = basePos[pIdx + 2] + zOffset;
            if (intensity > 0.01) {
              scratchColor
                .setRGB(baseCol[pIdx], baseCol[pIdx + 1], baseCol[pIdx + 2])
                .lerp(target, intensity);
              colAttr.array[pIdx] = scratchColor.r;
              colAttr.array[pIdx + 1] = scratchColor.g;
              colAttr.array[pIdx + 2] = scratchColor.b;
            } else {
              colAttr.array[pIdx] = baseCol[pIdx];
              colAttr.array[pIdx + 1] = baseCol[pIdx + 1];
              colAttr.array[pIdx + 2] = baseCol[pIdx + 2];
            }
          }
        }
        posAttr.needsUpdate = true;
        colAttr.needsUpdate = true;
      }

      if (pointsRef.current) {
        pointsRef.current.rotation.y += delta * 0.055;
        pointsRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.12) * 0.018;
      }
      if (trailsRef.current) {
        trailsRef.current.rotation.y -= delta * 0.032;
        trailsRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.18) * 0.055;
      }
    }

    if (
      !interactive ||
      !supportsHover ||
      !pointsRef.current ||
      state.clock.elapsedTime - lastRaycastRef.current < 0.075
    ) {
      return;
    }

    lastRaycastRef.current = state.clock.elapsedTime;
    raycaster.params.Points.threshold = 0.16;
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObject(pointsRef.current, false)[0];
    const node = hit?.index === undefined ? undefined : nodes[hit.index];
    const nextId = node?.id ?? null;

    if (nextId !== hoveredIdRef.current) {
      hoveredIdRef.current = nextId;
      setHoveredId(nextId);
      setHoveredPos(node?.position.clone() ?? null);
      gl.domElement.style.cursor = nextId ? "pointer" : "grab";
    }
  });

  const handleClick = useCallback(() => {
    if (hoveredId && onAssetSelect) onAssetSelect(hoveredId);
  }, [hoveredId, onAssetSelect]);

  return (
    <group onClick={handleClick} position={[0.8, 0.2, 0]}>
      <points ref={pointsRef}>
        <bufferGeometry>
          <bufferAttribute attach="attributes-position" args={[positions, 3]} />
          <bufferAttribute attach="attributes-color" args={[colors, 3]} />
        </bufferGeometry>
        <pointsMaterial
          size={interactive ? 0.052 : 0.04}
          vertexColors
          transparent
          opacity={interactive ? 0.68 : 0.46}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
          sizeAttenuation
        />
      </points>

      <group ref={trailsRef}>
        {trails.map((trail) => {
          const highlighted = highlightedSet.has(trail.assetId);
          return (
            <line key={trail.assetId}>
              <bufferGeometry attach="geometry" setFromPoints={trail.points} />
              <lineBasicMaterial
                attach="material"
                color={highlighted ? "#d45a42" : trail.color}
                transparent
                opacity={highlighted ? 0.68 : 0.19}
                depthWrite={false}
              />
            </line>
          );
        })}
      </group>

      {hoveredId && hoveredPos && (
        <Html position={[hoveredPos.x, hoveredPos.y + 0.28, hoveredPos.z]} center>
          <div className="ink-panel pointer-events-none whitespace-nowrap px-3 py-2 font-mono text-xs text-ink">
            {(() => {
              const asset = assets.find((item) => item.id === hoveredId);
              const liveData = liveQuotes?.get(hoveredId);
              const changePct = liveData?.changePct ?? asset?.change24h ?? 0;
              return (
                <>
                  <span className="text-acid">{asset?.symbol ?? hoveredId}</span>
                  <span className="ml-2 text-white/52">{asset?.name}</span>
                  <span className={changePct >= 0 ? "ml-2 text-acid" : "ml-2 text-dangerline"}>
                    {changePct >= 0 ? "+" : ""}
                    {changePct.toFixed(2)}%
                  </span>
                </>
              );
            })()}
          </div>
        </Html>
      )}
    </group>
  );
}

export function LightfieldCanvas({
  assets,
  interactive = false,
  onAssetSelect,
  highlightedIds,
  liveQuotes
}: LightfieldCanvasProps) {
  const reduceMotion = Boolean(useReducedMotion());

  return (
    <div
      className={`fixed inset-0 z-0 ${interactive ? "pointer-events-auto" : "pointer-events-none"}`}
      style={{ touchAction: "pan-y" }}
      aria-hidden="true"
    >
      <Canvas
        camera={{ position: [0, 5.4, 6.2], fov: 50 }}
        dpr={[1, 1.5]}
        frameloop={reduceMotion ? "demand" : "always"}
        gl={{ antialias: true, alpha: false, powerPreference: "high-performance" }}
      >
        <color attach="background" args={["#070906"]} />
        <fog attach="fog" args={["#070906", 7, 17]} />
        <InkWashField animate={!reduceMotion} />
        <InkContours animate={!reduceMotion} />
        {/* The market as a living mountain range — data-carved, breathing each tick. */}
        <MarketMountainRidge
          assets={assets}
          liveQuotes={liveQuotes}
          highlightedIds={highlightedIds}
          animate={!reduceMotion}
        />
        {/* Data river + force-field particles — currents flowing around the range. */}
        <MarketFlowField assets={assets} liveQuotes={liveQuotes} animate={!reduceMotion} />
        {/* Focus halo — rises above the selected stock's peak, pulsing with ticks. */}
        <FocusPulseRing
          assets={assets}
          liveQuotes={liveQuotes}
          highlightedIds={highlightedIds}
          animate={!reduceMotion}
        />
        <AssetInkTrails
          assets={assets}
          interactive={interactive}
          animate={!reduceMotion}
          highlightedIds={highlightedIds}
          liveQuotes={liveQuotes}
          onAssetSelect={onAssetSelect}
        />
        {interactive && (
          <OrbitControls
            enableDamping
            dampingFactor={0.06}
            enablePan={false}
            enableZoom={false}
            rotateSpeed={0.32}
            autoRotate={!reduceMotion}
            autoRotateSpeed={0.18}
            maxPolarAngle={Math.PI * 0.62}
            minPolarAngle={Math.PI * 0.18}
          />
        )}
      </Canvas>
    </div>
  );
}
