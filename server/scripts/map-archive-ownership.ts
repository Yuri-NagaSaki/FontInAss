import { createHmac } from "node:crypto";
import { resolve } from "node:path";
import { Database } from "bun:sqlite";
import { z } from "zod";

const MappingSchema = z.array(
  z.object({
    legacyGroup: z.string().trim().min(1).max(200),
    organizationId: z.string().trim().min(1).max(128),
    organizationName: z.string().trim().min(1).max(200),
  }),
);

type Mapping = z.infer<typeof MappingSchema>[number];
type LegacyArchive = { id: string; sub_group: string };

const apply = process.argv.includes("--apply");
const mappingArgument = process.argv.find((argument) =>
  argument.startsWith("--mapping="),
);
const mappingPath = mappingArgument?.slice("--mapping=".length).trim() ?? "";
const fingerprintSecret =
  process.env.FONTINASS_SESSION_FINGERPRINT_SECRET?.trim() ?? "";

if (!mappingPath) {
  throw new Error("--mapping=/private/path/to/archive-ownership.json is required");
}
if (fingerprintSecret.length < 32) {
  throw new Error("FONTINASS_SESSION_FINGERPRINT_SECRET must be at least 32 characters");
}

const mappings = MappingSchema.parse(await Bun.file(mappingPath).json());
const database = new Database(
  resolve(process.env.DB_PATH ?? "./data/fontinass-v2.db"),
  { create: false },
);

try {
  const legacy = database
    .query<LegacyArchive, []>(`
      SELECT id, sub_group FROM archives
      WHERE organization_id IS NULL OR organization_id = ''
      ORDER BY id
    `)
    .all();
  const mappingByGroup = new Map<string, Mapping>();
  const ambiguousGroups = new Set<string>();
  for (const mapping of mappings) {
    const key = normalize(mapping.legacyGroup);
    const existing = mappingByGroup.get(key);
    if (
      existing &&
      (existing.organizationId !== mapping.organizationId ||
        existing.organizationName !== mapping.organizationName)
    ) {
      ambiguousGroups.add(key);
      continue;
    }
    mappingByGroup.set(key, mapping);
  }

  let matchedRows = 0;
  let ambiguousRows = 0;
  let unmatchedRows = 0;
  let appliedRows = 0;
  const now = new Date().toISOString();
  const update = database.query(`
    UPDATE archives SET
      organization_id = ?,
      organization_name = ?,
      uploader_fingerprint = ?,
      actor_kind = 'legacy',
      actor_id_fingerprint = ?,
      updated_at = ?
    WHERE id = ? AND (organization_id IS NULL OR organization_id = '')
  `);

  database.transaction(() => {
    for (const archive of legacy) {
      const key = normalize(archive.sub_group);
      if (ambiguousGroups.has(key)) {
        ambiguousRows += 1;
        continue;
      }
      const mapping = mappingByGroup.get(key);
      if (!mapping) {
        unmatchedRows += 1;
        continue;
      }
      matchedRows += 1;
      if (!apply) continue;
      const groupFingerprint = fingerprint(
        fingerprintSecret,
        `historical-archive:${mapping.organizationId}:${key}`,
      );
      appliedRows += Number(
        update.run(
          mapping.organizationId,
          mapping.organizationName,
          groupFingerprint,
          groupFingerprint,
          now,
          archive.id,
        ).changes,
      );
    }
  })();

  const mappingFingerprint = fingerprint(
    fingerprintSecret,
    mappings
      .map(
        (mapping) =>
          `${normalize(mapping.legacyGroup)}:${mapping.organizationId}:${mapping.organizationName}`,
      )
      .sort()
      .join("\n"),
  );
  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      totalLegacyRows: legacy.length,
      mappingEntries: mappings.length,
      matchedRows,
      appliedRows,
      ambiguousRows,
      unmatchedRows,
      mappingFingerprint,
    })}\n`,
  );
} finally {
  database.close();
}

function normalize(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").toLocaleLowerCase("en-US");
}

function fingerprint(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex").slice(0, 16);
}
