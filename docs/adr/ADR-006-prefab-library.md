# ADR-006 · Parameterized prefab subtrees

**Status:** accepted · 2026-11-19

Store prefab definitions in the project's scene database. Each definition has one root and typed entity components. Bind name and mesh albedo parameters to specific local IDs. The `set_prefab` mutation preserves the previous definition in its inverse and checks the definition's latest revision, including removal.

Placement remaps IDs and builds a parent-first transaction of entity creates at the requested world position. Instances are independent. Child transforms and authored colliders use the existing runtime, and undo removes the placed subtree. Selection capture keeps the root's local rotation and scale and resets its local origin.

Studio renders thumbnails on a separate canvas using the scene reconciler and the PNG capture code. Thumbnails are regenerated after definition changes. Descriptions create Team Room directives for an agent to compose a prefab.
