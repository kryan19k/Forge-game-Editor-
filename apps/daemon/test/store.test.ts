import type { Author } from '@forge/contracts';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ProjectStore } from '../src/store';

const human: Author = { kind: 'human', id: 'director', name: 'Director' };
const agent: Author = { kind: 'agent', id: 'claude', name: 'Claude' };
const fresh = () => new ProjectStore(mkdtempSync(join(tmpdir(), 'forge-')), 'outpost-zero');
const pos = (s: ProjectStore, id: string) => s.scene.entities[id]!.transform.position;
const move = (s: ProjectStore, a: Author, x: number) =>
  s.submit(a, `move ${x}`, [{ op: 'set_transform', entityId: 'ent_crate_a', position: [x, 0, 0] }]);

describe('ProjectStore history', () => {
  it('undoes and redoes sequential edits to the same entity', () => {
    const s = fresh();
    const start = [...pos(s, 'ent_crate_a')];
    move(s, human, 1);
    move(s, human, 2);
    expect(s.undo(human).ok).toBe(true);
    expect(pos(s, 'ent_crate_a')).toEqual([1, 0, 0]);
    expect(s.undo(human).ok).toBe(true);
    expect(pos(s, 'ent_crate_a')).toEqual(start);
    expect(s.redo(human).ok).toBe(true);
    expect(pos(s, 'ent_crate_a')).toEqual([1, 0, 0]);
    expect(s.redo(human).ok).toBe(true);
    expect(pos(s, 'ent_crate_a')).toEqual([2, 0, 0]);
    expect(s.redo(human).ok).toBe(false);
  });

  it('per-author undo refuses to clobber another author’s later change', () => {
    const s = fresh();
    move(s, human, 1);
    move(s, agent, 5);
    const r = s.undo(human);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('CONFLICT');
    expect(pos(s, 'ent_crate_a')).toEqual([5, 0, 0]);
  });

  it('a new edit clears the redo stack', () => {
    const s = fresh();
    move(s, human, 1);
    s.undo(human);
    move(s, human, 3);
    expect(s.redo(human).ok).toBe(false);
  });

  it('reverts an arbitrary agent transaction and restores deleted subtrees', () => {
    const s = fresh();
    const before = Object.keys(s.scene.entities).length;
    const del = s.submit(agent, 'remove hub', [{ op: 'delete_entity', entityId: 'ent_hub' }]);
    expect(del.ok).toBe(true);
    expect(Object.keys(s.scene.entities).length).toBeLessThan(before);
    const r = s.revert(del.ok ? del.entry.txId : '', human);
    expect(r.ok).toBe(true);
    expect(Object.keys(s.scene.entities).length).toBe(before);
    expect(s.history().find((h) => h.txId === (del.ok ? del.entry.txId : ''))?.revertedBy).toBeDefined();
  });

  it('agents cannot touch locked work', () => {
    const s = fresh();
    s.submit(human, 'lock', [{ op: 'set_flags', entityId: 'ent_terminal', locked: true }]);
    const r = s.submit(agent, 'nudge', [{ op: 'set_transform', entityId: 'ent_terminal', position: [0, 0, 0] }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.code).toBe('LOCKED');
  });
});
