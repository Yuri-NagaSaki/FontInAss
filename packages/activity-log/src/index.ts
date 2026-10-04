import type { LogStats, MissingFontRanking, ProcessingLog, ProcessingLogList } from "@fontinass/contracts";

export interface ProcessingEventInput {
  filename: string;
  clientIp: string | null;
  code: number;
  messages: string[];
  missingFonts: string[];
  fontCount: number;
  fileSize: number;
  elapsedMs: number;
}

export interface ActivityRepository {
  insert(input: ProcessingEventInput): void;
  list(query: { page: number; limit: number; search: string; code?: number }): ProcessingLogList;
  missingFonts(limit: number, showResolved: boolean): { total: number; data: MissingFontRanking[] };
  resolveFont(name: string): void;
  unresolveFont(name: string): void;
  stats(today: string): LogStats;
  prune(cutoffIso: string): number;
}

export class ActivityLog {
  private cachedStats: { day: string; expiresAt: number; value: LogStats } | null = null;
  constructor(private readonly repository: ActivityRepository) {}

  record(input: ProcessingEventInput): void {
    this.repository.insert(input);
    this.cachedStats = null;
  }

  list(query: { page?: number; limit?: number; search?: string; code?: number }): ProcessingLogList {
    return this.repository.list({
      page: Math.max(1, query.page ?? 1),
      limit: Math.min(200, Math.max(1, query.limit ?? 50)),
      search: query.search?.trim().toLowerCase() ?? "",
      code: query.code,
    });
  }

  missingFonts(limit = 50, showResolved = false): { total: number; data: MissingFontRanking[] } {
    return this.repository.missingFonts(Math.min(100, Math.max(1, limit)), showResolved);
  }

  resolve(name: string): void { this.repository.resolveFont(name); }
  unresolve(name: string): void { this.repository.unresolveFont(name); }
  stats(): LogStats {
    const day = new Date().toISOString().slice(0, 10);
    if (this.cachedStats?.day === day && this.cachedStats.expiresAt > Date.now()) return this.cachedStats.value;
    const value = this.repository.stats(day);
    this.cachedStats = { day, value, expiresAt: Date.now() + 1000 };
    return value;
  }
  prune(cutoffIso: string): number { this.cachedStats = null; return this.repository.prune(cutoffIso); }
}

export type { ProcessingLog };
