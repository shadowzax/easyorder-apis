
const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "restaurants.sqlite");
const defaultLogo = "https://i.ibb.co/KjtHhwN4/logo-1.png";

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.configure("busyTimeout", 10000);

const definitions = {
    id: "INTEGER PRIMARY KEY",
    owner_name: "TEXT NOT NULL DEFAULT ''",
    restaurant_name_ar: "TEXT NOT NULL DEFAULT ''",
    restaurant_name_en: "TEXT NOT NULL DEFAULT ''",
    restaurant_name_ru: "TEXT NOT NULL DEFAULT ''",
    email: "TEXT UNIQUE",
    phone_number: "TEXT UNIQUE",
    password: "TEXT NOT NULL DEFAULT ''",
    logo: `TEXT DEFAULT '${defaultLogo}'`,
    cover_image: "TEXT",
    description_ar: "TEXT DEFAULT ''",
    description_en: "TEXT DEFAULT ''",
    description_ru: "TEXT DEFAULT ''",
    category_ar: "TEXT DEFAULT ''",
    category_en: "TEXT DEFAULT ''",
    category_ru: "TEXT DEFAULT ''",
    address_ar: "TEXT DEFAULT ''",
    address_en: "TEXT DEFAULT ''",
    address_ru: "TEXT DEFAULT ''",
    latitude: "REAL",
    longitude: "REAL",
    account_type: "TEXT DEFAULT 'restaurant'",
    account_status: "TEXT DEFAULT 'active'",
    language: "TEXT DEFAULT 'ar'",
    balance: "REAL DEFAULT 0",
    points: "INTEGER DEFAULT 0",
    orders_count: "INTEGER DEFAULT 0",
    completed_orders: "INTEGER DEFAULT 0",
    cancelled_orders: "INTEGER DEFAULT 0",
    sales_commission: "REAL DEFAULT 12",
    delivery_commission: "REAL DEFAULT 10",
    phone_verified: "INTEGER DEFAULT 0",
    email_verified: "INTEGER DEFAULT 0",
    rating: "REAL DEFAULT 0",
    ratings_count: "INTEGER DEFAULT 0",
    is_open: "INTEGER DEFAULT 1",
    is_accepting_orders: "INTEGER DEFAULT 1",
    delivery_available: "INTEGER DEFAULT 1",
    closed_reason: "TEXT DEFAULT ''",
    delivery_fee: "REAL DEFAULT 0",
    minimum_order: "REAL DEFAULT 0",
    maximum_order: "REAL DEFAULT 0",
    preparation_time_min: "INTEGER DEFAULT 15",
    preparation_time_max: "INTEGER DEFAULT 30",
    delivery_time_min: "INTEGER DEFAULT 30",
    delivery_time_max: "INTEGER DEFAULT 70",
    is_featured: "INTEGER DEFAULT 0",
    sort_order: "INTEGER DEFAULT 0",
    opening_hours: "TEXT DEFAULT '{}'",
    menu: "TEXT DEFAULT '[]'",
    orders: "TEXT DEFAULT '[]'",
    reviews: "TEXT DEFAULT '[]'",
    customers: "TEXT DEFAULT '[]'",
    delivery_zones: "TEXT DEFAULT '[]'",
    delivery_services: "TEXT DEFAULT '[]'",
    offers: "TEXT DEFAULT '[]'",
    gallery: "TEXT DEFAULT '[]'",
    social_links: "TEXT DEFAULT '{}'",
    tags: "TEXT DEFAULT '[]'",
    notifications: "TEXT DEFAULT '[]'",
    discount_codes: "TEXT DEFAULT '[]'",
    settings: "TEXT DEFAULT '{}'",
    last_login: "TEXT",
    created_at: "TEXT NOT NULL DEFAULT ''",
    updated_at: "TEXT NOT NULL DEFAULT ''"
};

const columns = Object.keys(definitions);

const defaults = {
    owner_name: "''",
    restaurant_name_ar: "''",
    restaurant_name_en: "''",
    restaurant_name_ru: "''",
    password: "''",
    logo: `'${defaultLogo}'`,
    account_type: "'restaurant'",
    account_status: "'active'",
    language: "'ar'",
    balance: "0",
    points: "0",
    orders_count: "0",
    completed_orders: "0",
    cancelled_orders: "0",
    sales_commission: "12",
    delivery_commission: "10",
    phone_verified: "0",
    email_verified: "0",
    rating: "0",
    ratings_count: "0",
    is_open: "1",
    is_accepting_orders: "1",
    delivery_available: "1",
    closed_reason: "''",
    delivery_fee: "0",
    minimum_order: "0",
    maximum_order: "0",
    preparation_time_min: "15",
    preparation_time_max: "30",
    delivery_time_min: "30",
    delivery_time_max: "70",
    is_featured: "0",
    sort_order: "0",
    opening_hours: "'{}'",
    menu: "'[]'",
    orders: "'[]'",
    reviews: "'[]'",
    customers: "'[]'",
    delivery_zones: "'[]'",
    delivery_services: "'[]'",
    offers: "'[]'",
    gallery: "'[]'",
    social_links: "'{}'",
    tags: "'[]'",
    notifications: "'[]'",
    discount_codes: "'[]'",
    settings: "'{}'",
    created_at: "datetime('now')",
    updated_at: "datetime('now')"
};

