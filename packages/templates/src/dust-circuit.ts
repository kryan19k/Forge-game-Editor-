import type { SceneDoc } from '@forge/contracts';
import { Kit } from './kit';

/**
 * DUST CIRCUIT — arcade racing. A walled desert stadium loop, 8 checkpoints,
 * 3 laps, three AI rivals who give up their grid slots to joining players.
 * Driving direction: start straight heads +X, counter-clockwise from above.
 */
export function dustCircuitScene(): SceneDoc {
  const k = new Kit();
  const WALL = { color: '#e4ddd0', roughness: 0.7 };
  const ASPHALT = { color: '#38393b', roughness: 0.95 };

  k.light('ent_sun', 'Desert Sun', 'directional', [40, 60, 30], { color: '#fff3df', intensity: 3.4, castShadow: true, rotation: [-58, 30, 0] });
  k.light('ent_sky', 'Sky', 'hemisphere', [0, 30, 0], { color: '#b8d0e8', groundColor: '#8a6a45', intensity: 1.1 });
  k.prop('ent_sand', 'Desert', 'box', [0, -0.05, 0], [220, 0.1, 160], { color: '#c9a476', roughness: 1 }, { solid: true, tags: ['terrain'], shadow: false });

  // ── Track surface (visual) — ring between outer (±61, ±35) and inner (±46, ±21) walls.
  k.group('ent_track', 'Track', [0, 0, 0]);
  k.prop('ent_asphalt_s', 'Asphalt South', 'box', [0, 0.01, -28], [122, 0.02, 14], ASPHALT, { parentId: 'ent_track', shadow: false });
  k.prop('ent_asphalt_n', 'Asphalt North', 'box', [0, 0.01, 28], [122, 0.02, 14], ASPHALT, { parentId: 'ent_track', shadow: false });
  k.prop('ent_asphalt_e', 'Asphalt East', 'box', [53.5, 0.01, 0], [15, 0.02, 42], ASPHALT, { parentId: 'ent_track', shadow: false });
  k.prop('ent_asphalt_w', 'Asphalt West', 'box', [-53.5, 0.01, 0], [15, 0.02, 42], ASPHALT, { parentId: 'ent_track', shadow: false });
  k.prop('ent_finish', 'Start/Finish Line', 'box', [0, 0.025, -28], [0.8, 0.02, 14], { color: '#f4f1ea', emissive: '#ffffff', emissiveIntensity: 0.4 }, { parentId: 'ent_track', shadow: false });

  // ── Walls
  k.group('ent_walls', 'Barriers', [0, 0, 0]);
  const wall = (id: string, p: [number, number, number], s: [number, number, number]) =>
    k.solid(id, 'Barrier', p, s, WALL, { parentId: 'ent_walls', tags: ['barrier'] });
  wall('ent_wall_out_s', [0, 0.6, -35.5], [124, 1.2, 1]);
  wall('ent_wall_out_n', [0, 0.6, 35.5], [124, 1.2, 1]);
  wall('ent_wall_out_e', [61.5, 0.6, 0], [1, 1.2, 72]);
  wall('ent_wall_out_w', [-61.5, 0.6, 0], [1, 1.2, 72]);
  wall('ent_wall_in_s', [0, 0.6, -20.5], [93, 1.2, 1]);
  wall('ent_wall_in_n', [0, 0.6, 20.5], [93, 1.2, 1]);
  wall('ent_wall_in_e', [46, 0.6, 0], [1, 1.2, 42]);
  wall('ent_wall_in_w', [-46, 0.6, 0], [1, 1.2, 42]);
  k.prop('ent_infield', 'Infield', 'box', [0, 0.15, 0], [91, 0.3, 40], { color: '#8a8f4e', roughness: 1 }, { shadow: false });

  // ── Checkpoints (trigger volumes; order 0 = start/finish)
  const cps: Array<[number, [number, number, number], [number, number, number]]> = [
    [0, [0, 1.5, -28], [2, 4, 14]],
    [1, [53.5, 1.5, -28], [15, 4, 14]],
    [2, [53.5, 1.5, 0], [15, 4, 2]],
    [3, [53.5, 1.5, 28], [15, 4, 14]],
    [4, [0, 1.5, 28], [2, 4, 14]],
    [5, [-53.5, 1.5, 28], [15, 4, 14]],
    [6, [-53.5, 1.5, 0], [15, 4, 2]],
    [7, [-53.5, 1.5, -28], [15, 4, 14]],
  ];
  k.group('ent_checkpoints', 'Checkpoints', [0, 0, 0]);
  for (const [order, p, s] of cps)
    k.add({
      id: `ent_cp_${order}`,
      name: order === 0 ? 'Start / Finish' : `Checkpoint ${order}`,
      parentId: 'ent_checkpoints',
      transform: { position: p },
      components: { collider: { shape: 'box', size: s, isTrigger: true, layer: 'trigger' }, checkpoint: { order } },
      tags: ['checkpoint'],
    });

  // ── Dressing
  k.solid('ent_grandstand', 'Grandstand', [0, 2.5, -42], [40, 5, 6], { color: '#7c8796', roughness: 0.8 });
  k.prop('ent_banner', 'Banner', 'box', [0, 6.2, -39.2], [30, 1.2, 0.1], { color: '#ff6a2b', emissive: '#ff6a2b', emissiveIntensity: 1.2 }, { shadow: false });
  for (const [i, [x, z]] of ([[-61, -35], [61, -35], [61, 35], [-61, 35]] as const).entries()) {
    k.prop(`ent_tower_${i}`, 'Light Tower', 'cylinder', [x * 1.08, 6, z * 1.12], [0.5, 12, 0.5], { color: '#4a4c50', metalness: 0.7 });
  }
  for (const [i, x] of [-20, -8, 8, 20].entries()) k.prop(`ent_cone_${i}`, 'Cone', 'cone', [x, 0.35, -21.4], [0.5, 0.7, 0.5], { color: '#ff7a2a' }, { shadow: false });

  // ── Grid (behind the line, facing +X)
  k.spawn('ent_grid_1', [-6, 0, -31], -90, 'grid');
  k.spawn('ent_grid_2', [-6, 0, -25], -90, 'grid');
  k.spawn('ent_grid_3', [-13, 0, -31], -90, 'grid');
  k.spawn('ent_grid_4', [-13, 0, -25], -90, 'grid');

  return k.build({
    name: 'Dust Circuit — Stadium',
    environment: { background: '#a9c4dc', fogColor: '#d6c7ad', fogDensity: 0.0045, exposure: 1.0 },
    game: { genre: 'racing', controller: 'vehicle', camera: 'chase', win: 'race', laps: 3, bots: 3, maxPlayers: 4 },
  });
}
