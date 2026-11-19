import type { SceneDoc } from '@forge/contracts';
import { Kit } from './kit';

/**
 * SHARDLANDS — MMORPG hub. A shared plaza around a fallen shard with vendors and a
 * quest-giver, and a field of respawning slimes. Persistent world (no match end),
 * up to 32 players, server-authoritative everything.
 */
export function shardlandsScene(): SceneDoc {
  const k = new Kit();
  const STONE = '#8d8a84';

  k.light('ent_sun', 'Sun', 'directional', [24, 30, 18], { color: '#fff1dc', intensity: 3, castShadow: true, rotation: [-50, 35, 0] });
  k.light('ent_sky', 'Sky', 'hemisphere', [0, 20, 0], { color: '#b6cbe6', groundColor: '#3d3a30', intensity: 1.2 });
  k.prop('ent_ground', 'Plains', 'box', [20, -0.05, 0], [140, 0.1, 100], { color: '#5d6e3f', roughness: 1 }, { solid: true, tags: ['terrain'], shadow: false });

  // ── Plaza
  k.group('ent_plaza', 'Shard Plaza', [0, 0, 0]);
  k.prop('ent_plaza_floor', 'Plaza Stones', 'cylinder', [0, 0.1, 0], [30, 0.2, 30], { color: STONE, roughness: 0.9 }, { parentId: 'ent_plaza', solid: true, shadow: false });
  k.prop('ent_shard', 'The Fallen Shard', 'cone', [0, 3.2, 0], [2.2, 6, 2.2], { color: '#9fe6ff', emissive: '#59c8ff', emissiveIntensity: 3.5, metalness: 0.2, roughness: 0.15 }, { parentId: 'ent_plaza', solid: true });
  k.light('ent_shard_light', 'Shard Light', 'point', [0, 4, 0], { color: '#7fd8ff', intensity: 60, range: 22, parentId: 'ent_plaza' });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.prop(`ent_pillar_${i}`, 'Pillar', 'cylinder', [Math.cos(a) * 14, 2.5, Math.sin(a) * 14], [1, 5, 1], { color: '#a9a49a', roughness: 0.85 }, { parentId: 'ent_plaza', solid: true });
    k.spawn(`ent_spawn_${i + 1}`, [Math.cos(a) * 6, 0.2, Math.sin(a) * 6], (-a * 180) / Math.PI - 90, 'any', 'ent_plaza');
  }

  const vendor = (id: string, name: string, p: [number, number, number], color: string, lines: string[], prompt: string) =>
    k.add({
      id,
      name,
      parentId: 'ent_plaza',
      transform: { position: p },
      components: {
        mesh: { shape: 'capsule', size: [0.75, 1.85, 0.75], material: { color, roughness: 0.7 } },
        npc: { behavior: 'idle', dialogue: lines },
        interactable: { verb: 'talk', prompt },
        network: { authority: 'server', replicate: ['transform', 'state'] },
      },
      tags: ['npc', 'vendor'],
    });
  vendor('ent_ilsa', 'Warden Ilsa', [-3, 1.125, -10], '#d9b56a', [
    'The shard draws slimes from the eastern fields. Thin them out — five should do.',
    'Still hunting? The fields are east, past the pillars.',
    'Fine work. Check back — they always return.',
  ], 'Talk to Warden Ilsa');
  vendor('ent_smith', 'Brann the Smith', [9, 1.125, -6], '#9c7a5a', ['Blades, mail, repairs. Coin first, questions later.'], 'Browse wares');
  vendor('ent_keeper', 'Quartermaster Oda', [-9, 1.125, 6], '#7f9cb3', ['Potions restock at dawn. Travel light, adventurer.'], 'Talk to Oda');

  // ── Eastern field: respawning slimes
  k.group('ent_field', 'Eastern Field', [36, 0, 0]);
  const slimes: Array<[number, number]> = [[-6, -8], [2, -12], [8, -2], [-4, 4], [6, 9], [-10, 11], [12, -10]];
  slimes.forEach(([x, z], i) =>
    k.add({
      id: `ent_slime_${i + 1}`,
      name: 'Shard Slime',
      parentId: 'ent_field',
      transform: { position: [x, 0.45, z] },
      components: {
        mesh: { shape: 'sphere', size: [1, 0.9, 1], material: { color: '#6fd17a', emissive: '#2f8f4a', emissiveIntensity: 0.6, roughness: 0.3 } },
        npc: { behavior: 'wander', hostile: true, speed: 1.8, aggroRadius: 6, wanderRadius: 5, respawnSeconds: 20 },
        health: { max: 30 },
        combat: { damage: 5, range: 1.3, cooldown: 1.3 },
        network: { authority: 'server', replicate: ['transform', 'state'], relevancy: 60 },
      },
      tags: ['npc', 'slime', 'enemy'],
    }),
  );
  [[-14, -18], [-16, 16], [18, 20], [20, -20]].forEach(([x, z], i) => k.tree(`ent_tree_${i}`, [x!, 0, z!], 1.2, 'ent_field'));

  return k.build({
    name: 'Shardlands — Hub',
    environment: { background: '#9db7d6', fogColor: '#b9c9d8', fogDensity: 0.006, exposure: 1.0 },
    game: {
      genre: 'mmorpg',
      controller: 'character',
      camera: 'third_person',
      win: 'none',
      maxPlayers: 32,
      respawnSeconds: 5,
      player: { health: 150, damage: 12 },
      objectives: [
        { id: 'warden', label: 'Report to Warden Ilsa', kind: 'interact', target: 'ent_ilsa' },
        { id: 'slimes', label: 'Thin out the shard slimes', kind: 'defeat', target: '#slime', count: 5 },
        { id: 'report', label: 'Return to Warden Ilsa', kind: 'interact', target: 'ent_ilsa' },
      ],
    },
  });
}