function createTable(tableName, callback) {
    const fields = Object.entries(definitions)
        .map(([name, definition]) => `"${name}" ${definition}`)
        .join(", ");

    db.run(
        `CREATE TABLE "${tableName}" (${fields})`,
        callback
    );
}

function removeCityFields(value) {
    if (Array.isArray(value)) {
        return value.map(removeCityFields);
    }

    if (value && typeof value === "object") {
        const result = {};

        for (const [key, item] of Object.entries(value)) {
            if (["city", "city_ar", "city_en", "city_ru"].includes(key)) {
                continue;
            }

            result[key] = removeCityFields(item);
        }

        return result;
    }

    return value;
}

function cleanDeliveryZones(callback) {
    db.all(
        "SELECT id, delivery_zones FROM restaurants",
        [],
        (err, rows) => {
            if (err) {
                console.error(err.message);
                return callback(err);
            }

            let index = 0;

            function next() {
                if (index >= rows.length) {
                    return callback(null);
                }

                const row = rows[index++];

                if (!row.delivery_zones) {
                    return next();
                }

                let cleaned;

                try {
                    cleaned = JSON.stringify(
                        removeCityFields(JSON.parse(row.delivery_zones))
                    );
                } catch (error) {
                    console.error(
                        `Invalid delivery_zones for restaurant ${row.id}:`,
                        error.message
                    );
                    return next();
                }

                db.run(
                    "UPDATE restaurants SET delivery_zones = ? WHERE id = ?",
                    [cleaned, row.id],
                    error => {
                        if (error) {
                            console.error(error.message);
                            return callback(error);
                        }

                        next();
                    }
                );
            }

            next();
        }
    );
}

function migrateDatabase(existingColumns, callback) {
    db.serialize(() => {
        db.run("PRAGMA foreign_keys = OFF");

        db.run("BEGIN IMMEDIATE", error => {
            if (error) {
                return callback(error);
            }

            createTable("restaurants_new", error => {
                if (error) {
                    return rollback(error);
                }

                const targetColumns = columns
                    .map(name => `"${name}"`)
                    .join(", ");

                const selectExpressions = columns.map(name => {
                    if (existingColumns.has(name)) {
                        if (name === "logo") {
                            return `COALESCE(NULLIF("logo", ''), '${defaultLogo}')`;
                        }

                        return `"${name}"`;
                    }

                    return defaults[name] || "NULL";
                }).join(", ");

                db.run(
                    `INSERT INTO restaurants_new (${targetColumns})
                     SELECT ${selectExpressions}
                     FROM restaurants`,
                    error => {
                        if (error) {
                            return rollback(error);
                        }

                        db.run("DROP TABLE restaurants", error => {
                            if (error) {
                                return rollback(error);
                            }

                            db.run(
                                "ALTER TABLE restaurants_new RENAME TO restaurants",
                                error => {
                                    if (error) {
                                        return rollback(error);
                                    }

                                    db.run("COMMIT", error => {
                                        if (error) {
                                            return callback(error);
                                        }

                                        db.run(
                                            "PRAGMA foreign_keys = ON",
                                            error => {
                                                if (error) {
                                                    return callback(error);
                                                }

                                                cleanDeliveryZones(callback);
                                            }
                                        );
                                    });
                                }
                            );
                        });
                    }
                );
            });
        });

        function rollback(error) {
            db.run("ROLLBACK", () => {
                db.run("PRAGMA foreign_keys = ON", () => {
                    callback(error);
                });
            });
        }
    });
}

db.serialize(() => {
    db.run("PRAGMA busy_timeout = 10000");

    db.get(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'restaurants'",
        (error, table) => {
            if (error) {
                console.error("Database error:", error.message);
                return;
            }

            if (!table) {
                createTable("restaurants", error => {
                    if (error) {
                        console.error("Database creation error:", error.message);
                        return;
                    }

                    console.log("Restaurants database created successfully.");
                });

                return;
            }

            db.all(
                "PRAGMA table_info(restaurants)",
                (error, rows) => {
                    if (error) {
                        console.error("Database error:", error.message);
                        return;
                    }

                    const existingColumns = new Set(
                        rows.map(row => row.name)
                    );

                    migrateDatabase(existingColumns, error => {
                        if (error) {
                            console.error("Database migration error:", error.message);
                            return;
                        }

                        console.log("Restaurants database updated successfully.");
                    });
                }
            );
        }
    );
});

module.exports = { db };
