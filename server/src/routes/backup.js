// Download and restore the one SQLite file that is the Suite's actual
// source of truth (see the README's "Data and backups" section) — every
// credential, instance definition and component setting, in one place.
//
// Deliberately scoped to just suite.db, not the per-component data
// directories under SUITE_DATA_DIR: those are runtime state the README
// already calls reconstructible, and reaching into a PostgreSQL data
// directory or an instance's cache is a different, much larger problem this
// doesn't attempt to solve.

import { Router } from "express";
import express from "express";
import { randomUUID } from "node:crypto";
import { copyFileSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDatabase, getDatabasePath, closeDatabase, openDatabase } from "../store/db.js";
import { SuiteError, sendError } from "../errors.js";

// The first 16 bytes of every SQLite file, always — cheap, reliable proof an
// upload is at least the right *kind* of file before anything touches disk.
const SQLITE_HEADER = "SQLite format 3\0";

function backupFilename() {
  return `suite-backup-${new Date().toISOString().replace(/[:.]/g, "-")}.db`;
}

export function createBackupRouter() {
  const router = Router();

  // VACUUM INTO gives a consistent point-in-time snapshot even if something
  // is mid-write, unlike copying the live file — the same reason a real
  // database's own backup tooling never just cp's the file. The target path
  // is entirely our own (a fresh temp directory, not derived from anything
  // in the request), so building the SQL string directly is safe here.
  router.get("/", (req, res) => {
    const tmpDir = mkdtempSync(path.join(os.tmpdir(), "suite-backup-"));
    const tmpFile = path.join(tmpDir, "suite-backup.db");

    try {
      getDatabase().exec(`VACUUM INTO '${tmpFile.replace(/'/g, "''")}'`);
    } catch (err) {
      rmSync(tmpDir, { recursive: true, force: true });
      return sendError(res, 500, new SuiteError("backup_failed", `Backup failed: ${err.message}`, { detail: err.message }));
    }

    res.download(tmpFile, backupFilename(), (err) => {
      rmSync(tmpDir, { recursive: true, force: true });
      if (err && !res.headersSent) {
        sendError(res, 500, new SuiteError("backup_download_failed", "Backup download failed"));
      }
    });
  });

  // Fully synchronous, so no second request can interleave with a restore.
  router.post("/restore", express.raw({ type: "application/octet-stream", limit: "50mb" }), (req, res) => {
    const upload = req.body;
    if (!Buffer.isBuffer(upload) || upload.length < SQLITE_HEADER.length) {
      return sendError(res, 400, new SuiteError("no_file_uploaded", "No file uploaded."));
    }
    if (upload.toString("latin1", 0, SQLITE_HEADER.length) !== SQLITE_HEADER) {
      return sendError(res, 400, new SuiteError("not_sqlite", "That doesn't look like a SQLite database file."));
    }

    const dbPath = getDatabasePath();
    const dataDir = path.dirname(dbPath);
    const safetyCopy = `${dbPath}.bak-${Date.now()}`;
    const stagingPath = `${dbPath}.restoring-${randomUUID()}`;
    let backedUp = false;

    try {
      // Written before the live store is closed: if this fails (disk full), the
      // running database was never touched.
      writeFileSync(stagingPath, upload);
      closeDatabase();
      copyFileSync(dbPath, safetyCopy);
      backedUp = true;
      // A rename, not a direct write to dbPath — the file is either wholly the
      // upload or wholly the previous database, never a torn mix of both.
      renameSync(stagingPath, dbPath);
      openDatabase(dataDir);
      // The copy holds every secret in the clear; once the new store opened it
      // has done its job.
      rmSync(safetyCopy, { force: true });
      res.json({ ok: true });
    } catch (err) {
      // Not a compatible/valid Suite database, or a step failed: put back what
      // was running before rather than leave the Suite without a store.
      rmSync(stagingPath, { force: true });
      if (backedUp) renameSync(safetyCopy, dbPath);
      else rmSync(safetyCopy, { force: true });
      openDatabase(dataDir);
      sendError(res, 400, new SuiteError("restore_failed", `Restore failed: ${err.message}`, { detail: err.message }));
    }
  });

  return router;
}
