import type { DesignAnswer, DesignBrief, DesignQuestion, SceneDoc, StarterInfo } from '@forge/contracts';
import { dustCircuitScene } from './dust-circuit';
import { Kit } from './kit';

/**
 * Genre starters: a design interview + a scaffold builder. The scaffold is a playable
 * greybox configured from the answers (rules, controller, camera, starter gameplay
 * database, placeholder content) — the foundation the crew builds the real game on.
 */

type Answers = Record<string, DesignAnswer>;
export interface Starter extends StarterInfo {
  build(answers: Answers, title: string): SceneDoc;
  /** Seed design notes + build plan derived from answers (the Producer expands these). */
  seed(answers: Answers, title: string): Pick<DesignBrief, 'gdd' | 'plan'>;
}

const one = (a: Answers, id: string, fallback: string) => (typeof a[id] === 'string' && a[id] ? (a[id] as string) : fallback);
const many = (a: Answers, id: string) => (Array.isArray(a[id]) ? (a[id] as string[]) : typeof a[id] === 'string' && a[id] ? [a[id] as string] : []);
const q = (id: string, prompt: string, kind: DesignQuestion['kind'], options: Array<[string, string, string?]> = [], extra: Partial<DesignQuestion> = {}): DesignQuestion => ({
  id,
  prompt,
  kind,
  options: options.map(([oid, label, hint]) => ({ id: oid, label, ...(hint ? { hint } : {}) })),
  ...extra,
});

/* ── shared vocab ──────────────────────────────────────────────────────── */

const SETTING = q('setting', 'What world is this set in?', 'single', [
  ['fantasy', 'High fantasy', 'swords, spells, ancient ruins'],
  ['dark_fantasy', 'Dark fantasy', 'grim, gothic, dangerous'],
  ['scifi', 'Science fiction', 'starships, colonies, tech'],
  ['post_apoc', 'Post-apocalyptic', 'scavenged, ruined, survival'],
  ['mythic', 'Mythic / folklore', 'gods, spirits, legends'],
  ['modern', 'Modern day', 'cities, realism'],
], { default: 'fantasy' });

const TONE = q('tone', 'What should it feel like?', 'single', [
  ['cozy', 'Cozy', 'warm, low-stakes, charming'],
  ['heroic', 'Heroic', 'bright adventure, big moments'],
  ['grim', 'Grim', 'tense, punishing, atmospheric'],
  ['comedic', 'Comedic', 'playful, absurd'],
], { default: 'heroic' });

const ENV: Record<string, { background: string; fogColor: string; fogDensity: number; ground: string; sun: string; sky: string; accent: string }> = {
  fantasy: { background: '#1f2433', fogColor: '#2b3346', fogDensity: 0.012, ground: '#4f5e3b', sun: '#ffd8a8', sky: '#9fb4d6', accent: '#b9a8ff' },
  dark_fantasy: { background: '#100e14', fogColor: '#1a1620', fogDensity: 0.022, ground: '#2f3229', sun: '#c9b8ff', sky: '#4a4660', accent: '#e3608f' },
  scifi: { background: '#0d1118', fogColor: '#121a24', fogDensity: 0.01, ground: '#3a3f46', sun: '#e6f0ff', sky: '#7f98b8', accent: '#59c8ff' },
  post_apoc: { background: '#2a2219', fogColor: '#4a3d2c', fogDensity: 0.016, ground: '#6d5c45', sun: '#ffcf8f', sky: '#a99780', accent: '#f2b33d' },
  mythic: { background: '#1a1c28', fogColor: '#2c2a3a', fogDensity: 0.012, ground: '#566146', sun: '#fff0c8', sky: '#b8b0e0', accent: '#f2b33d' },
  modern: { background: '#a9c0d4', fogColor: '#c4cfd8', fogDensity: 0.006, ground: '#6c6f72', sun: '#fff6e8', sky: '#c2d4e6', accent: '#ff6a2b' },
};
const envFor = (setting: string) => ENV[setting] ?? ENV.fantasy!;

function base(k: Kit, setting: string, size = 90): void {
  const e = envFor(setting);
  k.light('ent_sun', 'Sun', 'directional', [22, 30, 16], { color: e.sun, intensity: 3, castShadow: true, rotation: [-48, 36, 0] });
  k.light('ent_sky', 'Sky Fill', 'hemisphere', [0, 20, 0], { color: e.sky, groundColor: '#2c2a28', intensity: 1.1 });
  k.prop('ent_ground', 'Ground', 'box', [0, -0.05, 0], [size, 0.1, size], { color: e.ground, roughness: 1 }, { solid: true, tags: ['terrain'], shadow: false });
}

