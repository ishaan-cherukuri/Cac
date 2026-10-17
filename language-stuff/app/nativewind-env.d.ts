/// <reference types="nativewind/types" />

// NativeWind consumes global.css through Metro, but TypeScript still needs to be told
// that a side-effect CSS import is legal.
declare module "*.css";
