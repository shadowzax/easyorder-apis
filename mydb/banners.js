const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataFolder = path.join(__dirname, "..", "data");

if (!fs.existsSync(dataFolder)) {
    fs.mkdirSync(dataFolder, { recursive: true });
}

const dbPath = path.join(dataFolder, "banners.sqlite");

const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error(err.message);
    } else {
        console.log("Connected to banners database.");
    }
});

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS banners (
            id INTEGER PRIMARY KEY,

            hero_banners TEXT DEFAULT '[]',
            carousel_banners TEXT DEFAULT '[]',
            middle_banners TEXT DEFAULT '[]',
            general_banners TEXT DEFAULT '[]',
            delivery_banners TEXT DEFAULT '[]',

            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.run(`
        INSERT OR IGNORE INTO banners (id)
        VALUES (1)
    `);
});

module.exports = { db };