function landmark(k: Kit, setting: string, at: [number, number, number]): void {
  const e = envFor(setting);
  k.prop('ent_landmark', 'Landmark', 'cone', [at[0], 3, at[2]], [2, 6, 2], { color: e.accent, emissive: e.accent, emissiveIntensity: 2.5 }, { solid: true });
  k.light('ent_landmark_light', 'Landmark Light', 'point', [at[0], 4, at[2]], { color: e.accent, intensity: 40, range: 18 });
}

function npc(k: Kit, id: string, name: string, at: [number, number, number], lines: string[], color = '#d8c7a0'): void {
  k.add({
    id,
    name,
    transform: { position: [at[0], 0.9, at[2]] },
    components: {
      mesh: { shape: 'capsule', size: [0.7, 1.8, 0.7], material: { color } },
      npc: { behavior: 'idle', dialogue: lines },
      interactable: { verb: 'talk', prompt: `Talk to ${name}` },
      network: { authority: 'server', replicate: ['transform', 'state'] },
    },
    tags: ['npc', 'quest_giver'],
  });
}

function enemies(k: Kit, prefix: string, name: string, tag: string, center: [number, number], count: number, o: { hp: number; dmg: number; color: string; respawn?: number; level?: number; xp?: number; loot?: string }): void {
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    const r = 3 + (i % 3) * 2;
    k.add({
      id: `ent_${prefix}_${i + 1}`,
      name,
      transform: { position: [center[0] + Math.cos(a) * r, 0.6, center[1] + Math.sin(a) * r] },
      components: {
        mesh: { shape: 'capsule', size: [0.8, 1.2, 0.8], material: { color: o.color } },
        npc: { behavior: 'wander', hostile: true, speed: 2.2, aggroRadius: 7, wanderRadius: 4, respawnSeconds: o.respawn ?? 0 },
        health: { max: o.hp },
        combat: { damage: o.dmg, range: 1.5, cooldown: 1.2 },
        unit: { level: o.level ?? 1, ...(o.xp ? { xp: o.xp } : {}), ...(o.loot ? { loot: o.loot } : {}) },
        network: { authority: 'server', replicate: ['transform', 'state'] },
      },
      tags: ['npc', 'enemy', tag],
    });
  }
}

/* ── gameplay database presets ─────────────────────────────────────────── */

