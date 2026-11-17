const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();
const { db } = require("../../mydb/users");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
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

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ changes: this.changes });
        });
    });
}

function parseArray(value) {
    try {
        const parsed = typeof value === "string"
            ? JSON.parse(value || "[]")
            : value;

        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function userData(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        phone_number: user.phone_number,
        profile_picture: user.profile_picture,
        account_type: user.account_type,
        account_status: user.account_status,
        language: user.language,
        balance: Number(user.balance) || 0,
        points: Number(user.points) || 0,
        phone_verified: Boolean(user.phone_verified),
        email_verified: Boolean(user.email_verified),
        addresses: parseArray(user.addresses),
        notifications: parseArray(user.notifications),
        discount_codes: parseArray(user.discount_codes),
        last_login: user.last_login,
        created_at: user.created_at,
        updated_at: user.updated_at
    };
}

function normalizeEmail(value) {
    return String(value || "").trim().toLowerCase();
}

function normalizePhone(value) {
    return String(value || "").trim();
}

router.post("/register", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const phone_number = normalizePhone(req.body?.phone_number);
    const password = String(req.body?.password || "");

    if (!name || !email || !phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "الاسم ورقم الهاتف والبريد الإلكتروني وكلمة المرور مطلوبة"
        });
    }

    if (password.length < 6 || password.length > 128) {
        return res.status(400).json({
            success: false,
            message: "كلمة المرور يجب أن تكون من 6 إلى 128 حرفًا"
        });
    }

    try {
        const existingUser = await dbGet(
            `
            SELECT id, email, phone_number
            FROM users
            WHERE email = ? OR phone_number = ?
            LIMIT 1
            `,
            [email, phone_number]
        );

        if (existingUser) {
            if (existingUser.email?.toLowerCase() === email) {
                return res.status(409).json({
                    success: false,
                    message: "البريد الإلكتروني مستخدم بالفعل"
                });
            }

            if (existingUser.phone_number === phone_number) {
                return res.status(409).json({
                    success: false,
                    message: "رقم الهاتف مستخدم بالفعل"
                });
            }

            return res.status(409).json({
                success: false,
                message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
            });
        }

        const hashedPassword = await bcrypt.hash(password, 12);
        const userId = crypto.randomUUID();
        const now = new Date().toISOString();

        const user = {
            id: userId,
            name,
            email,
            phone_number,
            profile_picture: null,
            account_type: "user",
            account_status: "active",
            language: "ar",
            balance: 0,
            points: 0,
            phone_verified: 0,
            email_verified: 0,
            addresses: "[]",
            notifications: "[]",
            discount_codes: "[]",
            last_login: null,
            created_at: now,
            updated_at: now
        };

        await dbRun(
            `
            INSERT INTO users (
                id,
                name,
                email,
                phone_number,
                password,
                profile_picture,
                account_type,
                account_status,
                language,
                balance,
                points,
                phone_verified,
                email_verified,
                addresses,
                notifications,
                discount_codes,
                last_login,
                created_at,
                updated_at
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `,
            [
                user.id,
                user.name,
                user.email,
                user.phone_number,
                hashedPassword,
                user.profile_picture,
                user.account_type,
                user.account_status,
                user.language,
                user.balance,
                user.points,
                user.phone_verified,
                user.email_verified,
                user.addresses,
                user.notifications,
                user.discount_codes,
                user.last_login,
                user.created_at,
                user.updated_at
            ]
        );

        const token = jwt.sign(
            { userId },
            JWT_SECRET,
            { expiresIn: "7d" }
        );

        return res.status(201).json({
            success: true,
            message: "تم إنشاء الحساب بنجاح",
            token,
            user: userData(user)
        });
    } catch (err) {
        console.error("Register Error:", err);

        if (String(err.message).includes("UNIQUE constraint failed")) {
            return res.status(409).json({
                success: false,
                message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
            });
        }

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إنشاء الحساب"
        });
    }
});

