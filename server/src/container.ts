import { ActivityLog } from "@fontinass/activity-log";
import { UploadAccess } from "@fontinass/access-control";
import { DefaultArchiveLibrary, SystemArchiveInspector, type ArchiveLibrary } from "@fontinass/archive-library";
import type { SchedulerStatus } from "@fontinass/contracts";
import { FontCatalog } from "@fontinass/font-catalog";
import { FontSubmission } from "@fontinass/font-submission";
import {
  SqliteActivityRepository,
  SqliteArchiveRepository,
  SqliteDatabase,
  SqliteFontCatalogRepository,
  SqliteUploadAccessRepository,
} from "@fontinass/persistence";
import { FsFontFileStore, FsPendingArchiveStore, R2PublishedArchiveStore } from "@fontinass/storage";
import { DefaultSubtitleProcessor, OpenTypeFontInspector, type SubtitleProcessor } from "@fontinass/subtitle-processing";
import { loadRuntimeConfig, RuntimeLogger, type RuntimeConfig } from "./runtime.js";

export interface AppContainer {
  config: RuntimeConfig;
  logger: RuntimeLogger;
  database: SqliteDatabase;
  fonts: FontCatalog;
  archives: ArchiveLibrary;
  uploadAccess: UploadAccess;
  submissions: FontSubmission;
  activity: ActivityLog;
  subtitles: SubtitleProcessor;
  bootstrap(): Promise<void>;
  startScheduler(): void;
  stopScheduler(): void;
  getSchedulerStatus(): SchedulerStatus;
  close(): void;
}

export function createContainer(config = loadRuntimeConfig()): AppContainer {
  const logger = new RuntimeLogger(config);
  const database = new SqliteDatabase(config.databasePath);
  const fontFiles = new FsFontFileStore(config.fontDirectory);
  const fonts = new FontCatalog(
    new SqliteFontCatalogRepository(database),
    fontFiles,
    new OpenTypeFontInspector(),
    logger,
    config.subsetConcurrency,
  );
  const published = new R2PublishedArchiveStore(config.r2);
  const archives = new DefaultArchiveLibrary(
    new SqliteArchiveRepository(database),
    published,
    new FsPendingArchiveStore(config.pendingDirectory),
    new SystemArchiveInspector(config.archiveMaxUncompressed),
    { maxFileSize: config.archiveMaxFileSize, dailyContributionLimit: config.contributionDailyLimit },
  );
  const uploadAccess = new UploadAccess(new SqliteUploadAccessRepository(database), {
    applicationDailyLimit: config.tokenApplicationDailyLimit,
    publicUploadRequestsPerMinute: config.publicUploadRequestsPerMinute,
  });
  const submissions = new FontSubmission(uploadAccess, fonts, {
    targetDirectory: config.uploadTargetDirectory,
    maxFiles: config.publicUploadMaxFiles,
    maxFileBytes: config.publicUploadMaxFileSize,
    maxBatchBytes: config.publicUploadMaxBatchSize,
    concurrency: config.subsetConcurrency,
  });
  const activity = new ActivityLog(new SqliteActivityRepository(database));
  const subtitles = new DefaultSubtitleProcessor(fonts, logger, { cacheEntries: config.cacheMaxEntries });

  let interval: ReturnType<typeof setInterval> | null = null;
  let schedulerEnabled = false;
  let schedulerRunning = false;
  let lastRunAt: string | null = null;
  let nextRunAt: string | null = null;
  let lastResult: SchedulerStatus["lastResult"] = null;

  const runScheduler = async () => {
    if (schedulerRunning) return;
    schedulerRunning = true;
    try {
      const scan = await fonts.scan();
      const dedup = await fonts.deduplicate();
      lastResult = {
        indexed: scan.indexed,
        purged: scan.purged,
        deduplicated: dedup.removed,
        error: null,
      };
      lastRunAt = new Date().toISOString();
      logger.info(`[scheduler] indexed=${scan.indexed} purged=${scan.purged} deduplicated=${dedup.removed}`);
    } catch (error) {
      lastResult = {
        indexed: 0,
        purged: 0,
        deduplicated: 0,
        error: error instanceof Error ? error.message : String(error),
      };
      lastRunAt = new Date().toISOString();
      logger.error("[scheduler] failed", error);
    } finally {
      schedulerRunning = false;
      if (schedulerEnabled) {
        nextRunAt = new Date(Date.now() + config.autoIndexIntervalHours * 60 * 60 * 1000).toISOString();
      }
    }
  };

  return {
    config, logger, database, fonts, archives, uploadAccess, submissions, activity, subtitles,
    async bootstrap() {
      fontFiles.ensureReady();
      logger.prune();
      if (archives.listPublished().length === 0 && published.isConfigured()) {
        try {
          const restored = await archives.restoreFromManifest();
          if (restored) logger.info(`[bootstrap] restored ${restored} archives from R2 manifest`);
        } catch (error) { logger.error("[bootstrap] archive manifest restore failed", error); }
      }
      const repair = await fonts.repairUnnamed();
      if (repair.attempted) logger.info(`[bootstrap] repaired ${repair.repaired}/${repair.attempted} unnamed font entries`);
    },
    startScheduler() {
      if (interval) return;
      schedulerEnabled = true;
      nextRunAt = new Date(Date.now() + config.autoIndexIntervalHours * 60 * 60 * 1000).toISOString();
      interval = setInterval(() => void runScheduler(), config.autoIndexIntervalHours * 60 * 60 * 1000);
    },
    stopScheduler() {
      if (interval) clearInterval(interval);
      interval = null;
      schedulerEnabled = false;
      nextRunAt = null;
    },
    getSchedulerStatus(): SchedulerStatus {
      return {
        enabled: schedulerEnabled,
        intervalHours: config.autoIndexIntervalHours,
        running: schedulerRunning,
        lastRunAt,
        nextRunAt: schedulerEnabled ? nextRunAt : null,
        lastResult,
      };
    },
    close() {
      if (interval) clearInterval(interval);
      interval = null;
      schedulerEnabled = false;
      database.close();
    },
  };
}