function rpgDatabase(setting: string, progression: string, classes: string): Record<string, unknown> {
  const tech = setting === 'scifi' || setting === 'post_apoc' || setting === 'modern';
  const res = tech ? { id: 'energy', name: 'Energy', color: '#59c8ff' } : { id: 'mana', name: 'Mana', color: '#59c8ff' };
  const bolt = tech ? { id: 'pulse_shot', name: 'Pulse Shot' } : { id: 'firebolt', name: 'Firebolt' };
  const heal = tech ? { id: 'nanite_patch', name: 'Nanite Patch' } : { id: 'mend', name: 'Mend' };
  const slam = tech ? { id: 'shock_field', name: 'Shock Field' } : { id: 'frost_nova', name: 'Frost Nova' };
  const trees = progression.includes('tree') || classes === 'classless'
    ? [
        {
          id: 'path_power',
          name: tech ? 'Offense Protocols' : 'Path of Power',
          nodes: [
            { id: 'focus', name: 'Focus', description: '+8 power per rank', ranks: 3, grants: { modifiers: [{ stat: 'power', op: 'add', value: 8 }] }, pos: [1, 0] },
            { id: 'tough', name: 'Toughness', description: '+25 max health per rank', ranks: 3, grants: { modifiers: [{ stat: 'health', op: 'add', value: 25 }] }, pos: [0, 1] },
            { id: 'swift', name: 'Swiftness', description: '+10% move speed', grants: { modifiers: [{ stat: 'move_speed', op: 'add', value: 10 }] }, pos: [2, 1] },
            { id: 'nova', name: slam.name, description: 'Unlocks an area attack', requires: ['focus'], requiresLevel: 3, grants: { abilities: [slam.id] }, pos: [1, 2] },
            { id: 'mastery', name: 'Mastery', description: '+20% power', cost: 2, requires: ['nova', 'tough'], requiresLevel: 5, grants: { modifiers: [{ stat: 'power', op: 'mul', value: 0.2 }] }, pos: [1, 3] },
          ],
        },
      ]
    : [];
  return {
    stats: [
      { id: 'health', name: 'Health', base: 120, resource: true, regen: 1, perLevel: 12, color: '#e3608f' },
      { id: res.id, name: res.name, base: 60, resource: true, regen: 3, perLevel: 6, color: res.color },
      { id: 'power', name: 'Power', base: 0 },
      { id: 'armor', name: 'Armor', base: 5 },
      { id: 'move_speed', name: 'Move Speed', base: 100 },
    ],
    statuses: [
      { id: 'burning', name: tech ? 'Overheated' : 'Burning', duration: 4, tick: [{ kind: 'damage', amount: 3 }], maxStacks: 3 },
      { id: 'slowed', name: tech ? 'Disrupted' : 'Chilled', duration: 3, modifiers: [{ stat: 'move_speed', op: 'add', value: -40 }] },
    ],
    abilities: [
      { id: bolt.id, name: bolt.name, target: 'ray', range: 14, windup: 0.2, cooldown: 1.2, cost: [{ stat: res.id, amount: 8 }], effects: [{ kind: 'damage', amount: 16, scaling: { stat: 'power', factor: 0.6 } }, { kind: 'apply_status', status: 'burning' }], color: '#ff6a2b' },
      { id: heal.id, name: heal.name, target: 'self', windup: 0.4, cooldown: 8, cost: [{ stat: res.id, amount: 15 }], effects: [{ kind: 'heal', amount: 35 }], color: '#9bd15a' },
      { id: slam.id, name: slam.name, target: 'aoe', radius: 4, windup: 0.1, cooldown: 6, cost: [{ stat: res.id, amount: 20 }], effects: [{ kind: 'damage', amount: 10 }, { kind: 'apply_status', status: 'slowed' }], color: '#59c8ff' },
    ],
    trees,
    items: [
      { id: 'tonic', name: tech ? 'Stim Pack' : 'Healing Tonic', kind: 'consumable', use: [{ kind: 'heal', amount: 40 }] },
      { id: 'starter_weapon', name: tech ? 'Service Rifle' : 'Ashwood Staff', kind: 'equipment', slot: 'weapon', modifiers: [{ stat: 'power', op: 'add', value: 6 }] },
      { id: 'trophy', name: tech ? 'Salvage' : 'Trophy', kind: 'material' },
      { id: 'coin', name: tech ? 'Credits' : 'Coin', kind: 'currency', stack: 9999 },
    ],
    loot: [{ id: 'enemy_drop', rolls: 2, entries: [{ item: 'trophy', weight: 3 }, { item: 'coin', weight: 3, min: 2, max: 6 }, { item: 'tonic', weight: 1 }, { weight: 2 }] }],
    progression: { enabled: progression !== 'none', xpBase: 60, xpGrowth: 1.35, pointsPerLevel: 1 },
    loadout: { abilities: progression.includes('tree') ? [bolt.id, heal.id] : [bolt.id, heal.id, slam.id], items: [['tonic', 2], ['starter_weapon', 1]], trees: trees.map((t) => t.id) },
  };
}

/* ── starters ──────────────────────────────────────────────────────────── */