router.post("/login", async (req, res) => {
    const phone_number = normalizePhone(req.body?.phone_number);
    const password = String(req.body?.password || "");

    if (!phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "رقم الهاتف وكلمة المرور مطلوبان"
        });
    }

    try {
        const user = await dbGet(
            `
            SELECT *
            FROM users
            WHERE phone_number = ?
            LIMIT 1
            `,
            [phone_number]
        );

        if (!user) {
            return res.status(401).json({
                success: false,
                message: "رقم الهاتف أو كلمة المرور غير صحيحة"
            });
        }

        const passwordMatch = await bcrypt.compare(
            password,
            user.password
        );

        if (!passwordMatch) {
            return res.status(401).json({
                success: false,
                message: "رقم الهاتف أو كلمة المرور غير صحيحة"
            });
        }

        if (user.account_status !== "active") {
            return res.status(403).json({
                success: false,
                message: "هذا الحساب غير نشط"
            });
        }

        const now = new Date().toISOString();

        await dbRun(
            `
            UPDATE users
            SET last_login = ?,
                updated_at = ?
            WHERE id = ?
            `,
            [now, now, user.id]
        );

        const token = jwt.sign(
            { userId: user.id },
            JWT_SECRET
        );

        const updatedUser = {
            ...user,
            last_login: now,
            updated_at: now
        };

        return res.status(200).json({
            success: true,
            message: "تم تسجيل الدخول بنجاح",
            token,
            user: userData(updatedUser)
        });
    } catch (err) {
        console.error("Login Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تسجيل الدخول"
        });
    }
});

