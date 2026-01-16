// TODO: Replace these stubs with production implementations as needed.
export function abs(path: string) { return path; }
export function readProcessingSetting(_boardKey: string, _globalKey: string) { return false; }
export function readVideoPreset(_boardKey: string, _globalKey: string): VideoPreset { return "standard"; }
export function ecKeyBoard(_boardId: string) { return ""; }
export function ecKeyGlobal() { return ""; }
export function nsKeyBoard(_boardId: string) { return ""; }
export function nsKeyGlobal() { return ""; }
export function agcKeyBoard(_boardId: string) { return ""; }
export function agcKeyGlobal() { return ""; }
export function videoPresetKeyBoard(_boardId: string) { return ""; }
export function videoPresetKeyGlobal() { return ""; }
export type QualityLevel = "low" | "medium" | "high" | "unknown";
export type VideoPreset = "low" | "standard" | "high";
export function attachLocalPreview() {/* TODO: implement */}
export function detachMeter() {/* TODO: implement */}
export function readMicDevice() {/* TODO: implement */}
export function readCamDevice() {/* TODO: implement */}