const rpg: Starter = {
  id: 'rpg',
  code: 'RPG',
  genre: 'rpg',
  name: 'RPG',
  tagline: 'Quests, characters, growth. You decide the world and how players get stronger.',
  accent: '#b9a8ff',
  skill: 'forge-rpg',
  questions: [
    SETTING,
    TONE,
    q('combat', 'How does combat play?', 'single', [
      ['action', 'Real-time action', 'aim, dodge, abilities on cooldowns'],
      ['caster', 'Ability-focused', 'click casts your main spell; builds matter'],
      ['light', 'Light combat', 'exploration and story first'],
    ], { default: 'action' }),
    q('progression', 'How do players grow?', 'multi', [
      ['levels', 'Levels & XP'],
      ['tree', 'Skill trees'],
      ['gear', 'Gear & loot'],
      ['none', 'No stat growth', 'story-driven'],
    ], { default: ['levels', 'tree', 'gear'] }),
    q('party', 'Who plays together?', 'single', [['solo', 'Solo'], ['coop2', 'Co-op, 2 players'], ['coop4', 'Co-op, up to 4']], { default: 'coop4' }),
    q('scope', 'How big is the first playable?', 'single', [
      ['village', 'One hub + one zone', 'tight vertical slice'],
      ['region', 'A small region', 'several zones'],
      ['open', 'Open area', 'free roaming'],
    ], { default: 'village' }),
    q('hook', 'In one sentence — what is the player’s story?', 'text', [], { help: 'e.g. “A lighthouse keeper must relight the beacons before the long night.”' }),
  ],
  build(a, title) {
    const setting = one(a, 'setting', 'fantasy');
    const progression = many(a, 'progression').join(',') || 'levels,tree,gear';
    const k = new Kit();
    base(k, setting);
    landmark(k, setting, [0, 0, -18]);
    k.prop('ent_hub_floor', 'Hub', 'cylinder', [0, 0.05, 6], [16, 0.1, 16], { color: '#8a857c' }, { shadow: false });
    npc(k, 'ent_guide', 'The Guide', [2, 0, 4], ['Welcome. Something stirs past the landmark — will you look into it?', 'Return when it is done.', 'You did it. The world is a little brighter.']);
    enemies(k, 'foe', 'Hostile', 'foe', [0, -22], 4, { hp: 45, dmg: 7, color: '#6b5e70', loot: progression.includes('gear') ? 'enemy_drop' : undefined, xp: 40 });
    for (let i = 0; i < 4; i++) k.spawn(`ent_spawn_${i + 1}`, [-3 + i * 2, 0, 14]);
    const caster = one(a, 'combat', 'action') === 'caster';
    const db = rpgDatabase(setting, progression, 'per_answers');
    const party = one(a, 'party', 'coop4');
    return k.build({
      name: `${title} — Greybox`,
      environment: { ...pick(envFor(setting)), exposure: 1.05 },
      game: {
        genre: 'rpg',
        controller: 'character',
        camera: 'third_person',
        win: 'objectives',
        maxPlayers: party === 'solo' ? 1 : party === 'coop2' ? 2 : 4,
        player: caster ? { primaryAbility: (db.abilities as Array<{ id: string }>)[0]!.id } : {},
        objectives: [
          { id: 'meet', label: 'Speak with the Guide', kind: 'interact', target: 'ent_guide' },
          { id: 'clear', label: 'Deal with the threat', kind: 'defeat', target: '#foe', count: 4 },
          { id: 'return', label: 'Return to the Guide', kind: 'interact', target: 'ent_guide' },
        ],
      },
      database: db,
    });
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** RPG · **Setting:** ${one(a, 'setting', 'fantasy')} · **Tone:** ${one(a, 'tone', 'heroic')}\n\n**Hook:** ${one(a, 'hook', '(to be written)')}\n\n**Combat:** ${one(a, 'combat', 'action')} · **Progression:** ${many(a, 'progression').join(', ') || 'levels, tree, gear'} · **Party:** ${one(a, 'party', 'coop4')} · **Scope:** ${one(a, 'scope', 'village')}`,
      plan: [
        'Replace the greybox hub with the starting settlement (landmark visible from spawn)',
        'Write the Guide and 2–3 villagers with dialogue that sets up the hook',
        'Design the first zone: teach → test → reward pacing; 2 enemy types tuned per forge-rpg tables',
        'Extend the quest chain (scene.game.objectives) to 4–6 steps with a climax encounter',
        'Tune abilities, tree and loot; playtest the full chain headlessly (forge_playtest)',
        'Dress with lighting and props; capture overview and focus shots for review',
      ],
    };
  },
};

const mmorpg: Starter = {
  id: 'mmorpg',
  code: 'MMO',
  genre: 'mmorpg',
  name: 'MMORPG',
  tagline: 'A shared online world: hubs, zones, classes, groups. Define the kind of MMO first.',
  accent: '#59c8ff',
  skill: 'forge-mmo',
  questions: [
    SETTING,
    q('style', 'What kind of MMO is it?', 'single', [
      ['themepark', 'Theme-park', 'quest hubs, guided zones, dungeons'],
      ['sandbox', 'Sandbox', 'player-driven economy and goals'],
      ['social', 'Social / cozy', 'hangouts, crafting, events'],
      ['action', 'Action MMO', 'skill-based combat, open fights'],
    ], { default: 'themepark' }),
    q('combat', 'Combat model?', 'single', [['action', 'Action (aim + abilities)'], ['caster', 'Ability bar (click casts main ability)']], { default: 'action' }),
    q('classes', 'Character building?', 'single', [
      ['classless', 'Classless skill tree', 'mix freely'],
      ['three', 'Three classic roles', 'tank / damage / support'],
      ['gear', 'Gear defines you', 'loadouts over levels'],
    ], { default: 'classless' }),
    q('pvp', 'Player vs player?', 'single', [['none', 'None — co-op only'], ['zones', 'Opt-in PvP zones'], ['open', 'Open-world PvP']], { default: 'none' }),
    q('session', 'Players per world instance?', 'single', [['8', '8'], ['16', '16'], ['32', '32'], ['64', '64 (max)']], { default: '32', help: 'FORGE runs authoritative rooms up to 64 players each.' }),
    q('hook', 'What brings players back every day?', 'text', [], { help: 'e.g. “World bosses that roam at dusk and drop shard gear.”' }),
  ],
  build(a, title) {
    const setting = one(a, 'setting', 'fantasy');
    const k = new Kit();
    base(k, setting, 140);
    k.prop('ent_plaza', 'Hub Plaza', 'cylinder', [0, 0.1, 0], [28, 0.2, 28], { color: '#8d8a84' }, { solid: true, shadow: false });
    landmark(k, setting, [0, 0, 0]);
    for (let i = 0; i < 8; i++) {
      const ang = (i / 8) * Math.PI * 2;
      k.spawn(`ent_spawn_${i + 1}`, [Math.cos(ang) * 7, 0.2, Math.sin(ang) * 7], (-ang * 180) / Math.PI - 90);
    }
    npc(k, 'ent_warden', 'Zone Warden', [-4, 0, -10], ['The field to the east needs clearing. Report back when it is done.', 'The field still crawls with them.', 'Good work. They always come back — so will you.'], '#d9b56a');
    npc(k, 'ent_vendor', 'Vendor', [8, 0, -6], ['Trade opens soon. Bring trophies.'], '#9c7a5a');
    enemies(k, 'mob', 'Field Mob', 'mob', [36, 0], 8, { hp: 35, dmg: 5, color: '#6fd17a', respawn: 20, xp: 25, loot: 'enemy_drop' });
    const db = rpgDatabase(setting, one(a, 'classes', 'classless') === 'gear' ? 'levels,gear' : 'levels,tree,gear', one(a, 'classes', 'classless'));
    return k.build({
      name: `${title} — World Hub`,
      environment: { ...pick(envFor(setting)), exposure: 1.0 },
      game: {
        genre: 'mmorpg',
        controller: 'character',
        camera: 'third_person',
        win: 'none',
        maxPlayers: Number(one(a, 'session', '32')),
        pvp: one(a, 'pvp', 'none') === 'open',
        respawnSeconds: 5,
        player: one(a, 'combat', 'action') === 'caster' ? { primaryAbility: (db.abilities as Array<{ id: string }>)[0]!.id } : {},
        objectives: [
          { id: 'report', label: 'Report to the Zone Warden', kind: 'interact', target: 'ent_warden' },
          { id: 'clear', label: 'Clear the eastern field', kind: 'defeat', target: '#mob', count: 6 },
          { id: 'return', label: 'Return to the Warden', kind: 'interact', target: 'ent_warden' },
        ],
      },
      database: db,
    });
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** MMORPG (${one(a, 'style', 'themepark')}) · **Setting:** ${one(a, 'setting', 'fantasy')}\n\n**Retention hook:** ${one(a, 'hook', '(to be written)')}\n\n**Combat:** ${one(a, 'combat', 'action')} · **Build:** ${one(a, 'classes', 'classless')} · **PvP:** ${one(a, 'pvp', 'none')} · **Instance:** ${one(a, 'session', '32')} players`,
      plan: [
        'Build the hub: landmark, vendors, quest board, clear exits to zones',
        'Lay out difficulty rings: fodder near hub → standard → elite at the edge with a landmark',
        'Define classes/trees per the build answer; tune per forge-rpg tables',
        'Add the daily-return hook (roaming boss, timed event) as NPCs + objectives',
        'Host a session and playtest with 2+ clients; check respawn pacing',
      ],
    };
  },
};

