export interface DelegateProposalMetadata {
  id: string;
  expiresAt: number;
  changedFiles: string[];
  diffStat: string;
  diffPreview: string;
}

export interface DelegateResult {
  exitCode: number;
  summary: string;
  proposal?: DelegateProposalMetadata;
  noChanges?: boolean;
}
