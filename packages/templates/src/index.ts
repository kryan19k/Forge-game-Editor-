import type { Genre, ProjectInfo, SceneDoc } from '@forge/contracts';
import { dustCircuitScene } from './dust-circuit';
import { hollowValeScene } from './hollow-vale';
import { ironRingScene } from './iron-ring';
import { outpostZeroScene } from './outpost-zero';
import { shardlandsScene } from './shardlands';

export interface Template {
  id: string;
  /** Short genre code shown on gallery cards, e.g. "RPG-01". */
  code: string;
  name: string;
  genre: Genre;
  tagline: string;
  features: string[];
  players: string;
  controls: string;
  /** Accent color for the gallery card. */
  accent: string;
  /** Skill an agent should load before working in this template (.claude/skills). */
  skill: string;
  createScene: () => SceneDoc;
}

export const templates: Record<string, Template> = {
  'outpost-zero': {
    id: 'outpost-zero',
    code: 'EXP-01',
    name: 'Outpost Zero',
    genre: 'exploration',
    tagline: 'Find the keycard. Breach the hub. Upload the data.',
    features: ['third-person controller', 'locked doors + keys', 'pickups', 'objective terminal', 'dynamic props'],
    players: '1–4 co-op',
    controls: 'WASD · Shift · Space · E',
    accent: '#ff6a2b',
    skill: 'forge-game-builder',
    createScene: outpostZeroScene,
  },
  'hollow-vale': {
    id: 'hollow-vale',
    code: 'RPG-01',
    name: 'Hollow Vale',
    genre: 'rpg',
    tagline: 'A dusk village, an elder’s errand, wolves in the moonlit meadow.',
    features: ['NPC dialogue', 'quest chain', 'melee combat', 'wandering + hostile AI', 'collectibles'],
    players: '1–4 co-op',
    controls: 'WASD · Click attack · Right-click heavy · E talk',
    accent: '#b9a8ff',
    skill: 'forge-rpg',
    createScene: hollowValeScene,
  },
  shardlands: {
    id: 'shardlands',
    code: 'MMO-01',
    name: 'Shardlands',
    genre: 'mmorpg',
    tagline: 'A shared hub around a fallen shard. Vendors, a warden, fields that refill.',
    features: ['persistent world', 'up to 32 players', 'respawning field mobs', 'vendor NPCs', 'server authority'],
    players: '1–32 shared world',
    controls: 'WASD · Click attack · E talk',
    accent: '#59c8ff',
    skill: 'forge-mmo',
    createScene: shardlandsScene,
  },
  'iron-ring': {
    id: 'iron-ring',
    code: 'FGT-01',
    name: 'Iron Ring',
    genre: 'fighting',
    tagline: 'One ring. Two fighters. Best of three.',
    features: ['2.5D side camera', 'light / heavy / block', 'hitstun + knockback', 'rounds + KO', 'sparring bot'],
    players: '1–2 versus',
    controls: 'A/D move · W jump · J light · K heavy · L block',
    accent: '#e3608f',
    skill: 'forge-fighting',
    createScene: ironRingScene,
  },
  'dust-circuit': {
    id: 'dust-circuit',
    code: 'RCE-01',
    name: 'Dust Circuit',
    genre: 'racing',
    tagline: 'Three laps of a desert stadium against rivals who don’t brake.',
    features: ['arcade vehicle physics', 'checkpoints + laps', 'AI rivals', 'chase camera', 'live placing'],
    players: '1–4 grid',
    controls: 'W throttle · S brake · A/D steer',
    accent: '#f2b33d',
    skill: 'forge-racing',
    createScene: dustCircuitScene,
  },
};

export function projectFromTemplate(templateId: string, projectId = templateId, name?: string): { project: ProjectInfo; scene: SceneDoc } {
  const t = templates[templateId];
  if (!t) throw new Error(`unknown template ${templateId}`);
  return { project: { projectId, name: name ?? t.name, template: t.id }, scene: t.createScene() };
}

export { starters, starterInfo, type Starter } from './starters';
export { dustCircuitScene, hollowValeScene, ironRingScene, outpostZeroScene, shardlandsScene };