const adventure: Starter = {
  id: 'adventure',
  code: 'ADV',
  genre: 'exploration',
  name: 'Action-Adventure',
  tagline: 'Explore, solve, unlock. Keys, gates, secrets and a goal at the end.',
  accent: '#ff6a2b',
  skill: 'forge-game-builder',
  questions: [
    SETTING,
    TONE,
    q('focus', 'What is the core of play?', 'multi', [['explore', 'Exploration'], ['puzzles', 'Gates & puzzles'], ['combat', 'Combat'], ['story', 'Story & characters']], { default: ['explore', 'puzzles'] }),
    q('gating', 'How is progress gated?', 'single', [['keys', 'Keys & locked doors'], ['abilities', 'New abilities'], ['story', 'Story beats']], { default: 'keys' }),
    q('hook', 'What is the player trying to reach?', 'text', [], { help: 'e.g. “The summit observatory before the storm hits.”' }),
  ],
  build(a, title) {
    const setting = one(a, 'setting', 'fantasy');
    const k = new Kit();
    base(k, setting);
    k.solid('ent_gate_wall_l', 'Wall', [-5, 2, -10], [6, 4, 1], { color: '#8a857c' });
    k.solid('ent_gate_wall_r', 'Wall', [5, 2, -10], [6, 4, 1], { color: '#8a857c' });
    k.add({ id: 'ent_gate', name: 'Gate', transform: { position: [0, 1.5, -10] }, components: { mesh: { shape: 'box', size: [4, 3, 0.4], material: { color: '#3a3f46', metalness: 0.6 } }, collider: {}, rigidBody: { kind: 'kinematic' }, interactable: { verb: 'open', prompt: 'Open the gate', requiresItem: 'gate_key' } }, tags: ['door'] });
    k.add({ id: 'ent_key', name: 'Gate Key', transform: { position: [-12, 0.8, 4] }, components: { mesh: { shape: 'torus', size: [0.5, 0.5, 0.5], material: { color: '#f2b33d', emissive: '#f2b33d', emissiveIntensity: 3 } }, collider: { shape: 'sphere', size: [1, 1, 1], isTrigger: true, layer: 'interact' }, interactable: { verb: 'pickup', prompt: 'Take the key', grantsItem: 'gate_key' } }, tags: ['pickup'] });
    landmark(k, setting, [0, 0, -24]);
    k.add({ id: 'ent_goal', name: 'Goal', transform: { position: [0, 1, -21] }, components: { collider: { shape: 'box', size: [4, 2, 4], isTrigger: true, layer: 'trigger' } }, tags: ['goal'] });
    for (let i = 0; i < 4; i++) k.spawn(`ent_spawn_${i + 1}`, [-3 + i * 2, 0, 14]);
    return k.build({
      name: `${title} — Greybox`,
      environment: pick(envFor(setting)),
      game: {
        genre: 'exploration', controller: 'character', camera: 'third_person', win: 'objectives', maxPlayers: 4,
        objectives: [
          { id: 'key', label: 'Find the key', kind: 'collect', target: 'gate_key' },
          { id: 'gate', label: 'Open the gate', kind: 'interact', target: 'ent_gate' },
          { id: 'goal', label: 'Reach the landmark', kind: 'reach', target: 'ent_goal' },
        ],
      },
    });
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** Action-adventure · **Setting:** ${one(a, 'setting', 'fantasy')} · **Tone:** ${one(a, 'tone', 'heroic')}\n\n**Goal:** ${one(a, 'hook', '(to be written)')}\n\n**Core:** ${many(a, 'focus').join(', ')} · **Gating:** ${one(a, 'gating', 'keys')}`,
      plan: ['Derive player metrics; block out the critical path', 'Add 2–3 gates with keys/abilities; verify no soft-locks with playtests', 'Place secrets off the golden path', 'Pace teach → test → reward; dress with landmarks and light'],
    };
  },
};

const fighting: Starter = {
  id: 'fighting',
  code: 'FGT',
  genre: 'fighting',
  name: 'Fighting',
  tagline: 'One-on-one versus. Style, rules and stage first — the roster grows from there.',
  accent: '#e3608f',
  skill: 'forge-fighting',
  questions: [
    q('style', 'What kind of fighting game?', 'single', [['street', 'Street brawler'], ['martial', 'Martial arts'], ['fantasy', 'Fantasy duelists'], ['mech', 'Robots / mechs'], ['party', 'Party brawler', 'chaotic, casual']], { default: 'martial' }),
    q('rounds', 'Match length?', 'single', [['1', 'Single round'], ['3', 'Best of 3'], ['5', 'Best of 5']], { default: '3' }),
    q('pace', 'Pace?', 'single', [['heavy', 'Heavy & deliberate'], ['mid', 'Balanced'], ['fast', 'Fast & aggressive']], { default: 'mid' }),
    q('stage', 'Describe the first stage', 'text', [], { help: 'e.g. “A rain-soaked rooftop under neon signs.”' }),
  ],
  build(a, title) {
    const k = new Kit();
    const style = one(a, 'style', 'martial');
    const tint = style === 'mech' ? '#59c8ff' : style === 'fantasy' ? '#b9a8ff' : style === 'street' ? '#f2b33d' : '#e3608f';
    k.prop('ent_floor', 'Floor', 'box', [0, -0.05, 0], [60, 0.1, 40], { color: '#16161a' }, { solid: true, tags: ['terrain'], shadow: false });
    k.solid('ent_stage', 'Stage', [0, 0.5, 0], [18, 1, 8], { color: '#3a3e46', roughness: 0.55, metalness: 0.4 }, { tags: ['arena'] });
    k.solid('ent_wall_w', 'Stage Edge', [-8.8, 2, 0], [0.2, 3, 7], { color: tint, emissive: tint, emissiveIntensity: 0.5, opacity: 0.3 }, { shadow: false });
    k.solid('ent_wall_e', 'Stage Edge', [8.8, 2, 0], [0.2, 3, 7], { color: tint, emissive: tint, emissiveIntensity: 0.5, opacity: 0.3 }, { shadow: false });
    k.light('ent_key', 'Key Light', 'spot', [0, 14, 2], { intensity: 900, range: 40, angle: 32, castShadow: true, rotation: [-82, 0, 0] });
    k.light('ent_rim_w', 'Rim West', 'point', [-10, 4, 3], { color: '#ff6a2b', intensity: 60, range: 18 });
    k.light('ent_rim_e', 'Rim East', 'point', [10, 4, 3], { color: tint, intensity: 60, range: 18 });
    k.light('ent_fill', 'Fill', 'hemisphere', [0, 10, 0], { color: '#3a3f55', groundColor: '#0b0b0e', intensity: 0.6 });
    k.spawn('ent_spawn_p1', [-3, 1, 0], -90, 'p1');
    k.spawn('ent_spawn_p2', [3, 1, 0], 90, 'p2');
    const pace = one(a, 'pace', 'mid');
    return k.build({
      name: `${title} — Stage 1`,
      environment: { background: '#0b0b0f', fogColor: '#0b0b0f', fogDensity: 0.02 },
      game: { genre: 'fighting', controller: 'fighter', camera: 'side', win: 'ko', rounds: Number(one(a, 'rounds', '3')), bots: 1, maxPlayers: 2, player: { health: pace === 'fast' ? 80 : pace === 'heavy' ? 130 : 100 } },
    });
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** Fighting (${one(a, 'style', 'martial')}) · **Rounds:** best of ${one(a, 'rounds', '3')} · **Pace:** ${one(a, 'pace', 'mid')}\n\n**Stage 1:** ${one(a, 'stage', '(to be described)')}`,
      plan: ['Dress stage 1 to the description; keep the fight plane readable', 'Tune health to the pace; prove rounds resolve via playtest', 'Propose a moveset component for distinct characters (next runtime milestone)'],
    };
  },
};

