import { platform } from "@tauri-apps/plugin-os";

const currentPlatform = platform();

export const isMobile =
  currentPlatform === "android" || currentPlatform === "ios";
export const isDesktop = !isMobile;
export const isMacOS = currentPlatform === "macos";
export const isAndroid = currentPlatform === "android";
export const isIOS = currentPlatform === "ios";
export { currentPlatform };
