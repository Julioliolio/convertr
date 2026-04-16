# Archived dev playgrounds

These five SolidJS views powered the in-app dev tab bar during cleanup. They
were moved out of `src/` on 2026-04-16 when the final app shipped, so they are
no longer compiled or imported. Kept here in case any of the experiments need
to be resurrected.

## Files and their original locations

| Archived file            | Original path                                       |
| ------------------------ | --------------------------------------------------- |
| PlaygroundView.tsx       | src/components/views/PlaygroundView.tsx             |
| SliderPlayground.tsx     | src/components/views/SliderPlayground.tsx           |
| LoadingPlayground.tsx    | src/components/views/LoadingPlayground.tsx          |
| DottedBgPlayground.tsx   | src/components/views/DottedBgPlayground.tsx         |
| CanvasPlayground.tsx     | src/components/views/CanvasPlayground.tsx           |

Relative imports inside these files (e.g. `../../shared/ui`) assume the
original locations above — restore them to `src/components/views/` before
wiring anything back into the app.

## Restoring

1. `git mv _archive/playground/<File>.tsx src/components/views/<File>.tsx`
2. Re-add the import and dev-tab entry in `src/App.tsx` (see
   commit that removed them for the exact shape of the `DevBar`).
3. Restore the `import.meta.env.DEV ? '20px' : '0'` bottom padding in
   `src/components/views/EditorView.tsx` if the dev bar is re-enabled.

`CtrlSlider` in `src/shared/ui.tsx` is the only shared helper these views
depend on and has been left in place.
