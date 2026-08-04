import { z } from "zod";

export const CODE = {
  OK: 200,
  WARN: 201,
  MISSING_FONT: 300,
  CLIENT_ERROR: 400,
  SERVER_ERROR: 500,
} as const;

export const CodeSchema = z.union([
  z.literal(CODE.OK),
  z.literal(CODE.WARN),
  z.literal(CODE.MISSING_FONT),
  z.literal(CODE.CLIENT_ERROR),
  z.literal(CODE.SERVER_ERROR),
]);
export type Code = z.infer<typeof CodeSchema>;

export const ErrorResponseSchema = z.object({
  error: z.string(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

export const HealthResponseSchema = z.object({
  status: z.enum(["ok", "error"]),
  version: z.literal(3),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;

// Font catalog wire contracts.
export const FontItemSchema = z.object({
  id: z.string(),
  filename: z.string(),
  size: z.number().int().nonnegative(),
  created_at: z.string(),
  names: z.array(z.string()),
  weight: z.number().int(),
  bold: z.boolean(),
  italic: z.boolean(),
});
export type FontItem = z.infer<typeof FontItemSchema>;

export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export const FontListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).default(""),
});
export type FontListQuery = z.infer<typeof FontListQuerySchema>;

export const FontListResponseSchema = PaginationQuerySchema.extend({
  total: z.number().int().nonnegative(),
  data: z.array(FontItemSchema),
});
export type FontListResponse = z.infer<typeof FontListResponseSchema>;

export const UploadResultSchema = z.object({
  filename: z.string(),
  id: z.string(),
  faces: z.number().int().nonnegative(),
  error: z.string().optional(),
});
export type UploadResult = z.infer<typeof UploadResultSchema>;

export const UploadResultsResponseSchema = z.object({ results: z.array(UploadResultSchema) });
export type UploadResultsResponse = z.infer<typeof UploadResultsResponseSchema>;

export const BrowseFileSchema = z.object({
  key: z.string(),
  name: z.string(),
  size: z.number().int().nonnegative(),
  indexed: z.boolean(),
});
export type BrowseFile = z.infer<typeof BrowseFileSchema>;

export const BrowseQuerySchema = z.object({
  prefix: z.string().default(""),
});
export const FontKeysQuerySchema = BrowseQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(5000).default(5000),
  cursor: z.coerce.number().int().min(0).default(0),
});

export const BrowseResponseSchema = z.object({
  folders: z.array(z.string()),
  files: z.array(BrowseFileSchema),
  cursor: z.null(),
  done: z.literal(true),
});
export type BrowseResponse = z.infer<typeof BrowseResponseSchema>;

export const IndexFontsRequestSchema = z.object({
  prefix: z.string().optional(),
  keys: z.array(z.string()).max(5000).optional(),
  batch_size: z.number().int().min(1).max(100).default(20),
}).refine((value) => value.prefix !== undefined || value.keys !== undefined, {
  message: "prefix or keys is required",
});
export type IndexFontsRequest = z.infer<typeof IndexFontsRequestSchema>;

export const IndexFontsResponseSchema = z.object({
  indexed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  errors: z.array(z.string()),
  done: z.literal(true),
});
export type IndexFontsResponse = z.infer<typeof IndexFontsResponseSchema>;

export const FontKeySchema = z.object({ key: z.string(), size: z.number().int().nonnegative() });
export const FontKeysResponseSchema = z.object({ keys: z.array(FontKeySchema), done: z.literal(true) });
export type FontKeysResponse = z.infer<typeof FontKeysResponseSchema>;

export const FolderIndexStatusSchema = z.enum(["synced", "pending", "empty", "stale"]);
export type FolderIndexStatus = z.infer<typeof FolderIndexStatusSchema>;

export const FontFolderStatsSchema = z.object({
  prefix: z.string(),
  /** @deprecated Use `indexed` — kept for older clients */
  count: z.number().int().nonnegative(),
  indexed: z.number().int().nonnegative(),
  onDisk: z.number().int().nonnegative(),
  status: FolderIndexStatusSchema,
});
export type FontFolderStats = z.infer<typeof FontFolderStatsSchema>;

