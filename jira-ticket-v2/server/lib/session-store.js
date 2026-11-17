// server/lib/session-store.js
//
// Sessions live in memory for fast, synchronous lookups (middleware cannot
// await), but every write is mirrored to MySQL and reloaded on boot. That way
// a restart or deploy no longer logs every user out, which was the behaviour
// when this was a bare `new Map()`.
//
// Only the SHA-256 of a token is ever stored, in memory and in the database,
// so a database dump does not hand out usable session cookies.
const crypto = require('crypto');
const db = require('../config/database');

const TABLE = 'session';

function hashToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Map-shaped session store backed by MySQL.
 *
 * Reads are synchronous (served from an in-memory copy keyed by token hash);
 * writes also touch the database. Persistence failures are logged and ignored,
 * degrading to the previous in-memory behaviour rather than breaking logins.
 */
class PersistentSessionStore {
    constructor(kind) {
        this.kind = kind;
        this.cache = new Map(); // tokenHash -> session
    }

    has(token) {
        return this.cache.has(hashToken(token));
    }

    get(token) {
        return this.cache.get(hashToken(token));
    }

    set(token, session) {
        const tokenHash = hashToken(token);
        this.cache.set(tokenHash, session);
        this.persist(tokenHash, session);
        return this;
    }

    delete(token) {
        const tokenHash = hashToken(token);
        const existed = this.cache.delete(tokenHash);
        if (existed) {
            db.execute(`DELETE FROM ${TABLE} WHERE token_hash = ?`, [tokenHash])
                .catch((error) => console.error('[session] delete failed:', error.message));
        }
        return existed;
    }

    /** Map-like iteration; the callback receives (session, tokenHash). */
    forEach(callback) {
        this.cache.forEach(callback);
    }

    /** Delete every session for a user, optionally sparing one token hash. */
    deleteByUserId(userId, exceptTokenHash) {
        const removed = [];
        this.cache.forEach((session, tokenHash) => {
            if (session?.user?.id === userId && tokenHash !== exceptTokenHash) {
                removed.push(tokenHash);
            }
        });
        for (const tokenHash of removed) {
            this.deleteHash(tokenHash);
        }
        return removed.length;
    }

    deleteHash(tokenHash) {
        this.cache.delete(tokenHash);
        db.execute(`DELETE FROM ${TABLE} WHERE token_hash = ?`, [tokenHash])
            .catch((error) => console.error('[session] delete failed:', error.message));
    }

    persist(tokenHash, session) {
        const userId = session && session.user && Number.isInteger(session.user.id)
            ? session.user.id
            : null;
        const payload = JSON.stringify(session && session.user ? session.user : null);
        const createdAt = Number(session && session.createdAt) || Date.now();

        db.execute(
            `INSERT INTO ${TABLE} (token_hash, kind, user_id, user_json, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE user_json = VALUES(user_json), created_at = VALUES(created_at)`,
            [tokenHash, this.kind, userId, payload, createdAt]
        ).catch((error) => console.error('[session] persist failed:', error.message));
    }

    async pruneExpired(maxAgeMs) {
        try {
            await db.execute(
                `DELETE FROM ${TABLE} WHERE kind = ? AND created_at < ?`,
                [this.kind, Date.now() - maxAgeMs]
            );
        } catch (error) {
            console.error('[session] prune failed:', error.message);
        }
    }

    /**
     * Reload persisted sessions into memory. Called once at startup so tokens
     * issued before a restart keep working.
     */
    async load(maxAgeMs) {
        try {
            const rows = await db.query(
                `SELECT token_hash, user_json, created_at FROM ${TABLE}
                 WHERE kind = ? AND created_at >= ?`,
                [this.kind, Date.now() - maxAgeMs]
            );

            for (const row of rows) {
                if (!row.user_json) continue;
                // mysql2 returns a MySQL JSON column already parsed, so only
                // parse when we actually got a string. Parsing unconditionally
                // threw for every row and silently dropped all sessions.
                let user = row.user_json;
                if (typeof user === 'string') {
                    try {
                        user = JSON.parse(user);
                    } catch {
                        continue;
                    }
                }
                if (!user || typeof user !== 'object') continue;

                this.cache.set(row.token_hash, {
                    user,
                    createdAt: Number(row.created_at)
                });
            }

            if (rows.length) {
                console.log(`[session] restored ${rows.length} ${this.kind} session(s)`);
            }
            await this.pruneExpired(maxAgeMs);
            return rows.length;
        } catch (error) {
            console.error('[session] load failed:', error.message);
            return 0;
        }
    }
}

async function ensureSessionTable() {
    await db.execute(`
        CREATE TABLE IF NOT EXISTS ${TABLE} (
            token_hash CHAR(64) NOT NULL,
            kind VARCHAR(16) NOT NULL,
            user_id INT NULL,
            user_json JSON NOT NULL,
            created_at BIGINT NOT NULL,
            PRIMARY KEY (token_hash),
            KEY idx_session_kind (kind),
            KEY idx_session_created (created_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
          COMMENT='Login sessions (survive restart)'
    `);
}

module.exports = { PersistentSessionStore, ensureSessionTable, hashToken };
