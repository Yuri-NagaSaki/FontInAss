export interface R2Node {
  prefix: string;
  name: string;
  type: "folder" | "file";
  size?: number;
  indexed?: boolean;
  loading?: boolean;
  expanded?: boolean;
  children?: R2Node[];
  cursor?: string | null;
  hasMore?: boolean;
  loadingMore?: boolean;
  fileCount?: number;
}

export interface IndexProg {
  active: boolean;
  indexed: number;
  skipped: number;
  total: number;
  phase: string;
  errors?: number;
}
