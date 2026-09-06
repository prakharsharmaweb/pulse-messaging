"use client";

import { LazyMotion, domAnimation, MotionConfig } from "framer-motion";

/** Loads only the DOM animation feature set to keep the bundle small. */
export default function MotionProvider({ children }: { children: React.ReactNode }) {
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">{children}</MotionConfig>
    </LazyMotion>
  );
}
