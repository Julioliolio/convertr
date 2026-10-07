// Compile-time flag set in vite.config.ts: true for the GitHub Pages build
// (`--mode web`), where ffmpeg runs in-browser instead of on the local server.
// Branches on it are dead-code-eliminated from the other build.
declare const __WEB__: boolean;
