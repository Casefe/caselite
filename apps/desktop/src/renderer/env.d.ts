// Forge injects these constants into the main process bundle at build time.
// They do not expose a runtime bridge or any Node capability to the renderer.
declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;