export const SchedulerStatusSchema = z.object({
  enabled: z.boolean(),
  intervalHours: z.number().int().positive(),
  running: z.boolean(),
  lastRunAt: z.string().nullable(),
  nextRunAt: z.string().nullable(),
  lastResult: z.object({
    indexed: z.number().int().nonnegative(),
    purged: z.number().int().nonnegative(),
    deduplicated: z.number().int().nonnegative(),
    error: z.string().nullable(),
  }).nullable(),
});
export type SchedulerStatus = z.infer<typeof SchedulerStatusSchema>;

export const FontStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  onDisk: z.number().int().nonnegative(),
  unindexed: z.number().int().nonnegative(),
  folders: z.array(FontFolderStatsSchema),
  scheduler: SchedulerStatusSchema.optional(),
});
export type FontStats = z.infer<typeof FontStatsSchema>;

export const ScanFontsResponseSchema = z.object({
  total: z.number().int().nonnegative(),
  indexed: z.number().int().nonnegative(),
  skipped: z.number().int().nonnegative(),
  purged: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});
export type ScanFontsResponse = z.infer<typeof ScanFontsResponseSchema>;

export const DeleteFontsRequestSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(1000),
});
export type DeleteFontsRequest = z.infer<typeof DeleteFontsRequestSchema>;

export const DeleteFontsResponseSchema = z.object({ deleted: z.number().int().nonnegative() });
export type DeleteFontsResponse = z.infer<typeof DeleteFontsResponseSchema>;

export const DuplicateFontSchema = z.object({
  id: z.string(),
  filename: z.string(),
  r2_key: z.string(),
  size: z.number().int().nonnegative(),
  sha256: z.string(),
});
export const DuplicateGroupSchema = z.object({
  sha256: z.string(),
  files: z.array(DuplicateFontSchema),
  wastedBytes: z.number().int().nonnegative(),
});
export type DuplicateGroup = z.infer<typeof DuplicateGroupSchema>;
export const DuplicateGroupsResponseSchema = z.object({
  groups: z.array(DuplicateGroupSchema),
  total: z.number().int().nonnegative(),
});
export const DedupResponseSchema = z.object({
  groups: z.number().int().nonnegative(),
  removed: z.number().int().nonnegative(),
  freedBytes: z.number().int().nonnegative(),
});
export type DedupResponse = z.infer<typeof DedupResponseSchema>;

// Subtitle processing uses a binary body. These schemas define the canonical
// header options and the JSON batch envelope.
export const SubsetOptionsSchema = z.object({
  fontsCheck: z.boolean().default(false),
  clearFonts: z.boolean().default(false),
  fontNameMode: z.enum(["preserve", "alias"]).default("alias"),
  fontAliasSalt: z.string().trim().max(80).default(""),
  srtFormat: z.string().default(""),
  srtStyle: z.string().default(""),
});
export type SubsetOptions = z.infer<typeof SubsetOptionsSchema>;

export const SubsetResultSchema = z.object({
  code: CodeSchema,
  messages: z.array(z.string()),
  data: z.custom<Uint8Array>((value) => value instanceof Uint8Array).nullable(),
});
export type SubsetResult = z.infer<typeof SubsetResultSchema>;

export const SubsetBatchItemSchema = z.object({
  filename: z.string(),
  code: CodeSchema,
  messages: z.array(z.string()),
  data: z.string().nullable(),
});
export const SubsetBatchResponseSchema = z.object({ results: z.array(SubsetBatchItemSchema) });
export type SubsetBatchResponse = z.infer<typeof SubsetBatchResponseSchema>;

// Archive library wire contracts. Arrays and booleans stay typed on the wire;
// JSON-in-string and integer booleans are persistence concerns only.
export const ArchiveStatusSchema = z.enum(["pending", "published", "rejected", "expired"]);
export type ArchiveStatus = z.infer<typeof ArchiveStatusSchema>;

