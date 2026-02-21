export interface ProposalFileDiff {
  filePath: string;
  language: string;
  diff: string;
}

export interface DelegateProposalMetadata {
  id: string;
  projectName: string;
  expiresAt: number;
  changedFiles: string[];
  diffStat: string;
  diffPreview: string;
  fileDiffs: ProposalFileDiff[];
}

export interface DelegateResult {
  exitCode: number;
  summary: string;
  proposal?: DelegateProposalMetadata;
  noChanges?: boolean;
}
