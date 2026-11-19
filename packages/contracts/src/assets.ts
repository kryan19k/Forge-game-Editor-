import { z } from 'zod';
import { Vec3 } from './primitives';

export const AssetId = z.string().regex(/^asset_[0-9a-f]{16}$/);
export const AssetStatus = z.enum(['queued', 'generating', 'review', 'approved', 'rejected', 'failed']);
export const AssetMetrics = z.object({
  bytes: z.number().int().positive(),
  triangles: z.number().int().positive(),
  dimensions: Vec3,
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});
export type AssetMetrics = z.output<typeof AssetMetrics>;

export const AssetRecord = z.object({
  id: AssetId,
  family: AssetId,
  version: z.number().int().positive(),
  name: z.string().trim().min(1).max(80),
  prompt: z.string().trim().min(3).max(1024).optional(),
  sourceFile: z.string().max(255).optional(),
  provider: z.enum(['tripo', 'local']),
  model: z.string(),
  status: AssetStatus,
  progress: z.number().min(0).max(100),
  createdAt: z.number(),
  credits: z.number().nonnegative().optional(),
  metrics: AssetMetrics.optional(),
  error: z.string().optional(),
});
export type AssetRecord = z.output<typeof AssetRecord>;

export const AssetGenerate = AssetRecord.pick({ name: true, prompt: true }).required().extend({ versionOf: AssetId.optional() });
export type AssetGenerate = z.output<typeof AssetGenerate>;
export const AssetImport = z.object({
  fileName: z.string().trim().min(5).max(255).regex(/^[^\\/\u0000-\u001F]+\.glb$/i, 'Choose a local .glb file.'),
});
export const AssetPlacement = z.object({
  asset: AssetId,
  position: Vec3,
  meters: z.number().min(0.1).max(100).default(2),
});
export type AssetPlacement = z.output<typeof AssetPlacement>;

export interface AssetLibrary {
  projectId: string;
  configured: boolean;
  assets: AssetRecord[];
}