export const SharedArchiveSchema = z.object({
  id: z.string(),
  name_cn: z.string(),
  letter: z.string(),
  season: z.string(),
  sub_group: z.string(),
  languages: z.array(z.string()),
  subtitle_formats: z.array(z.string()),
  episode_count: z.number().int().nonnegative(),
  has_fonts: z.boolean(),
  filename: z.string(),
  r2_key: z.string().nullable(),
  file_size: z.number().int().nonnegative(),
  file_count: z.number().int().nonnegative(),
  download_url: z.string().nullable(),
  status: ArchiveStatusSchema,
  contributor: z.string().nullable(),
  sub_entries: z.array(z.string()),
  created_at: z.string(),
  updated_at: z.string(),
});
export type SharedArchive = z.infer<typeof SharedArchiveSchema>;

export const ArchiveMetadataSchema = z.object({
  name_cn: z.string().trim().min(1).max(200),
  letter: z.string().trim().min(1).max(8),
  season: z.string().trim().min(1).max(100),
  sub_group: z.string().trim().min(1).max(200),
  languages: z.array(z.string().trim().min(1).max(50)).max(20).default([]),
  has_fonts: z.boolean().default(false),
  contributor: z.string().trim().max(100).optional(),
});
export type ArchiveMetadata = z.infer<typeof ArchiveMetadataSchema>;

export const ArchivePatchSchema = ArchiveMetadataSchema.omit({ contributor: true }).partial().extend({
  episode_count: z.number().int().nonnegative().optional(),
});
export type ArchivePatch = z.infer<typeof ArchivePatchSchema>;
export const IdParamSchema = z.object({ id: z.string().min(1).max(200) });

export const ArchiveMutationResponseSchema = z.object({
  id: z.string(),
  status: ArchiveStatusSchema,
  filename: z.string().optional(),
  download_url: z.string().nullable().optional(),
  message: z.string().optional(),
});
export type ArchiveMutationResponse = z.infer<typeof ArchiveMutationResponseSchema>;

export const ArchivePreviewSchema = z.object({
  filename: z.string(),
  totalFiles: z.number().int().nonnegative(),
  subtitleFiles: z.number().int().nonnegative(),
  files: z.array(z.object({ name: z.string(), ext: z.string(), isSubtitle: z.boolean() })),
});
export type ArchivePreview = z.infer<typeof ArchivePreviewSchema>;

export const ArchiveManifestSchema = z.object({
  version: z.literal(1),
  generated_at: z.string(),
  archives: z.array(SharedArchiveSchema.omit({ download_url: true, status: true }).extend({
    status: z.literal("published"),
  })),
});
export type ArchiveManifest = z.infer<typeof ArchiveManifestSchema>;
export const ARCHIVE_MANIFEST_KEY = "_catalog/archive-manifest-v1.json";

// Activity log contracts.
export const ProcessingLogSchema = z.object({
  id: z.string(),
  filename: z.string(),
  code: z.number().int(),
  messages: z.array(z.string()),
  missing_fonts: z.array(z.string()),
  font_count: z.number().int().nonnegative(),
  file_size: z.number().int().nonnegative(),
  elapsed_ms: z.number().int().nonnegative(),
  processed_at: z.string(),
});
export type ProcessingLog = z.infer<typeof ProcessingLogSchema>;

export const ProcessingLogQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(200).default(""),
  code: z.coerce.number().int().optional(),
});
export const ProcessingLogListSchema = PaginationQuerySchema.extend({
  total: z.number().int().nonnegative(),
  data: z.array(ProcessingLogSchema),
});
export type ProcessingLogList = z.infer<typeof ProcessingLogListSchema>;

export const MissingFontRankingSchema = z.object({
  font_name: z.string(),
  count: z.number().int().nonnegative(),
  resolved: z.boolean(),
  resolved_at: z.string().nullable(),
});
export type MissingFontRanking = z.infer<typeof MissingFontRankingSchema>;
export const MissingFontListSchema = z.object({
  total: z.number().int().nonnegative(),
  data: z.array(MissingFontRankingSchema),
});
export const MissingFontMutationSchema = z.object({ font_name: z.string().trim().min(1).max(200) });

