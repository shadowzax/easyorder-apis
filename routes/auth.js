const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const router = express.Router();
const { db } = require("../mydb/users");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";


router.get("/users", (req, res) => {
    db.all(
        `
        SELECT *
        FROM users
        ORDER BY created_at DESC
        `,
        [],
        (err, users) => {
            if (err) {
                console.error("Get Users DB Error:", err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            return res.status(200).json({
                success: true,
                count: users.length,
                users
            });
        }
    );
});

router.post("/register", async (req, res) => {
    const { name, email, phone_number, password } = req.body;

    if (!name || !email || !phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "الاسم ورقم الهاتف والبريد الإلكتروني وكلمة المرور مطلوبة"
        });
    }

    try {
        db.get(
            `
            SELECT id, email, phone_number
            FROM users
            WHERE email = ? OR phone_number = ?
            LIMIT 1
            `,
            [email.trim().toLowerCase(), phone_number.trim()],
            async (err, existingUser) => {
                if (err) {
                    console.error("Register DB Error:", err);
                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

                if (existingUser) {
                    if (
                        existingUser.email &&
                        existingUser.email.toLowerCase() === email.trim().toLowerCase()
                    ) {
                        return res.status(409).json({
                            success: false,
                            message: "البريد الإلكتروني مستخدم بالفعل"
                        });
                    }

                    if (
                        existingUser.phone_number &&
                        existingUser.phone_number === phone_number.trim()
                    ) {
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
                const userId = require("crypto").randomUUID();
                const now = new Date().toISOString();

                const dbData = {
                    language: "ar",
                    accountType: "user",
                    accountStatus: "active",
                    balance: 0,
                    points: 0,
                    phoneVerified: 0,
                    emailVerified: 0,
                    addresses: JSON.stringify([]),
                    notifications: JSON.stringify([]),
                    discountCodes: JSON.stringify([])
                };

                db.run(
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
                        userId,
                        name.trim(),
                        email.trim().toLowerCase(),
                        phone_number.trim(),
                        hashedPassword,
                        null,
                        dbData.accountType,
                        dbData.accountStatus,
                        dbData.language,
                        dbData.balance,
                        dbData.points,
                        dbData.phoneVerified,
                        dbData.emailVerified,
                        dbData.addresses,
                        dbData.notifications,
                        dbData.discountCodes,
                        null,
                        now,
                        now
                    ],
                    (insertErr) => {
                        if (insertErr) {
                            console.error("Create User Error:", insertErr);

                            if (
                                insertErr.message.includes("UNIQUE constraint failed")
                            ) {
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

                        const token = jwt.sign(
                            {
                                userId: userId
                            },
                            JWT_SECRET,
                            {
                                expiresIn: "7d"
                            }
                        );

                        return res.status(201).json({
                            success: true,
                            message: "تم إنشاء الحساب بنجاح",
                            token,
                            user: {
                                id: userId,
                                name: name.trim(),
                                email: email.trim().toLowerCase(),
                                phone_number: phone_number.trim(),
                                profile_picture: null,
                                account_type: dbData.accountType,
                                account_status: dbData.accountStatus,
                                language: dbData.language,
                                balance: dbData.balance,
                                points: dbData.points,
                                phone_verified: false,
                                email_verified: false,
                                addresses: [],
                                notifications: [],
                                discount_codes: [],
                                last_login: null,
                                created_at: now,
                                updated_at: now
                            }
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error("Register Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إنشاء الحساب"
        });
    }
});

router.post("/login", async (req, res) => {
    const { phone_number, password } = req.body;

    if (!phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "رقم الهاتف وكلمة المرور مطلوبان"
        });
    }

    try {
        const phone = phone_number.trim();

        db.get(
            `
            SELECT *
            FROM users
            WHERE phone_number = ?
            LIMIT 1
            `,
            [phone],
            async (err, user) => {
                if (err) {
                    console.error("Login DB Error:", err);

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

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

                const now = new Date().toISOString();

                db.run(
                    `
                    UPDATE users
                    SET last_login = ?, updated_at = ?
                    WHERE id = ?
                    `,
                    [now, now, user.id],
                    (updateErr) => {
                        if (updateErr) {
                            console.error("Login Update Error:", updateErr);

                            return res.status(500).json({
                                success: false,
                                message: "حدث خطأ أثناء تسجيل الدخول"
                            });
                        }

                        const token = jwt.sign(
                            {
                                userId: user.id
                            },
                            JWT_SECRET
                        );

                        let addresses = [];
                        let notifications = [];
                        let discountCodes = [];

                        try {
                            addresses = user.addresses
                                ? JSON.parse(user.addresses)
                                : [];
                        } catch {
                            addresses = [];
                        }

                        try {
                            notifications = user.notifications
                                ? JSON.parse(user.notifications)
                                : [];
                        } catch {
                            notifications = [];
                        }

                        try {
                            discountCodes = user.discount_codes
                                ? JSON.parse(user.discount_codes)
                                : [];
                        } catch {
                            discountCodes = [];
                        }

                        return res.status(200).json({
                            success: true,
                            message: "تم تسجيل الدخول بنجاح",
                            token,
                            user: {
                                id: user.id,
                                name: user.name,
                                email: user.email,
                                phone_number: user.phone_number,
                                profile_picture: user.profile_picture,
                                account_type: user.account_type,
                                account_status: user.account_status,
                                language: user.language,
                                balance: user.balance,
                                points: user.points,
                                phone_verified: Boolean(user.phone_verified),
                                email_verified: Boolean(user.email_verified),
                                addresses,
                                notifications,
                                discount_codes: discountCodes,
                                last_login: now,
                                created_at: user.created_at,
                                updated_at: now
                            }
                        });
                    }
                );
            }
        );
    } catch (error) {
        console.error("Login Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تسجيل الدخول"
        });
    }
});

router.post("/check-token", (req, res) => {
    const { token } = req.body;

    if (!token || typeof token !== "string" || !token.trim()) {
        return res.status(400).json({
            success: false,
            message: "التوكين مطلوب"
        });
    }

    jwt.verify(token.trim(), JWT_SECRET, (err, decoded) => {
        if (err || !decoded) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        const userId = decoded.userId || decoded.id;

        if (!userId) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        db.get(
            `
            SELECT *
            FROM users
            WHERE id = ?
            LIMIT 1
            `,
            [userId],
            (err, user) => {
                if (err) {
                    console.error("Check Token DB Error:", err);

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

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

                let addresses = [];
                let notifications = [];
                let discount_codes = [];

                try {
                    addresses = user.addresses
                        ? JSON.parse(user.addresses)
                        : [];
                } catch (e) {
                    addresses = [];
                }

                try {
                    notifications = user.notifications
                        ? JSON.parse(user.notifications)
                        : [];
                } catch (e) {
                    notifications = [];
                }

                try {
                    discount_codes = user.discount_codes
                        ? JSON.parse(user.discount_codes)
                        : [];
                } catch (e) {
                    discount_codes = [];
                }

                return res.status(200).json({
                    success: true,
                    message: "التوكين صالح",
                    user: {
                        id: user.id,
                        name: user.name,
                        email: user.email,
                        phone_number: user.phone_number,
                        profile_picture: user.profile_picture,
                        account_type: user.account_type,
                        account_status: user.account_status,
                        language: user.language,
                        balance: user.balance,
                        points: user.points,
                        phone_verified: Boolean(user.phone_verified),
                        email_verified: Boolean(user.email_verified),
                        addresses,
                        notifications,
                        discount_codes,
                        last_login: user.last_login,
                        created_at: user.created_at,
                        updated_at: user.updated_at
                    }
                });
            }
        );
    });
});

module.exports = router;