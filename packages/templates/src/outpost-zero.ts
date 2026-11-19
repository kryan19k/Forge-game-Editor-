import { SceneDoc, type EntityInput } from '@forge/contracts';

/**
 * OUTPOST ZERO — greybox. A compact research outpost: exterior courtyard,
 * a hub building with a locked door, a keycard, and a terminal objective.
 * Placeholder geometry only; validated GLBs replace these in the asset phase.
 */

const CONCRETE = '#5e5f60';
const WALL = '#a7a39a';
const TRIM = '#3b3c3e';

type E = EntityInput;
const ents: E[] = [];
const add = (e: E) => ents.push(e);

const wall = (id: string, name: string, parentId: string, position: [number, number, number], size: [number, number, number]) =>
  add({
    id,
    name,
    parentId,
    transform: { position },
    components: {
      mesh: { shape: 'box', size, material: { color: WALL, roughness: 0.85 } },
      collider: {},
      rigidBody: { kind: 'static' },
    },
    tags: ['structure'],
  });

// ── Environment & lighting
add({
  id: 'ent_sun',
  name: 'Sun',
  transform: { position: [18, 30, 12], rotation: [-42, 38, 0] },
  components: { light: { kind: 'directional', color: '#ffe6cc', intensity: 3.4, castShadow: true } },
});
add({
  id: 'ent_skyfill',
  name: 'Sky Fill',
  transform: { position: [0, 20, 0] },
  components: { light: { kind: 'hemisphere', color: '#a9bdd4', groundColor: '#2c2a28', intensity: 1.25 } },
});

// ── Terrain
add({
  id: 'ent_ground',
  name: 'Ground',
  transform: { position: [0, -0.05, 0] },
  components: {
    mesh: { shape: 'box', size: [64, 0.1, 64], material: { color: CONCRETE, roughness: 0.95 }, castShadow: false },
    collider: {},
    rigidBody: { kind: 'static' },
  },
  tags: ['terrain'],
});

// ── Hub building
add({ id: 'ent_hub', name: 'Hub Module', transform: { position: [0, 0, -6] }, tags: ['structure'] });
add({
  id: 'ent_hub_floor',
  name: 'Hub Floor',
  parentId: 'ent_hub',
  transform: { position: [0, 0.1, 0] },
  components: {
    mesh: { shape: 'box', size: [12, 0.2, 10], material: { color: TRIM, roughness: 0.6, metalness: 0.3 } },
    collider: {},
    rigidBody: { kind: 'static' },
  },
});
wall('ent_hub_wall_back', 'Back Wall', 'ent_hub', [0, 2, -5], [12, 4, 0.4]);
wall('ent_hub_wall_left', 'Left Wall', 'ent_hub', [-6, 2, 0], [0.4, 4, 10]);
wall('ent_hub_wall_right', 'Right Wall', 'ent_hub', [6, 2, 0], [0.4, 4, 10]);
wall('ent_hub_wall_front_l', 'Front Wall L', 'ent_hub', [-3.75, 2, 5], [4.5, 4, 0.4]);
wall('ent_hub_wall_front_r', 'Front Wall R', 'ent_hub', [3.75, 2, 5], [4.5, 4, 0.4]);
wall('ent_hub_lintel', 'Door Lintel', 'ent_hub', [0, 3.5, 5], [3, 1, 0.4]);
add({
  id: 'ent_hub_roof',
  name: 'Roof',
  parentId: 'ent_hub',
  transform: { position: [0, 4.15, 0] },
  components: { mesh: { shape: 'box', size: [12.6, 0.3, 10.6], material: { color: TRIM, roughness: 0.7, metalness: 0.4 } } },
});
add({
  id: 'ent_hub_door',
  name: 'Security Door',
  parentId: 'ent_hub',
  transform: { position: [0, 1.5, 5] },
  components: {
    mesh: { shape: 'box', size: [3, 3, 0.2], material: { color: '#2f3a40', metalness: 0.7, roughness: 0.35 } },
    collider: {},
    rigidBody: { kind: 'kinematic' },
    interactable: { verb: 'open', prompt: 'Open security door', requiresItem: 'keycard_alpha' },
    network: { authority: 'server', replicate: ['transform', 'state'] },
  },
  tags: ['door'],
});
add({
  id: 'ent_hub_door_lamp',
  name: 'Door Status Lamp',
  parentId: 'ent_hub',
  transform: { position: [0, 3.2, 5.35] },
  components: {
    mesh: {
      shape: 'box',
      size: [0.6, 0.12, 0.08],
      castShadow: false,
      material: { color: '#ff3b1f', emissive: '#ff3b1f', emissiveIntensity: 6 },
    },
    light: { kind: 'point', color: '#ff4a26', intensity: 6, range: 6 },
  },
});
add({
  id: 'ent_terminal',
  name: 'Objective Terminal',
  parentId: 'ent_hub',
  transform: { position: [0, 0.9, -3.6] },
  components: {
    mesh: { shape: 'box', size: [1.6, 1.4, 0.5], material: { color: '#262a2e', metalness: 0.5, roughness: 0.4 } },
    collider: {},
    interactable: { verb: 'use', prompt: 'Upload research data' },
    network: { authority: 'server', replicate: ['state'] },
  },
  tags: ['objective'],
});
add({
  id: 'ent_terminal_screen',
  name: 'Terminal Screen',
  parentId: 'ent_terminal',
  transform: { position: [0, 0.25, 0.26] },
  components: {
    mesh: {
      shape: 'box',
      size: [1.2, 0.6, 0.02],
      castShadow: false,
      material: { color: '#41e0d0', emissive: '#41e0d0', emissiveIntensity: 3 },
    },
    light: { kind: 'point', color: '#41e0d0', intensity: 4, range: 5 },
  },
});

