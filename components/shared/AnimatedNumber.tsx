"use client";

import { useEffect, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "framer-motion";

// -----------------------------------------------------------------------------
// AnimatedNumber — a value that rolls smoothly from its previous value to the
// next instead of snapping, with a brief directional flash on change.
//
// Why: the quote stream polls every ~3s. Without this, price/change cells
// hard-cut on every tick, which reads as "frozen + stutter" rather than "live".
// A spring-driven roll + a 0.6s tint flash makes the data feel alive and
// signals direction at a glance, without breaking the restrained ink palette.
// -----------------------------------------------------------------------------

const FLASH_DURATION = 0.6;

type FlashTone = "up" | "down" | null;

function detectTone(previous: number, next: number): FlashTone {
  if (!Number.isFinite(next) || !Number.isFinite(previous)) return null;
  if (next > previous) return "up";
  if (next < previous) return "down";
  return null;
}

export interface AnimatedNumberProps {
  /** Target numeric value. Pass null/undefined to render "--". */
  value: number | null | undefined;
  /** Decimal digits to display. */
  digits?: number;
  /** Render as a signed percentage (prepends + on positives). */
  signed?: boolean;
  /** Suffix appended after the formatted number (e.g. "%"). */
  suffix?: string;
  /** Stiffness of the spring roll. Higher = snappier. Default 120. */
  stiffness?: number;
  /** When true, the flash tint follows the market palette (caller decides up/down
   * coloring). When false (default), up = acid green, down = cinnabar red. */
  className?: string;
}

function formatValue(value: number, digits: number, signed: boolean): string {
  if (!Number.isFinite(value)) return "--";
  const formatted = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: digits,
    minimumFractionDigits: value > 100 ? Math.min(2, digits) : digits,
  }).format(value);
  if (signed && value > 0) return `+${formatted}`;
  return formatted;
}

export function AnimatedNumber({
  value,
  digits = 2,
  signed = false,
  suffix = "",
  stiffness = 120,
  className,
}: AnimatedNumberProps) {
  const reduceMotion = useReducedMotion();
  const numericValue = Number.isFinite(value as number) ? (value as number) : 0;
  const hasValue = value !== null && value !== undefined && Number.isFinite(value);

  // The spring-tracked display value. On first mount it jumps straight to the
  // initial value; afterwards each new prop update eases toward it.
  const motionValue = useMotionValue(numericValue);
  const spring = useSpring(motionValue, {
    stiffness,
    damping: 20,
    mass: 0.4,
    restDelta: 0.001,
  });

  // Keep the motion value in sync with the latest prop. Without this, a
  // component that mounts with value=null/undefined (its motion value starts at
  // 0) would stay frozen on 0 even after a real value arrives — e.g. a price
  // cell that renders before the quote stream loads.
  useEffect(() => {
    motionValue.set(numericValue);
  }, [numericValue, motionValue]);

  // Track the last *committed* value so we can detect direction on each update.
  // We compare against the raw prop value, not the spring, so the flash fires
  // immediately on data arrival rather than waiting for the roll to finish.
  const previousPropRef = useRef(numericValue);
  const [flashTone, setFlashTone] = useState<FlashTone>(null);
  const flashKey = useRef(0);

  useEffect(() => {
    if (!hasValue) return;
    const tone = detectTone(previousPropRef.current, numericValue);
    previousPropRef.current = numericValue;
    if (tone && !reduceMotion) {
      flashKey.current += 1;
      setFlashTone(tone);
    }
  }, [numericValue, hasValue, reduceMotion]);

  // Formatted text driven by the spring so the digits roll smoothly.
  const text = useTransform(spring, (latest) => formatValue(latest, digits, signed) + suffix);

  // When reduced motion is requested, bypass the spring entirely — render the
  // raw value as plain text so nothing animates.
  if (reduceMotion || !hasValue) {
    return (
      <span className={className}>
        {hasValue ? formatValue(numericValue, digits, signed) + suffix : "--"}
      </span>
    );
  }

  return (
    <span className={className} style={{ position: "relative" }}>
      <motion.span>{text}</motion.span>
      <AnimatePresence>
        {flashTone && (
          <motion.span
            key={flashKey.current}
            aria-hidden="true"
            initial={{ opacity: 0.45 }}
            animate={{ opacity: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: FLASH_DURATION, ease: "easeOut" }}
            onAnimationComplete={() => setFlashTone(null)}
            style={{
              position: "absolute",
              inset: "0",
              borderRadius: "inherit",
              backgroundColor:
                flashTone === "up"
                  ? "rgba(127, 183, 163, 0.22)" // acid
                  : "rgba(223, 107, 85, 0.22)", // dangerline / cinnabar
              pointerEvents: "none",
            }}
          />
        )}
      </AnimatePresence>
    </span>
  );
}
