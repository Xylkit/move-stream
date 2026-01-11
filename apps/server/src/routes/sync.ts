import express from "express";
import { getSyncStatus, syncAll, syncDeployment } from "../indexer/sync.js";
import { calcAccountId } from "../utils/account.js";

const router = express.Router();

/**
 * POST /sync
 * Trigger indexing (with 30s cooldown unless force=true)
 *
 * Body:
 *   deployment?: string  - Specific deployment
 *   user?: string        - Priority sync for user's account
 *   all?: boolean        - Sync all deployments
 *   force?: boolean      - Skip cooldown
 */
router.post("/", async (req, res, next) => {
  try {
    const { deployment, user, all, force } = req.body;

    if (all) {
      const results = await syncAll(force);
      const processed = results.reduce((sum, r) => sum + r.eventsProcessed, 0);
      const skipped = results.filter((r) => r.skipped).length;
      return res.json({ success: true, results, totalEvents: processed, skipped });
    }

    // If no deployment specified, get first from DB
    let targetDeployment = deployment;
    if (!targetDeployment) {
      const { getDb } = await import("../database/connection.js");
      const db = getDb();
      const first = await db.selectFrom("deployments").select("address").executeTakeFirst();
      targetDeployment = first?.address;
    }

    if (!targetDeployment) {
      return res.status(400).json({
        success: false,
        error: "No deployment specified and no deployments found in database",
      });
    }

    const accountId = user ? calcAccountId(user).toString() : undefined;
    const result = await syncDeployment({ deployment: targetDeployment, accountId, force });

    res.json({ success: true, ...result });
  } catch (err) {
    next(err);
  }
});

/**
 * GET /sync/status
 * Cheap freshness check for UI
 * Returns: lastSyncedAt, ageMs (how stale the data is)
 */
router.get("/status", async (req, res, next) => {
  try {
    const deployment = req.query.deployment as string | undefined;
    const status = await getSyncStatus(deployment);

    res.json({
      status,
      // Helper for UI: is any deployment stale (>30s)?
      anyStale: status.some((s) => s.ageMs > 30_000),
    });
  } catch (err) {
    next(err);
  }
});

export default router;