const racing: Starter = {
  id: 'racing',
  code: 'RCE',
  genre: 'racing',
  name: 'Racing',
  tagline: 'Pick the machines, the handling and the venue. The circuit is your sandbox.',
  accent: '#f2b33d',
  skill: 'forge-racing',
  questions: [
    q('vehicles', 'What do players drive?', 'single', [['cars', 'Street cars'], ['rally', 'Rally / off-road'], ['karts', 'Karts', 'small, nimble'], ['hover', 'Hover craft', 'fast, floaty']], { default: 'cars' }),
    q('handling', 'Handling?', 'single', [['grip', 'Grippy & precise'], ['balanced', 'Balanced'], ['loose', 'Loose & drifty']], { default: 'balanced' }),
    q('venue', 'Where do races happen?', 'single', [['stadium', 'Stadium circuit'], ['desert', 'Desert'], ['city', 'Night city'], ['alpine', 'Alpine']], { default: 'stadium' }),
    q('laps', 'Laps per race?', 'single', [['1', '1'], ['3', '3'], ['5', '5']], { default: '3' }),
    q('rivals', 'AI rivals?', 'single', [['0', 'None (time trial)'], ['3', '3'], ['5', '5']], { default: '3' }),
  ],
  build(a, title) {
    const scene = dustCircuitScene();
    const v = one(a, 'vehicles', 'cars');
    const h = one(a, 'handling', 'balanced');
    const venue = one(a, 'venue', 'stadium');
    const env: Record<string, Record<string, unknown>> = {
      stadium: { background: '#a9c4dc', fogColor: '#d6c7ad', fogDensity: 0.0045 },
      desert: { background: '#e8c99a', fogColor: '#e2c8a0', fogDensity: 0.006 },
      city: { background: '#0a0d16', fogColor: '#121726', fogDensity: 0.012, exposure: 1.2 },
      alpine: { background: '#c9d8e8', fogColor: '#e6eef6', fogDensity: 0.008 },
    };
    scene.name = `${title} — Circuit 1`;
    Object.assign(scene.environment, env[venue] ?? {});
    const rivals = Number(one(a, 'rivals', '3'));
    scene.game = {
      ...scene.game,
      laps: Number(one(a, 'laps', '3')),
      bots: Math.min(rivals, 3),
      vehicle: {
        maxSpeed: v === 'karts' ? 24 : v === 'hover' ? 40 : v === 'rally' ? 30 : 34,
        acceleration: v === 'karts' ? 20 : 16,
        braking: 28,
        turnRate: h === 'grip' ? 2.4 : h === 'loose' ? 1.8 : 2.1,
      },
    };
    return scene;
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** Racing · **Vehicles:** ${one(a, 'vehicles', 'cars')} · **Handling:** ${one(a, 'handling', 'balanced')} · **Venue:** ${one(a, 'venue', 'stadium')} · **Laps:** ${one(a, 'laps', '3')} · **Rivals:** ${one(a, 'rivals', '3')}`,
      plan: ['Reshape the circuit for the venue (checkpoint at every corner)', 'Tune vehicle stats for the handling answer; prove the track with autopilot', 'Dress the venue; keep the racing line readable'],
    };
  },
};

const shooter: Starter = {
  id: 'shooter',
  code: 'SHT',
  genre: 'sandbox',
  name: 'Arena Shooter',
  tagline: 'Third-person shooting against waves or each other. Weapons are abilities you can tune.',
  accent: '#9bd15a',
  skill: 'forge-game-builder',
  questions: [
    SETTING,
    q('mode', 'Main mode?', 'single', [['waves', 'Survive the waves (co-op)'], ['ffa', 'Free-for-all (PvP)']], { default: 'waves' }),
    q('weapons', 'Weapon flavor?', 'single', [['ballistic', 'Ballistic'], ['energy', 'Energy'], ['magic', 'Magic']], { default: 'ballistic' }),
    q('pace', 'Pace?', 'single', [['tactical', 'Tactical'], ['arcade', 'Arcade']], { default: 'arcade' }),
  ],
  build(a, title) {
    const setting = one(a, 'setting', 'scifi');
    const k = new Kit();
    base(k, setting, 70);
    for (let i = 0; i < 10; i++) {
      const ang = (i / 10) * Math.PI * 2;
      k.solid(`ent_cover_${i}`, 'Cover', [Math.cos(ang) * 12, 0.75, Math.sin(ang) * 12], [3, 1.5, 0.8], { color: '#6c6f72' }, { rotation: [0, (-ang * 180) / Math.PI, 0] });
    }
    landmark(k, setting, [0, 0, 0]);
    const waves = one(a, 'mode', 'waves') === 'waves';
    if (waves) enemies(k, 'drone', 'Hostile Drone', 'drone', [0, -24], 6, { hp: 30, dmg: 6, color: '#e3608f', respawn: 12, xp: 15 });
    for (let i = 0; i < 4; i++) k.spawn(`ent_spawn_${i + 1}`, [-6 + i * 4, 0, 22], 0);
    const w = one(a, 'weapons', 'ballistic');
    const names = w === 'energy' ? ['Pulse Rifle', 'Arc Grenade'] : w === 'magic' ? ['Spark Lance', 'Hex Burst'] : ['Rifle', 'Frag Grenade'];
    const arcade = one(a, 'pace', 'arcade') === 'arcade';
    return k.build({
      name: `${title} — Arena`,
      environment: pick(envFor(setting)),
      game: {
        genre: 'sandbox', controller: 'character', camera: 'third_person', win: waves ? 'objectives' : 'none', maxPlayers: waves ? 4 : 8, pvp: !waves,
        respawnSeconds: 3,
        player: { primaryAbility: 'shoot', secondaryAbility: 'grenade', health: arcade ? 120 : 90, sprintSpeed: arcade ? 8 : 6.5 },
        objectives: waves ? [{ id: 'hold', label: 'Destroy 20 drones', kind: 'defeat', target: '#drone', count: 20 }] : [],
      },
      database: {
        stats: [
          { id: 'health', name: 'Health', base: arcade ? 120 : 90, resource: true, regen: arcade ? 4 : 1, color: '#e3608f' },
          { id: 'ammo', name: 'Ammo', base: 30, resource: true, regen: 6, color: '#f2b33d' },
          { id: 'power', name: 'Power', base: 0 },
        ],
        abilities: [
          { id: 'shoot', name: names[0], target: 'ray', range: 40, windup: 0, cooldown: arcade ? 0.18 : 0.3, cost: [{ stat: 'ammo', amount: 1 }], effects: [{ kind: 'damage', amount: arcade ? 9 : 14 }], color: '#f2b33d' },
          { id: 'grenade', name: names[1], target: 'aoe', radius: 4.5, windup: 0.35, cooldown: 6, effects: [{ kind: 'damage', amount: 35 }, { kind: 'knockback', force: 8 }], color: '#ff6a2b' },
          { id: 'medkit', name: 'Medkit', target: 'self', windup: 0.8, cooldown: 15, effects: [{ kind: 'heal', amount: 50 }], color: '#9bd15a' },
        ],
        loadout: { abilities: ['shoot', 'grenade', 'medkit'] },
      },
    });
  },
  seed(a, title) {
    return {
      gdd: `# ${title}\n\n**Genre:** Third-person arena shooter · **Setting:** ${one(a, 'setting', 'scifi')} · **Mode:** ${one(a, 'mode', 'waves')} · **Weapons:** ${one(a, 'weapons', 'ballistic')} · **Pace:** ${one(a, 'pace', 'arcade')}`,
      plan: ['Shape the arena: cover rings, sightlines, flank routes', 'Tune time-to-kill (forge skills: shooter feel); prove waves with autopilot', 'Add weapon variety as abilities; game feel pass'],
    };
  },
};

function pick(e: (typeof ENV)[string]) {
  return { background: e.background, fogColor: e.fogColor, fogDensity: e.fogDensity };
}

export const starters: Record<string, Starter> = { rpg, mmorpg, adventure, fighting, racing, shooter };

export function starterInfo(s: Starter): StarterInfo {
  const { build: _b, seed: _s, ...info } = s;
  return info;
}