export const LogStatsSchema = z.object({
  total: z.number().int().nonnegative(),
  today: z.number().int().nonnegative(),
  success: z.number().int().nonnegative(),
  warnings: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  totalMissingFonts: z.number().int().nonnegative(),
});
export type LogStats = z.infer<typeof LogStatsSchema>;

// Font submission result contracts shared by public and authenticated uploads.
export const ApiUploadStatusSchema = z.enum(["success", "duplicate", "rejected", "error"]);
export type ApiUploadStatus = z.infer<typeof ApiUploadStatusSchema>;

export const PublicFontUploadPolicySchema = z.object({
  max_files: z.number().int().positive(),
  max_file_bytes: z.number().int().positive(),
  max_batch_bytes: z.number().int().positive(),
  requests_per_minute: z.number().int().positive(),
});
export type PublicFontUploadPolicy = z.infer<typeof PublicFontUploadPolicySchema>;

export const ApiUploadResultSchema = z.object({
  filename: z.string(),
  status: ApiUploadStatusSchema,
  font_id: z.string().nullable(),
  faces: z.number().int().nonnegative(),
  size: z.number().int().nonnegative(),
  sha256: z.string().nullable(),
  error: z.string().nullable(),
});
export type ApiUploadResult = z.infer<typeof ApiUploadResultSchema>;
export const ApiUploadResponseSchema = z.object({
  summary: z.object({ accepted: z.number().int(), duplicate: z.number().int(), rejected: z.number().int(), error: z.number().int() }),
  results: z.array(ApiUploadResultSchema),
});
export type ApiUploadResponse = z.infer<typeof ApiUploadResponseSchema>;

// AniBT OIDC member workspace contracts.
export const FONTINASS_ENTITLEMENT_VERSION = 1 as const;

export const FontInAssAccountStatusSchema = z.enum([
  "active",
  "disabled",
  "banned",
  "deleted",
]);
export type FontInAssAccountStatus = z.infer<
  typeof FontInAssAccountStatusSchema
>;

export const FontInAssOrganizationRoleSchema = z.enum([
  "owner",
  "admin",
  "member",
]);
export type FontInAssOrganizationRole = z.infer<
  typeof FontInAssOrganizationRoleSchema
>;

export const FontInAssOrganizationEntitlementSchema = z.object({
  organizationId: z.string().min(1).max(128),
  slug: z.string().min(1).max(80),
  name: z.string().min(1).max(80),
  role: FontInAssOrganizationRoleSchema,
});
export type FontInAssOrganizationEntitlement = z.infer<
  typeof FontInAssOrganizationEntitlementSchema
>;

export const FontInAssEntitlementResponseSchema = z.object({
  version: z.literal(FONTINASS_ENTITLEMENT_VERSION),
  accountStatus: FontInAssAccountStatusSchema,
  organizations: z.array(FontInAssOrganizationEntitlementSchema).max(200),
  canManage: z.boolean(),
  checkedAt: z.number().int().nonnegative(),
});
export type FontInAssEntitlementResponse = z.infer<
  typeof FontInAssEntitlementResponseSchema
>;

export const WorkspaceCapabilitySchema = z.enum([
  "fonts.read",
  "fonts.write",
  "fonts.delete",
  "subtitles.read",
  "subtitles.write",
  "archives.manage",
  "credentials.manage",
  "credentials.admin",
  "system.manage",
]);
export type WorkspaceCapability = z.infer<typeof WorkspaceCapabilitySchema>;

export const ProgrammaticCredentialScopeSchema = z.enum([
  "fonts.read",
  "fonts.write",
  "subtitles.read",
  "subtitles.write",
]);
export type ProgrammaticCredentialScope = z.infer<
  typeof ProgrammaticCredentialScopeSchema
>;

export const OidcWorkspaceIdentitySchema = z.object({
  issuer: z.string().url(),
  subject: z.string().min(1).max(255),
  userId: z.string().min(1).max(128),
  displayName: z.string().min(1).max(200),
  picture: z.string().url().nullable(),
});
export type OidcWorkspaceIdentity = z.infer<
  typeof OidcWorkspaceIdentitySchema
