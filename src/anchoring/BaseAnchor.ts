import { PipelineSession, AnchorResult } from '../types';

export abstract class BaseAnchor {
  abstract anchor(session: PipelineSession): Promise<AnchorResult>;
}
