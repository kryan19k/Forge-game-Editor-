import type { Entity, SceneDoc } from '@forge/contracts';
import { flattenHierarchy } from './graph';

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''));
const v3 = (v: readonly number[]) => v.map(fmt).join(',');

export function describeComponents(e: Entity): string {
  const c = e.components;
  const parts: string[] = [];
  if (c.mesh) parts.push(`mesh:${c.mesh.shape} ${v3(c.mesh.size)} ${c.mesh.material.color}`);
  if (c.light) parts.push(`light:${c.light.kind} ${c.light.color} i=${fmt(c.light.intensity)}`);
  if (c.collider) parts.push(`collider:${c.collider.shape}${c.collider.isTrigger ? ' trigger' : ''}`);
  if (c.rigidBody) parts.push(`body:${c.rigidBody.kind}`);
  if (c.spawnPoint) parts.push(`spawn:${c.spawnPoint.team}`);
  if (c.interactable) parts.push(`interact:${c.interactable.verb} "${c.interactable.prompt}"`);
  if (c.network) parts.push(`net:${c.network.authority}`);
  return parts.join(' | ');
}

/** Compact, token-efficient scene outline for agents. */
export function outlineScene(scene: SceneDoc): string {
  const rows = flattenHierarchy(scene);
  const lines = [`scene "${scene.name}" (${scene.sceneId}) rev ${scene.revision} · ${rows.length} entities`];
  for (const { entity: e, depth } of rows) {
    const t = e.transform;
    const flags = [e.locked ? 'LOCKED' : '', e.visible ? '' : 'hidden', e.tags.length ? `#${e.tags.join(' #')}` : '']
      .filter(Boolean)
      .join(' ');
    const rot = t.rotation.some((r) => r !== 0) ? ` rot ${v3(t.rotation)}` : '';
    const scl = t.scale.some((s) => s !== 1) ? ` scl ${v3(t.scale)}` : '';
    lines.push(
      `${'  '.repeat(depth)}${e.id} "${e.name}" @ ${v3(t.position)}${rot}${scl}${flags ? ` [${flags}]` : ''}${
        describeComponents(e) ? `  {${describeComponents(e)}}` : ''
      }`,
    );
  }
  return lines.join('\n');
}