>;

export const WorkspaceSessionSchema = z.object({
  authenticated: z.literal(true),
  displayName: z.string(),
  picture: z.string().nullable(),
  organizations: z.array(FontInAssOrganizationEntitlementSchema),
  canManage: z.boolean(),
  csrfToken: z.string().min(32),
  authenticatedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export type WorkspaceSession = z.infer<typeof WorkspaceSessionSchema>;

export const AnonymousWorkspaceSessionSchema = z.object({
  authenticated: z.literal(false),
});
export const WorkspaceSessionResponseSchema = z.discriminatedUnion(
  "authenticated",
  [AnonymousWorkspaceSessionSchema, WorkspaceSessionSchema],
);
export type WorkspaceSessionResponse = z.infer<
  typeof WorkspaceSessionResponseSchema
>;

export const WorkspacePrincipalSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    actorId: z.string(),
    userId: z.string(),
    displayName: z.string(),
    picture: z.string().nullable(),
    organizations: z.array(FontInAssOrganizationEntitlementSchema),
    canManage: z.boolean(),
    authenticatedAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    csrfToken: z.string(),
  }),
  z.object({
    kind: z.literal("credential"),
    actorId: z.string(),
    ownerUserId: z.string(),
    organizationId: z.string(),
    organizationName: z.string(),
    scopes: z.array(ProgrammaticCredentialScopeSchema),
  }),
  z.object({
    kind: z.literal("operator"),
    actorId: z.string(),
  }),
]);
export type WorkspacePrincipal = z.infer<typeof WorkspacePrincipalSchema>;

export const ProgrammaticCredentialSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  organizationName: z.string(),
  name: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  scopes: z.array(ProgrammaticCredentialScopeSchema),
  generation: z.number().int().positive(),
  createdAt: z.string().datetime(),
  authorizedAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  expiresAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export type ProgrammaticCredential = z.infer<
  typeof ProgrammaticCredentialSchema
>;

export const CreateProgrammaticCredentialSchema = z.object({
  organizationId: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(100),
  scopes: z
    .array(ProgrammaticCredentialScopeSchema)
    .min(1)
    .max(4)
    .transform((scopes) => [...new Set(scopes)]),
  expiresAt: z.string().datetime().nullable().optional(),
  confirmation: z.string().trim().min(1).max(100),
});
export type CreateProgrammaticCredential = z.infer<
  typeof CreateProgrammaticCredentialSchema
>;

export const ProgrammaticCredentialCreatedSchema = z.object({
  credential: ProgrammaticCredentialSchema,
  plaintext: z.string().min(40),
});
export type ProgrammaticCredentialCreated = z.infer<
  typeof ProgrammaticCredentialCreatedSchema
>;

export const WorkspaceArchiveMetadataSchema = ArchiveMetadataSchema.omit({
  sub_group: true,
});
export type WorkspaceArchiveMetadata = z.infer<
  typeof WorkspaceArchiveMetadataSchema
>;

export const WorkspaceArchiveSchema = SharedArchiveSchema.extend({
  organizationId: z.string(),
  organizationName: z.string(),
  uploaderFingerprint: z.string(),
  actorKind: z.enum(["session", "credential", "operator", "legacy"]),
});
export type WorkspaceArchive = z.infer<typeof WorkspaceArchiveSchema>;

export const AccessReceiptSchema = z.object({
  id: z.string(),
  actorKind: z.enum(["session", "credential", "operator", "legacy"]),
  actorFingerprint: z.string(),
  organizationId: z.string().nullable(),
  capability: WorkspaceCapabilitySchema,
  resourceType: z.enum(["font", "archive", "credential", "session", "system"]),
  resourceFingerprint: z.string().nullable(),
  outcome: z.enum(["allowed", "denied", "completed", "revoked"]),
  createdAt: z.string().datetime(),
});
export type AccessReceipt = z.infer<typeof AccessReceiptSchema>;
