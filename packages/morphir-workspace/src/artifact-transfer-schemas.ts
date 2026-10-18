/** Structural JSON Schemas. Use artifact-transfer.ts for the additional wire semantics. */
import generateRequest from '../schemas/artifacts/0.1.0-draft.1/generate-request.schema.json' with { type: 'json' }
import generateResult from '../schemas/artifacts/0.1.0-draft.1/generate-result.schema.json' with { type: 'json' }
import readRequest from '../schemas/artifacts/0.1.0-draft.1/read-request.schema.json' with { type: 'json' }
import readResult from '../schemas/artifacts/0.1.0-draft.1/read-result.schema.json' with { type: 'json' }
import releaseRequest from '../schemas/artifacts/0.1.0-draft.1/release-request.schema.json' with { type: 'json' }
import releaseResult from '../schemas/artifacts/0.1.0-draft.1/release-result.schema.json' with { type: 'json' }

export const ARTIFACT_JSON_SCHEMAS = Object.freeze({
  generateRequest,
  generateResult,
  readRequest,
  readResult,
  releaseRequest,
  releaseResult,
})
