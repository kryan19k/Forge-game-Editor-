import type { EditorViewport } from './EditorViewport';

/** The single live viewport, for imperative calls from UI and commands (frame, capture, placement). */
export const viewportApi: { current: EditorViewport | null } = { current: null };
