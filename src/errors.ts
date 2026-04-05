export class VDRPipelineError extends Error {
  code: string;
  context?: Record<string, any>;

  constructor(message: string, code: string, context?: Record<string, any>) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export class AnchorConfigError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ANCHOR_CONFIG_ERROR', context);
  }
}

export class SessionFinalizedError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SESSION_FINALIZED_ERROR', context);
  }
}

export class EmptySessionError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'EMPTY_SESSION_ERROR', context);
  }
}

export class PipelineSerializationError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'PIPELINE_SERIALIZATION_ERROR', context);
  }
}

export class MerkleConstructionError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'MERKLE_CONSTRUCTION_ERROR', context);
  }
}

export class MerkleProofError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'MERKLE_PROOF_ERROR', context);
  }
}

export class AnchorTransactionError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ANCHOR_TRANSACTION_ERROR', context);
  }
}

export class SipHeronAPIError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'SIPHERON_API_ERROR', context);
  }
}

export class LineageError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'LINEAGE_ERROR', context);
  }
}

export class ZKProofError extends VDRPipelineError {
  constructor(message: string, context?: Record<string, any>) {
    super(message, 'ZK_PROOF_ERROR', context);
  }
}
