import type { SceneDoc } from '@forge/contracts';
import { Kit } from './kit';

/**
 * IRON RING — 2.5D fighting. A raised ring under hard top-light. Best of 3 rounds,
 * light/heavy attacks, blocking, knockback, hitstun. A sparring bot fills the
 * second seat until a second player joins.
 */
export function ironRingScene(): SceneDoc {
  const k = new Kit();
  k.prop('ent_floor', 'Hall Floor', 'box', [0, -0.05, 0], [60, 0.1, 40], { color: '#16161a', roughness: 0.9 }, { solid: true, tags: ['terrain'], shadow: false });
  k.solid('ent_ring', 'Ring Platform', [0, 0.5, 0], [18, 1, 8], { color: '#3a3e46', roughness: 0.55, metalness: 0.5 }, { tags: ['arena'] });
  k.prop('ent_ring_mat', 'Canvas', 'box', [0, 1.005, 0], [16.5, 0.01, 6.8], { color: '#c9c2b4', roughness: 0.95 }, { shadow: false });
  k.prop('ent_ring_line', 'Center Line', 'box', [0, 1.012, 0], [0.12, 0.01, 6.8], { color: '#ff6a2b', emissive: '#ff6a2b', emissiveIntensity: 1.5 }, { shadow: false });

  // Posts + ropes. The end ropes are solid so fighters can't leave the ring.
  for (const x of [-8.8, 8.8])
    for (const z of [-3.6, 3.6]) k.prop(`ent_post_${x > 0 ? 'e' : 'w'}${z > 0 ? 's' : 'n'}`, 'Ring Post', 'cylinder', [x, 2.1, z], [0.3, 2.2, 0.3], { color: '#202226', metalness: 0.8, roughness: 0.3 });
  for (const [i, y] of [1.6, 2.2, 2.8].entries()) {
    k.prop(`ent_rope_n${i}`, 'Rope', 'box', [0, y, -3.6], [17.6, 0.06, 0.06], { color: '#e3608f', emissive: '#e3608f', emissiveIntensity: 0.8 }, { shadow: false });
    k.prop(`ent_rope_s${i}`, 'Rope', 'box', [0, y, 3.6], [17.6, 0.06, 0.06], { color: '#e3608f', emissive: '#e3608f', emissiveIntensity: 0.8 }, { shadow: false });
  }
  k.solid('ent_rope_w', 'West Ropes', [-8.8, 2.2, 0], [0.2, 2.4, 7.2], { color: '#e3608f', emissive: '#e3608f', emissiveIntensity: 0.6, opacity: 0.35 }, { shadow: false });
  k.solid('ent_rope_e', 'East Ropes', [8.8, 2.2, 0], [0.2, 2.4, 7.2], { color: '#e3608f', emissive: '#e3608f', emissiveIntensity: 0.6, opacity: 0.35 }, { shadow: false });

  // Crowd silhouettes
  for (let i = 0; i < 14; i++) {
    const x = -13 + i * 2;
    k.prop(`ent_crowd_${i}`, 'Crowd', 'capsule', [x, 0.9, -10 - (i % 3)], [0.7, 1.8, 0.7], { color: '#24242b', roughness: 1 }, { shadow: false, tags: ['crowd'] });
  }

  k.light('ent_key', 'Top Light', 'spot', [0, 14, 2], { color: '#fff4e6', intensity: 900, range: 40, angle: 32, castShadow: true, rotation: [-82, 0, 0] });
  k.light('ent_rim_w', 'Rim West', 'point', [-10, 4, 3], { color: '#ff6a2b', intensity: 60, range: 18 });
  k.light('ent_rim_e', 'Rim East', 'point', [10, 4, 3], { color: '#4fd1c5', intensity: 60, range: 18 });
  k.light('ent_fill', 'House Fill', 'hemisphere', [0, 10, 0], { color: '#3a3f55', groundColor: '#0b0b0e', intensity: 0.6 });

  k.spawn('ent_spawn_p1', [-3, 1, 0], -90, 'p1');
  k.spawn('ent_spawn_p2', [3, 1, 0], 90, 'p2');

  return k.build({
    name: 'Iron Ring — Arena',
    environment: { background: '#0b0b0f', fogColor: '#0b0b0f', fogDensity: 0.02, exposure: 1.05, toneMapping: 'agx' },
    game: { genre: 'fighting', controller: 'fighter', camera: 'side', win: 'ko', rounds: 3, bots: 1, maxPlayers: 2, player: { health: 100 } },
  });
}
