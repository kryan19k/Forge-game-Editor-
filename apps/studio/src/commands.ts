import { addRecipe, deleteSelection, duplicateSelection, RECIPES, toggleFlag } from './state/ops';
import { redo, select, send, undo, useStudio } from './state/store';
import { stopPlay, togglePlay, usePlay } from './state/play';
import { viewportApi } from './viewport/api';

export interface Command {
  id: string;
  group: string;
  label: string;
  keys?: string;
  run: () => void;
  enabled?: () => boolean;
}

const hasSel = () => useStudio.getState().selection.length > 0;
const place = () => viewportApi.current?.placementPoint() ?? [0, 0, 0];

export const COMMANDS: Command[] = [
  { id: 'play', group: 'Play', label: 'Play in editor / stop', keys: 'Ctrl P', run: togglePlay },
  { id: 'undo', group: 'Edit', label: 'Undo', keys: 'Ctrl Z', run: undo },
  { id: 'redo', group: 'Edit', label: 'Redo', keys: 'Ctrl ⇧ Z', run: redo },
  { id: 'dup', group: 'Edit', label: 'Duplicate selection', keys: 'Ctrl D', run: duplicateSelection, enabled: hasSel },
  { id: 'del', group: 'Edit', label: 'Delete selection', keys: 'Del', run: deleteSelection, enabled: hasSel },
  { id: 'lock', group: 'Edit', label: 'Lock / unlock selection from agents', keys: 'L', run: () => toggleFlag(useStudio.getState().selection, 'locked'), enabled: hasSel },
  { id: 'hide', group: 'Edit', label: 'Hide / show selection', keys: 'H', run: () => toggleFlag(useStudio.getState().selection, 'visible'), enabled: hasSel },
  { id: 'rename', group: 'Edit', label: 'Rename', keys: 'F2', run: () => useStudio.setState({ renamingId: useStudio.getState().selection[0] ?? null }), enabled: () => useStudio.getState().selection.length === 1 },
  { id: 'deselect', group: 'Edit', label: 'Clear selection', keys: 'Esc', run: () => select([]) },
  { id: 'all', group: 'Edit', label: 'Select all', keys: 'Ctrl A', run: () => select(Object.keys(useStudio.getState().scene?.entities ?? {})) },
  { id: 'frame', group: 'View', label: 'Frame selection', keys: 'F', run: () => viewportApi.current?.frame() },
  { id: 'frameall', group: 'View', label: 'Frame whole scene', keys: 'Shift F', run: () => viewportApi.current?.frame([]) },
  { id: 'move', group: 'Tool', label: 'Move tool', keys: 'W', run: () => useStudio.setState({ gizmo: 'translate' }) },
  { id: 'rotate', group: 'Tool', label: 'Rotate tool', keys: 'E', run: () => useStudio.setState({ gizmo: 'rotate' }) },
  { id: 'scale', group: 'Tool', label: 'Scale tool', keys: 'R', run: () => useStudio.setState({ gizmo: 'scale' }) },
  { id: 'snap', group: 'Tool', label: 'Toggle snapping', keys: 'X', run: () => useStudio.setState((s) => ({ snap: !s.snap })) },
  { id: 'space', group: 'Tool', label: 'Toggle world / local space', keys: 'Q', run: () => useStudio.setState((s) => ({ space: s.space === 'world' ? 'local' : 'world' })) },
  ...RECIPES.flatMap((g) => g.items.map<Command>((i) => ({ id: `add:${i.id}`, group: 'Add', label: `Add ${i.label.toLowerCase()}`, run: () => addRecipe(i.id, place()) }))),
];

export function directiveCommand(text: string): Command {
  return {
    id: 'directive',
    group: 'Crew',
    label: `Direct the crew: “${text}”`,
    run: () => send({ type: 'directive.create', text, focusEntityIds: useStudio.getState().selection }),
  };
}

/** Global hotkeys. Ignored while typing in inputs. */
export function installHotkeys(): () => void {
  const byKey = (e: KeyboardEvent): string | null => {
    const k = e.key.toLowerCase();
    const mod = e.ctrlKey || e.metaKey;
    if (mod && k === 'k') return 'palette';
    if (mod && k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (mod && k === 'y') return 'redo';
    if (mod && k === 'd') return 'dup';
    if (mod && k === 'a') return 'all';
    if (mod) return null;
    if (e.shiftKey && k === 'a') return 'palette';
    if (e.shiftKey && k === 'f') return 'frameall';
    return ({ w: 'move', e: 'rotate', r: 'scale', f: 'frame', x: 'snap', q: 'space', l: 'lock', h: 'hide', f2: 'rename', escape: 'deselect', delete: 'del', backspace: 'del' } as Record<string, string>)[k] ?? null;
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement;
    if (e.key === 'Escape' && useStudio.getState().designOpen) return useStudio.setState({ designOpen: false });
    if (t.closest('input, textarea, select, [contenteditable]')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'p') return (e.preventDefault(), togglePlay());
    // While playing, the game owns the keyboard. Esc (once the pointer is free) stops play.
    if (usePlay.getState().status !== 'off') {
      if (e.key === 'Escape' && !usePlay.getState().locked) stopPlay();
      return;
    }
    const id = byKey(e);
    if (!id) return;
    e.preventDefault();
    if (id === 'palette') return useStudio.setState({ paletteOpen: true });
    const cmd = COMMANDS.find((c) => c.id === id);
    if (cmd && (cmd.enabled?.() ?? true)) cmd.run();
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
