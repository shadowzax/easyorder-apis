
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "delivery.sqlite");

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({
                changes: this.changes,
                lastID: this.lastID
            });
        });
    });
}

function dbAll(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

async function ensureColumn(table, column, definition) {
    const columns = await dbAll(`PRAGMA table_info(${table})`);
    const exists = columns.some(item => item.name === column);

    if (!exists) {
        await dbRun(
            `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`
        );
    }
}

async function ensureColumns(table, columns) {
    for (const [column, definition] of columns) {
        await ensureColumn(table, column, definition);
    }
}

async function initializeDatabase() {
    await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_accounts (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            phone_number TEXT UNIQUE,
            profile_picture TEXT DEFAULT 'https://i.ibb.co/HRbkkLw/3177440-1.jpg',
            password TEXT NOT NULL,
            account_type TEXT DEFAULT 'delivery',
            account_status TEXT DEFAULT 'active',
            language TEXT DEFAULT 'ar',

            balance REAL DEFAULT 0,
            points INTEGER DEFAULT 0,
            is_active INTEGER DEFAULT 0,

            orders_count INTEGER DEFAULT 0,
            completed_orders INTEGER DEFAULT 0,
            cancelled_orders INTEGER DEFAULT 0,

            total_earnings REAL DEFAULT 0,
            total_earned_lifetime REAL DEFAULT 0,
            total_withdrawn REAL DEFAULT 0,
            pending_withdrawals REAL DEFAULT 0,

            total_order_value REAL DEFAULT 0,
            total_items_subtotal REAL DEFAULT 0,
            total_discounts REAL DEFAULT 0,
            total_vat REAL DEFAULT 0,
            total_processing_fees REAL DEFAULT 0,

            total_delivery_fees REAL DEFAULT 0,
            total_commission REAL DEFAULT 0,
            total_app_commission REAL DEFAULT 0,
            total_restaurant_commission REAL DEFAULT 0,

            total_restaurant_net REAL DEFAULT 0,
            total_app_net REAL DEFAULT 0,
            total_delivery_net_earnings REAL DEFAULT 0,

            total_amount_due_to_restaurant REAL DEFAULT 0,
            total_amount_due_to_app REAL DEFAULT 0,

            total_tips REAL DEFAULT 0,

            total_cash_collected REAL DEFAULT 0,
            total_cash_to_restaurant REAL DEFAULT 0,
            total_cash_to_app REAL DEFAULT 0,
            total_cash_to_delivery REAL DEFAULT 0,

            total_card_collected REAL DEFAULT 0,
            total_wallet_collected REAL DEFAULT 0,

            current_order_id TEXT,
            orders_history TEXT DEFAULT '[]',

            last_login TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `);

    await ensureColumns("delivery_accounts", [
        ["total_earned_lifetime", "REAL DEFAULT 0"],
        ["total_withdrawn", "REAL DEFAULT 0"],
        ["pending_withdrawals", "REAL DEFAULT 0"],

        ["total_order_value", "REAL DEFAULT 0"],
        ["total_items_subtotal", "REAL DEFAULT 0"],
        ["total_discounts", "REAL DEFAULT 0"],
        ["total_vat", "REAL DEFAULT 0"],
        ["total_processing_fees", "REAL DEFAULT 0"],

        ["total_app_commission", "REAL DEFAULT 0"],
        ["total_restaurant_commission", "REAL DEFAULT 0"],

        ["total_restaurant_net", "REAL DEFAULT 0"],
        ["total_app_net", "REAL DEFAULT 0"],
        ["total_delivery_net_earnings", "REAL DEFAULT 0"],

        ["total_amount_due_to_restaurant", "REAL DEFAULT 0"],
        ["total_amount_due_to_app", "REAL DEFAULT 0"],

        ["total_tips", "REAL DEFAULT 0"],

        ["total_cash_collected", "REAL DEFAULT 0"],
        ["total_cash_to_restaurant", "REAL DEFAULT 0"],
        ["total_cash_to_app", "REAL DEFAULT 0"],
        ["total_cash_to_delivery", "REAL DEFAULT 0"],

        ["total_card_collected", "REAL DEFAULT 0"],
        ["total_wallet_collected", "REAL DEFAULT 0"]
    ]);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_transactions (
            id TEXT PRIMARY KEY,
            delivery_id TEXT NOT NULL,
            order_id TEXT,
            withdrawal_id TEXT,

            transaction_type TEXT NOT NULL,
            category TEXT NOT NULL,

            amount REAL NOT NULL DEFAULT 0,
            currency TEXT NOT NULL DEFAULT 'EGP',

            direction TEXT NOT NULL
                CHECK(direction IN ('credit', 'debit')),

            status TEXT NOT NULL DEFAULT 'completed'
                CHECK(status IN (
                    'pending',
                    'completed',
                    'failed',
                    'cancelled',
                    'reversed'
                )),

            is_withdrawn INTEGER NOT NULL DEFAULT 0
                CHECK(is_withdrawn IN (0, 1)),

            description TEXT,
            reference TEXT,

            balance_before REAL,
            balance_after REAL,

            metadata TEXT DEFAULT '{}',

            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,

            FOREIGN KEY(delivery_id)
                REFERENCES delivery_accounts(id),

            UNIQUE(delivery_id, order_id, transaction_type)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_withdrawals (
            id TEXT PRIMARY KEY,
            delivery_id TEXT NOT NULL,

            amount REAL NOT NULL CHECK(amount > 0),
            currency TEXT NOT NULL DEFAULT 'EGP',

            status TEXT NOT NULL DEFAULT 'pending'
                CHECK(status IN (
                    'pending',
                    'approved',
                    'processing',
                    'completed',
                    'rejected',
                    'cancelled'
                )),

            payment_method TEXT,
            payment_details TEXT DEFAULT '{}',

            transaction_reference TEXT,

            admin_id TEXT,
            admin_note TEXT,
            rejection_reason TEXT,

            requested_at TEXT NOT NULL,
            reviewed_at TEXT,
            completed_at TEXT,
            updated_at TEXT NOT NULL,

            FOREIGN KEY(delivery_id)
                REFERENCES delivery_accounts(id)
        )
    `);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_settlements (
            id TEXT PRIMARY KEY,

            delivery_id TEXT NOT NULL,
            order_id TEXT NOT NULL,

            currency TEXT NOT NULL DEFAULT 'EGP',

            order_total REAL NOT NULL DEFAULT 0,
            items_subtotal REAL NOT NULL DEFAULT 0,

            discount_amount REAL NOT NULL DEFAULT 0,
            vat_amount REAL NOT NULL DEFAULT 0,
            processing_fee REAL NOT NULL DEFAULT 0,

            restaurant_gross REAL NOT NULL DEFAULT 0,
            restaurant_commission REAL NOT NULL DEFAULT 0,
            restaurant_net REAL NOT NULL DEFAULT 0,

            app_commission REAL NOT NULL DEFAULT 0,
            app_net REAL NOT NULL DEFAULT 0,

            delivery_fee REAL NOT NULL DEFAULT 0,
            delivery_commission REAL NOT NULL DEFAULT 0,
            delivery_net_earnings REAL NOT NULL DEFAULT 0,

            tip_amount REAL NOT NULL DEFAULT 0,

            amount_due_to_restaurant REAL NOT NULL DEFAULT 0,
            amount_due_to_app REAL NOT NULL DEFAULT 0,
            amount_due_to_delivery REAL NOT NULL DEFAULT 0,

            cash_collected REAL NOT NULL DEFAULT 0,
            cash_to_restaurant REAL NOT NULL DEFAULT 0,
            cash_to_app REAL NOT NULL DEFAULT 0,
            cash_to_delivery REAL NOT NULL DEFAULT 0,

            card_collected REAL NOT NULL DEFAULT 0,
            wallet_collected REAL NOT NULL DEFAULT 0,

            total_collected REAL NOT NULL DEFAULT 0,
            reconciliation_difference REAL NOT NULL DEFAULT 0,

            payment_method TEXT,
            payment_status TEXT DEFAULT 'pending',

            settlement_status TEXT NOT NULL DEFAULT 'pending'
                CHECK(settlement_status IN (
                    'pending',
                    'completed',
                    'disputed',
                    'cancelled'
                )),

            notes TEXT,
            metadata TEXT DEFAULT '{}',

            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            completed_at TEXT,

            FOREIGN KEY(delivery_id)
                REFERENCES delivery_accounts(id),

            UNIQUE(delivery_id, order_id)
        )
    `);

    await ensureColumns("delivery_settlements", [
        ["items_subtotal", "REAL NOT NULL DEFAULT 0"],
        ["discount_amount", "REAL NOT NULL DEFAULT 0"],
        ["vat_amount", "REAL NOT NULL DEFAULT 0"],
        ["processing_fee", "REAL NOT NULL DEFAULT 0"],

        ["restaurant_gross", "REAL NOT NULL DEFAULT 0"],
        ["restaurant_commission", "REAL NOT NULL DEFAULT 0"],
        ["restaurant_net", "REAL NOT NULL DEFAULT 0"],

        ["app_commission", "REAL NOT NULL DEFAULT 0"],
        ["app_net", "REAL NOT NULL DEFAULT 0"],

        ["delivery_net_earnings", "REAL NOT NULL DEFAULT 0"],

        ["amount_due_to_restaurant", "REAL NOT NULL DEFAULT 0"],
        ["amount_due_to_app", "REAL NOT NULL DEFAULT 0"],
        ["amount_due_to_delivery", "REAL NOT NULL DEFAULT 0"],

        ["card_collected", "REAL NOT NULL DEFAULT 0"],
        ["wallet_collected", "REAL NOT NULL DEFAULT 0"],
        ["total_collected", "REAL NOT NULL DEFAULT 0"],

        ["payment_method", "TEXT"],
        ["payment_status", "TEXT DEFAULT 'pending'"]
    ]);

    await dbRun(`
        CREATE TABLE IF NOT EXISTS delivery_withdrawal_transactions (
            id TEXT PRIMARY KEY,
            withdrawal_id TEXT NOT NULL,
            transaction_id TEXT NOT NULL,
            created_at TEXT NOT NULL,

            FOREIGN KEY(withdrawal_id)
                REFERENCES delivery_withdrawals(id),

            FOREIGN KEY(transaction_id)
                REFERENCES delivery_transactions(id),

            UNIQUE(withdrawal_id, transaction_id)
        )
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_transactions_delivery
        ON delivery_transactions(delivery_id, created_at)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_transactions_order
        ON delivery_transactions(order_id)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_transactions_status
        ON delivery_transactions(status, is_withdrawn)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_withdrawals_delivery
        ON delivery_withdrawals(delivery_id, requested_at)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_withdrawals_status
        ON delivery_withdrawals(status)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_settlements_delivery
        ON delivery_settlements(delivery_id, created_at)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_settlements_status
        ON delivery_settlements(settlement_status)
    `);

    await dbRun(`
        CREATE INDEX IF NOT EXISTS idx_delivery_settlements_order
        ON delivery_settlements(order_id)
    `);

    console.log("Delivery database ready.");
}

initializeDatabase().catch(error => {
    console.error("Delivery database initialization error:", error.message);
});

module.exports = { db };
