import type { SceneDoc } from '@forge/contracts';
import { Kit } from './kit';

/**
 * HOLLOW VALE — RPG. A dusk village with an elder, wandering villagers, a moonherb
 * meadow guarded by wolves. Quest: meet the elder → gather 3 moonherbs → drive off
 * the wolves → return. Exercises dialogue, pickups, melee combat, NPC AI, quests.
 */
export function hollowValeScene(): SceneDoc {
  const k = new Kit();
  const WALL = '#b9a68a';
  const ROOF = '#7a3b2e';

  k.light('ent_sun', 'Low Sun', 'directional', [-20, 18, 14], { color: '#ffc48a', intensity: 2.6, castShadow: true, rotation: [-28, -42, 0] });
  k.light('ent_sky', 'Dusk Sky', 'hemisphere', [0, 20, 0], { color: '#8ea3cc', groundColor: '#3a2f25', intensity: 1.0 });
  k.prop('ent_ground', 'Meadow', 'box', [0, -0.05, -6], [90, 0.1, 90], { color: '#4f5e3b', roughness: 1 }, { solid: true, tags: ['terrain'], shadow: false });
  k.prop('ent_path', 'Dirt Path', 'box', [0, 0.005, -4], [3, 0.02, 36], { color: '#7a6a52', roughness: 1 }, { shadow: false });

  // ── Village
  k.group('ent_village', 'Village', [0, 0, 6]);
  const houses: Array<[string, [number, number, number], number]> = [
    ['ent_house_a', [-9, 0, 2], 15],
    ['ent_house_b', [9, 0, 0], -20],
    ['ent_house_c', [-7, 0, 13], 5],
  ];
  for (const [id, p, yaw] of houses) {
    k.group(id, 'Cottage', p, 'ent_village');
    k.solid(`${id}_walls`, 'Walls', [0, 1.5, 0], [5, 3, 5], { color: WALL, roughness: 0.9 }, { parentId: id, rotation: [0, yaw, 0] });
    k.prop(`${id}_roof`, 'Roof', 'cone', [0, 4.2, 0], [7.4, 2.6, 7.4], { color: ROOF, roughness: 0.85 }, { parentId: id });
    k.prop(`${id}_window`, 'Lit Window', 'box', [0, 1.7, 2.52], [1, 0.8, 0.05], { color: '#ffcc7a', emissive: '#ffb050', emissiveIntensity: 2.5 }, { parentId: id, rotation: [0, yaw, 0], shadow: false });
  }
  k.prop('ent_well', 'Village Well', 'cylinder', [3, 0.45, 2], [1.8, 0.9, 1.8], { color: '#8a8580', roughness: 0.95 }, { parentId: 'ent_village', solid: true });
  k.prop('ent_fire', 'Campfire', 'cone', [-2, 0.3, 8], [0.9, 0.6, 0.9], { color: '#ff7a2a', emissive: '#ff6a1a', emissiveIntensity: 6 }, { parentId: 'ent_village', shadow: false });
  k.light('ent_fire_light', 'Firelight', 'point', [-2, 1.4, 8], { color: '#ff8a3d', intensity: 30, range: 14, parentId: 'ent_village' });

  // ── People
  k.add({
    id: 'ent_elder',
    name: 'Elder Maren',
    parentId: 'ent_village',
    transform: { position: [1, 0.9, -1] },
    components: {
      mesh: { shape: 'capsule', size: [0.7, 1.8, 0.7], material: { color: '#d8c7a0', roughness: 0.7 } },
      npc: {
        behavior: 'idle',
        dialogue: [
          'Traveler — the moon is rising and the vale grows restless.',
          'Gather three moonherbs from the north meadow. Their light keeps the dark at bay.',
          'Mind the wolves. They have grown bold since the shard fell.',
          'You have done well. The vale will remember your name.',
        ],
      },
      interactable: { verb: 'talk', prompt: 'Talk to Elder Maren' },
      network: { authority: 'server', replicate: ['transform', 'state'] },
    },
    tags: ['npc', 'elder'],
  });
  const villagers: Array<[string, string, [number, number, number], string]> = [
    ['ent_villager_tam', 'Tam the Smith', [-5, 0.9, 6], 'The forge is cold tonight. Bring me ore someday and I will make you a blade.'],
    ['ent_villager_ivy', 'Ivy', [6, 0.9, 9], 'Have you seen the meadow glow? Grandmother says it is the moonherbs.'],
  ];
  for (const [id, name, p, line] of villagers)
    k.add({
      id,
      name,
      parentId: 'ent_village',
      transform: { position: p },
      components: {
        mesh: { shape: 'capsule', size: [0.65, 1.7, 0.65], material: { color: '#9fb0c4', roughness: 0.75 } },
        npc: { behavior: 'wander', wanderRadius: 4, speed: 1.4, dialogue: [line] },
        interactable: { verb: 'talk', prompt: `Talk to ${name}` },
        network: { authority: 'server', replicate: ['transform'] },
      },
      tags: ['npc', 'villager'],
    });

  // ── Meadow: herbs + wolves
  k.group('ent_meadow', 'North Meadow', [0, 0, -22]);
  const herbs: Array<[string, [number, number, number]]> = [
    ['ent_herb_1', [-7, 0.55, 1]],
    ['ent_herb_2', [6, 0.55, -2]],
    ['ent_herb_3', [-1, 0.55, -7]],
  ];
  for (const [id, p] of herbs)
    k.add({
      id,
      name: 'Moonherb',
      parentId: 'ent_meadow',
      transform: { position: p },
      components: {
        mesh: { shape: 'sphere', size: [0.45, 0.45, 0.45], castShadow: false, material: { color: '#b9a8ff', emissive: '#8f7bff', emissiveIntensity: 4 } },
        collider: { shape: 'sphere', size: [1, 1, 1], isTrigger: true, layer: 'interact' },
        interactable: { verb: 'pickup', prompt: 'Gather moonherb', grantsItem: 'moonherb' },
        network: { authority: 'server', replicate: ['state'] },
      },
      tags: ['pickup', 'herb'],
    });
  const wolves: Array<[string, [number, number, number]]> = [
    ['ent_wolf_1', [-4, 0.7, -3]],
    ['ent_wolf_2', [5, 0.7, -6]],
  ];
  for (const [id, p] of wolves)
    k.add({
      id,
      name: 'Grey Wolf',
      parentId: 'ent_meadow',
      transform: { position: p },
      components: {
        mesh: { shape: 'box', size: [0.6, 0.8, 1.3], material: { color: '#5d5d63', roughness: 0.9 } },
        npc: { behavior: 'wander', hostile: true, speed: 2.4, aggroRadius: 7, wanderRadius: 4 },
        health: { max: 40 },
        combat: { damage: 8, range: 1.5, cooldown: 1.1 },
        network: { authority: 'server', replicate: ['transform', 'state'] },
      },
      tags: ['npc', 'wolf', 'enemy'],
    });
  k.light('ent_meadow_glow', 'Meadow Glow', 'point', [0, 2.5, -2], { color: '#8f7bff', intensity: 18, range: 16, parentId: 'ent_meadow' });

  // ── Forest ring
  const ring: Array<[number, number, number]> = [
    [-16, -4, 1.1], [-18, -16, 1.3], [-14, -30, 1.0], [-4, -36, 1.2], [10, -34, 1.1], [17, -24, 1.3],
    [18, -10, 1.0], [16, 6, 1.2], [-17, 10, 1.1], [14, 18, 1.0], [-12, 24, 1.2], [4, 26, 1.0],
  ];
  ring.forEach(([x, z, s], i) => k.tree(`ent_tree_${i}`, [x, 0, z], s));

  k.spawn('ent_spawn_1', [0, 0, 22]);
  k.spawn('ent_spawn_2', [2, 0, 22]);
  k.spawn('ent_spawn_3', [-2, 0, 22]);
  k.spawn('ent_spawn_4', [0, 0, 24]);

  return k.build({
    name: 'Hollow Vale — Village',
    environment: { background: '#1d1b26', fogColor: '#2a2433', fogDensity: 0.014, exposure: 1.1 },
    game: {
      genre: 'rpg',
      controller: 'character',
      camera: 'third_person',
      win: 'objectives',
      maxPlayers: 4,
      player: { health: 120, damage: 14 },
      objectives: [
        { id: 'meet_elder', label: 'Speak with Elder Maren', kind: 'interact', target: 'ent_elder' },
        { id: 'gather', label: 'Gather moonherbs', kind: 'collect', target: 'moonherb', count: 3 },
        { id: 'wolves', label: 'Drive off the wolves', kind: 'defeat', target: '#wolf', count: 2 },
        { id: 'return', label: 'Return to Elder Maren', kind: 'interact', target: 'ent_elder' },
      ],
    },
  });
}
