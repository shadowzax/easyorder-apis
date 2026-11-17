const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "discount_codes.sqlite");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run("PRAGMA foreign_keys = ON");

    db.run(`
        CREATE TABLE IF NOT EXISTS discount_codes (
            id TEXT PRIMARY KEY,
            code TEXT NOT NULL UNIQUE COLLATE NOCASE,
            name TEXT,
            description TEXT,

            discount_type TEXT NOT NULL DEFAULT 'percentage'
                CHECK (discount_type IN ('percentage', 'fixed', 'free_delivery')),

            discount_value REAL NOT NULL DEFAULT 0
                CHECK (discount_value >= 0),

            max_discount_amount REAL DEFAULT NULL,
            min_order_amount REAL NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'EGP',

            target_type TEXT NOT NULL DEFAULT 'all'
                CHECK (target_type IN ('all', 'specific_user')),

            target_user_id TEXT DEFAULT NULL,

            usage_limit INTEGER DEFAULT NULL,
            usage_per_user INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,

            starts_at TEXT DEFAULT NULL,
            expires_at TEXT DEFAULT NULL,

            is_active INTEGER NOT NULL DEFAULT 1,
            first_order_only INTEGER NOT NULL DEFAULT 0,

            applicable_to TEXT NOT NULL DEFAULT 'all',
            applicable_ids TEXT NOT NULL DEFAULT '[]',

            combinable INTEGER NOT NULL DEFAULT 0,

            created_by TEXT DEFAULT NULL,
            metadata TEXT NOT NULL DEFAULT '{}',

            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,

            CHECK (
                (target_type = 'all' AND target_user_id IS NULL)
                OR
                (target_type = 'specific_user' AND target_user_id IS NOT NULL)
            )
        )
    `, (err) => {
        if (err) {
            console.error("Discount codes database error:", err.message);
            return;
        }

        db.run(`
            CREATE TABLE IF NOT EXISTS discount_code_usages (
                id TEXT PRIMARY KEY,
                discount_code_id TEXT NOT NULL,
                user_id TEXT NOT NULL,
                order_id TEXT NOT NULL UNIQUE,

                discount_amount REAL NOT NULL DEFAULT 0,
                order_amount REAL NOT NULL DEFAULT 0,

                status TEXT NOT NULL DEFAULT 'applied'
                    CHECK (status IN (
                        'reserved',
                        'applied',
                        'cancelled',
                        'refunded'
                    )),

                used_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,

                FOREIGN KEY (discount_code_id)
                    REFERENCES discount_codes(id)
                    ON DELETE RESTRICT,

                UNIQUE (discount_code_id, user_id, order_id)
            )
        `, (err) => {
            if (err) {
                console.error("Discount usages database error:", err.message);
                return;
            }

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_discount_codes_active
                ON discount_codes(is_active, starts_at, expires_at)
            `);

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_discount_codes_target
                ON discount_codes(target_type, target_user_id)
            `);

            db.run(`
                CREATE INDEX IF NOT EXISTS idx_discount_usages_user
                ON discount_code_usages(user_id, discount_code_id)
            `);

            console.log("Discount codes database ready.");
        });
    });
});

module.exports = {
    db
};
