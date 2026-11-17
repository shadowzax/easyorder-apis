const sqlite3 = require("sqlite3").verbose();
const path = require("path");
const fs = require("fs");

const dataDir = path.join(__dirname, "..", "data");
const dbPath = path.join(dataDir, "users.sqlite");
const defaultProfilePicture = "https://i.ibb.co/chQVw27k/Screenshot-2026-10-20-at-12-29-46.png";

if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
}

const db = new sqlite3.Database(dbPath);

db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            email TEXT UNIQUE,
            phone_number TEXT UNIQUE,
            profile_picture TEXT DEFAULT '${defaultProfilePicture}',
            password TEXT NOT NULL,
            account_type TEXT DEFAULT 'customer',
            account_status TEXT DEFAULT 'active',
            language TEXT DEFAULT 'ar',
            balance REAL DEFAULT 0,
            points INTEGER DEFAULT 0,
            phone_verified INTEGER DEFAULT 0,
            email_verified INTEGER DEFAULT 0,
            addresses TEXT DEFAULT '[]',
            notifications TEXT DEFAULT '[]',
            discount_codes TEXT DEFAULT '[]',
            last_login TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
    `, (err) => {
        if (err) {
            console.error("Database error:", err.message);
            return;
        }

        db.all("PRAGMA table_info(users)", (err, columns) => {
            if (err) {
                console.error("Database error:", err.message);
                return;
            }

            const hasProfilePicture = columns.some(column => column.name === "profile_picture");

            const updateExistingUsers = () => {
                db.run(
                    `UPDATE users SET profile_picture = ? WHERE profile_picture IS NULL OR TRIM(profile_picture) = ''`,
                    [defaultProfilePicture],
                    (err) => {
                        if (err) {
                            console.error("Profile picture update error:", err.message);
                            return;
                        }

                        console.log("Users database ready.");
                    }
                );
            };

            if (!hasProfilePicture) {
                db.run(
                    `ALTER TABLE users ADD COLUMN profile_picture TEXT DEFAULT '${defaultProfilePicture}'`,
                    (err) => {
                        if (err) {
                            console.error("Profile picture column error:", err.message);
                            return;
                        }

                        updateExistingUsers();
                    }
                );
            } else {
                updateExistingUsers();
            }
        });
    });
});

module.exports = {
    db
};