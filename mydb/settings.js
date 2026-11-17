const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataFolder = path.join(__dirname, "..", "data");

if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
}

const dbPath = path.join(dataFolder, "settings.sqlite");

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log("Connected to settings database.");
    }
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS settings (
            id INTEGER PRIMARY KEY,

            allow_login INTEGER DEFAULT 1,
            allow_register INTEGER DEFAULT 1,
            allow_account_creation INTEGER DEFAULT 1,

            maintenance_mode INTEGER DEFAULT 0,

            allow_orders INTEGER DEFAULT 1,
            allow_delivery INTEGER DEFAULT 1,

            allow_payments INTEGER DEFAULT 1,
            allow_cash_payment INTEGER DEFAULT 1,
            allow_online_payment INTEGER DEFAULT 1,

            allow_notifications INTEGER DEFAULT 1,

            allow_reviews INTEGER DEFAULT 1,
            allow_ratings INTEGER DEFAULT 1,

            allow_discount_codes INTEGER DEFAULT 1,
            allow_points INTEGER DEFAULT 1,
            allow_wallet INTEGER DEFAULT 1,

            global_notice_enabled INTEGER DEFAULT 0,
            global_notice TEXT DEFAULT '{"title":"","description":""}',

            app_name TEXT DEFAULT 'Delivery App',
            app_description TEXT DEFAULT '',
            app_logo TEXT DEFAULT '',

            default_language TEXT DEFAULT 'ar',
            currency TEXT DEFAULT 'EGP',

            application_commission REAL DEFAULT 15,
            delivery_commission REAL DEFAULT 10,

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        INSERT OR IGNORE INTO settings (id)
        VALUES (1)
    `);
});

module.exports = { db };