

export interface InflightCommitAction {
  type: 'INFLIGHT_COMMIT';
  id: number;
}

export interface InflightRejectAction {
  type: 'INFLIGHT_REJECT';
  id: number;
  error: string;
}
