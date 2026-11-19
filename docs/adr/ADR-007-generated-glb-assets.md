# ADR-007 · Generated static GLB assets

**Status:** accepted · 2026-11-19

Tripo v3 is the first text-to-3D provider. A Director action starts the paid job. The daemon persists the task ID before polling and resumes known tasks after a restart. It stores the key alongside the Claude key in `workspace/secrets.json`. The provider adapter downloads from Tripo HTTPS hosts without forwarding the credential.

Each registry entry stores prompt, provider, model, credits when supplied, a SHA-256 digest and measured geometry. Each version has a separate immutable GLB file. Validation accepts self-contained static triangle meshes within byte, triangle, vertex and texture limits. The Director can preview a candidate and approve or reject it. Only approved versions can be assigned to entities.

Studio and PlaySession use the same GLTFLoader-backed scene reconciler. It centers the model and scales the longest axis to one meter before applying the mesh size. Placement uses a transaction and includes a bounds-based box collider. Headless simulation consumes the typed collider data and has no loader or browser dependency.

[Tripo generation API](https://developers.tripo3d.ai/en/docs/generation-text-to-model/standard) · [Tripo task query API](https://developers.tripo3d.ai/en/docs/task-query)