// ── Courtyard
add({ id: 'ent_courtyard', name: 'Courtyard', transform: { position: [0, 0, 8] } });
const crates: Array<[string, [number, number, number], number]> = [
  ['ent_crate_a', [-7, 0.6, 2], 12],
  ['ent_crate_b', [-5.8, 0.6, 3.1], -20],
  ['ent_crate_c', [-6.4, 1.8, 2.5], 4],
  ['ent_crate_d', [7.5, 0.6, -1], 35],
];
for (const [id, position, yaw] of crates)
  add({
    id,
    name: `Supply Crate ${id.slice(-1).toUpperCase()}`,
    parentId: 'ent_courtyard',
    transform: { position, rotation: [0, yaw, 0] },
    components: {
      mesh: { shape: 'box', size: [1.2, 1.2, 1.2], material: { color: '#6b5a3e', roughness: 0.8 } },
      collider: {},
      rigidBody: { kind: 'dynamic', mass: 40 },
      network: { authority: 'server', replicate: ['transform'], relevancy: 40 },
    },
    tags: ['prop'],
  });
add({
  id: 'ent_keycard',
  name: 'Keycard Alpha',
  parentId: 'ent_courtyard',
  transform: { position: [-6.4, 2.45, 2.5], rotation: [0, 25, 0] },
  components: {
    mesh: {
      shape: 'box',
      size: [0.32, 0.04, 0.2],
      castShadow: false,
      material: { color: '#ffb020', emissive: '#ffb020', emissiveIntensity: 4, metalness: 0.6, roughness: 0.3 },
    },
    collider: { shape: 'sphere', size: [0.8, 0.8, 0.8], isTrigger: true, layer: 'interact' },
    interactable: { verb: 'pickup', prompt: 'Take keycard', grantsItem: 'keycard_alpha' },
    network: { authority: 'server', replicate: ['state'] },
  },
  tags: ['pickup', 'key-item'],
});
add({
  id: 'ent_floodlight',
  name: 'Floodlight Mast',
  parentId: 'ent_courtyard',
  transform: { position: [8, 0, 6] },
  components: { mesh: { shape: 'cylinder', size: [0.18, 6, 0.18], material: { color: TRIM, metalness: 0.8, roughness: 0.4 } } },
});
add({
  id: 'ent_floodlight_lamp',
  name: 'Floodlight',
  parentId: 'ent_floodlight',
  transform: { position: [0, 3.1, 0], rotation: [-35, -140, 0] },
  components: { light: { kind: 'spot', color: '#e8f0ff', intensity: 220, range: 30, angle: 38, castShadow: true } },
});
add({
  id: 'ent_spawn',
  name: 'Player Spawn',
  parentId: 'ent_courtyard',
  transform: { position: [0, 0, 12] },
  components: { spawnPoint: { team: 'any' } },
  tags: ['spawn'],
});

export function outpostZeroScene(): SceneDoc {
  const entities = Object.fromEntries(ents.map((e) => [e.id, e]));
  return SceneDoc.parse({
    schemaVersion: 1,
    sceneId: 'main',
    name: 'Outpost Zero — Greybox',
    revision: 0,
    environment: { background: '#16181c', fogColor: '#16181c', fogDensity: 0.009, exposure: 1.05 },
    game: { genre: 'exploration', controller: 'character', camera: 'third_person', win: 'objectives', maxPlayers: 4 },
    entities,
  });
}