router.post("/check-token", async (req, res) => {
    const token = req.body?.token;

    if (!token || typeof token !== "string" || !token.trim()) {
        return res.status(400).json({
            success: false,
            message: "التوكين مطلوب"
        });
    }

    try {
        const decoded = jwt.verify(token.trim(), JWT_SECRET);
        const userId = decoded.userId || decoded.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        const user = await dbGet(
            "SELECT * FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        if (user.account_status !== "active") {
            return res.status(403).json({
                success: false,
                message: "هذا الحساب غير نشط"
            });
        }

        return res.status(200).json({
            success: true,
            message: "التوكين صالح",
            user: userData(user)
        });
    } catch (err) {
        if (err.name === "JsonWebTokenError" || err.name === "TokenExpiredError") {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        console.error("Check Token Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء التحقق من التوكين"
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const users = await dbAll(
            `
            SELECT
                id,
                name,
                email,
                phone_number,
                profile_picture,
                account_type,
                account_status,
                language,
                balance,
                points,
                phone_verified,
                email_verified,
                addresses,
                notifications,
                discount_codes,
                last_login,
                created_at,
                updated_at
            FROM users
            ORDER BY created_at DESC
            `
        );

        return res.status(200).json({
            success: true,
            count: users.length,
            users: users.map(userData)
        });
    } catch (err) {
        console.error("Get Users Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب المستخدمين"
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const user = await dbGet(
            `
            SELECT
                id,
                name,
                email,
                phone_number,
                profile_picture,
                account_type,
                account_status,
                language,
                balance,
                points,
                phone_verified,
                email_verified,
                addresses,
                notifications,
                discount_codes,
                last_login,
                created_at,
                updated_at
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [req.params.id]
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        return res.status(200).json({
            success: true,
            user: userData(user)
        });
    } catch (err) {
        console.error("Get User Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب بيانات المستخدم"
        });
    }
});

router.patch("/:id", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "معرّف المستخدم مطلوب"
            });
        }

        const existingUser = await dbGet(
            "SELECT * FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        if (!existingUser) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        const allowedFields = [
            "name",
            "email",
            "phone_number",
            "profile_picture",
            "language",
            "account_status",
            "points",
            "phone_verified",
            "email_verified"
        ];

        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (!Object.prototype.hasOwnProperty.call(req.body || {}, field)) {
                continue;
            }

            let value = req.body[field];

            if (field === "name") {
                value = String(value ?? "").trim();

                if (!value || value.length > 150) {
                    return res.status(400).json({
                        success: false,
                        message: "الاسم مطلوب ويجب ألا يتجاوز 150 حرفًا"
                    });
                }
            }

            if (field === "email") {
                value = normalizeEmail(value);

                if (
                    !value ||
                    value.length > 254 ||
                    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
                ) {
                    return res.status(400).json({
                        success: false,
                        message: "البريد الإلكتروني غير صحيح"
                    });
                }
            }

            if (field === "phone_number") {
                value = normalizePhone(value);

                if (!value || value.length > 30) {
                    return res.status(400).json({
                        success: false,
                        message: "رقم الهاتف غير صحيح"
                    });
                }
            }

            if (field === "profile_picture") {
                if (value !== null) {
                    value = String(value).trim();

                    if (value.length > 2000) {
                        return res.status(400).json({
                            success: false,
                            message: "رابط الصورة طويل جدًا"
                        });
                    }

                    if (value && !/^https?:\/\/\S+$/i.test(value)) {
                        return res.status(400).json({
                            success: false,
                            message: "رابط الصورة غير صحيح"
                        });
                    }
                }
            }

            if (field === "language") {
                value = String(value ?? "").trim().toLowerCase();

                if (!value || value.length > 10) {
                    return res.status(400).json({
                        success: false,
                        message: "اللغة غير صحيحة"
                    });
                }
            }

            if (field === "account_status") {
                value = String(value ?? "").trim().toLowerCase();

                if (!["active", "inactive", "suspended", "blocked"].includes(value)) {
                    return res.status(400).json({
                        success: false,
                        message: "حالة الحساب غير صحيحة"
                    });
                }
            }

            if (field === "points") {
                value = Number(value);

                if (!Number.isInteger(value) || value < 0) {
                    return res.status(400).json({
                        success: false,
                        message: "عدد النقاط يجب أن يكون رقمًا صحيحًا غير سالب"
                    });
                }
            }

            if (field === "phone_verified" || field === "email_verified") {
                if (![true, false, 0, 1].includes(value)) {
                    return res.status(400).json({
                        success: false,
                        message: "قيمة التحقق يجب أن تكون true أو false"
                    });
                }

                value = value ? 1 : 0;
            }

            updates.push(`${field} = ?`);
            values.push(value);
        }

        if (req.body?.password !== undefined) {
            const password = String(req.body.password);

            if (password.length < 6 || password.length > 128) {
                return res.status(400).json({
                    success: false,
                    message: "كلمة المرور يجب أن تكون من 6 إلى 128 حرفًا"
                });
            }

            const hashedPassword = await bcrypt.hash(password, 12);

            updates.push("password = ?");
            values.push(hashedPassword);
        }

        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: "لم يتم إرسال أي بيانات للتعديل"
            });
        }

        const now = new Date().toISOString();

        updates.push("updated_at = ?");
        values.push(now);
        values.push(userId);

        await dbRun(
            `
            UPDATE users
            SET ${updates.join(", ")}
            WHERE id = ?
            `,
            values
        );

        const updatedUser = await dbGet(
            "SELECT * FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        return res.status(200).json({
            success: true,
            message: "تم تحديث بيانات المستخدم بنجاح",
            user: userData(updatedUser)
        });
    } catch (err) {
        console.error("Update User Error:", err);

        if (String(err.message).includes("UNIQUE constraint failed")) {
            return res.status(409).json({
                success: false,
                message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
            });
        }

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تحديث بيانات المستخدم"
        });
    }
});

router.post("/:id/balance", async (req, res) => {
    try {
        const userId = String(req.params.id || "").trim();
        const amount = Number(req.body?.amount);
        const operation = String(req.body?.operation || "add")
            .trim()
            .toLowerCase();

        const description = String(
            req.body?.description || ""
        ).trim();

        if (!userId) {
            return res.status(400).json({
                success: false,
                message: "معرّف المستخدم مطلوب"
            });
        }

        if (
            !Number.isFinite(amount) ||
            amount <= 0 ||
            !Number.isSafeInteger(Math.round(amount * 100)) ||
            Math.round(amount * 100) / 100 !== amount
        ) {
            return res.status(400).json({
                success: false,
                message: "المبلغ يجب أن يكون رقمًا موجبًا بحد أقصى منزلتين عشريتين"
            });
        }

        if (!["add", "subtract"].includes(operation)) {
            return res.status(400).json({
                success: false,
                message: "العملية يجب أن تكون add أو subtract"
            });
        }

        if (description.length > 500) {
            return res.status(400).json({
                success: false,
                message: "وصف العملية يجب ألا يتجاوز 500 حرف"
            });
        }

        const user = await dbGet(
            "SELECT id, balance FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        const now = new Date().toISOString();

        let result;

        if (operation === "add") {
            result = await dbRun(
                `
                UPDATE users
                SET balance = COALESCE(balance, 0) + ?,
                    updated_at = ?
                WHERE id = ?
                `,
                [amount, now, userId]
            );
        } else {
            result = await dbRun(
                `
                UPDATE users
                SET balance = COALESCE(balance, 0) - ?,
                    updated_at = ?
                WHERE id = ?
                  AND COALESCE(balance, 0) >= ?
                `,
                [amount, now, userId, amount]
            );
        }

        if (result.changes !== 1) {
            return res.status(409).json({
                success: false,
                message: operation === "subtract"
                    ? "رصيد المستخدم غير كافٍ"
                    : "تعذر تحديث الرصيد"
            });
        }

        const updatedUser = await dbGet(
            `
            SELECT id, name, email, phone_number, balance, updated_at
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [userId]
        );

        return res.status(200).json({
            success: true,
            message: operation === "add"
                ? "تمت إضافة الرصيد بنجاح"
                : "تم خصم الرصيد بنجاح",
            operation,
            amount,
            description: description || null,
            user: updatedUser
        });
    } catch (err) {
        console.error("Update User Balance Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تعديل رصيد المستخدم"
        });
    }
});

module.exports = router;