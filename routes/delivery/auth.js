const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();
const { db } = require("../../mydb/delivery");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

const parse = (value, fallback) => {
    if (value === null || value === undefined || value === "") {
        return fallback;
    }

    if (typeof value === "object") {
        return value;
    }

    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
};

const bool = value =>
    value === 1 ||
    value === true ||
    value === "1" ||
    value === "true" ||
    value === "TRUE";

const deliveryData = (delivery, lastLogin = delivery.last_login) => ({
    id: delivery.id,

    name: delivery.name,

    email: delivery.email,
    phone_number: delivery.phone_number,

    profile_picture: delivery.profile_picture,

    account_type: delivery.account_type,
    account_status: delivery.account_status,

    language: delivery.language,

    balance: delivery.balance,
    points: delivery.points,

    is_active: bool(delivery.is_active),

    orders_count: delivery.orders_count,
    completed_orders: delivery.completed_orders,
    cancelled_orders: delivery.cancelled_orders,

    total_earnings: delivery.total_earnings,
    total_delivery_fees: delivery.total_delivery_fees,
    total_commission: delivery.total_commission,

    total_order_value: delivery.total_order_value,
    total_items_subtotal: delivery.total_items_subtotal,
    total_discounts: delivery.total_discounts,
    total_vat: delivery.total_vat,
    total_processing_fees: delivery.total_processing_fees,

    total_app_commission: delivery.total_app_commission,
    total_restaurant_commission: delivery.total_restaurant_commission,

    total_restaurant_net: delivery.total_restaurant_net,
    total_app_net: delivery.total_app_net,
    total_delivery_net_earnings: delivery.total_delivery_net_earnings,

    total_amount_due_to_restaurant: delivery.total_amount_due_to_restaurant,
    total_amount_due_to_app: delivery.total_amount_due_to_app,

    total_tips: delivery.total_tips,

    total_cash_collected: delivery.total_cash_collected,
    total_cash_to_restaurant: delivery.total_cash_to_restaurant,
    total_cash_to_app: delivery.total_cash_to_app,
    total_cash_to_delivery: delivery.total_cash_to_delivery,

    total_card_collected: delivery.total_card_collected,
    total_wallet_collected: delivery.total_wallet_collected,

    current_order_id: delivery.current_order_id,

    orders_history: parse(delivery.orders_history, []),

    last_login: lastLogin,

    created_at: delivery.created_at,
    updated_at: delivery.updated_at
});
const generateToken = id =>
    jwt.sign(
        { deliveryId: id },
        JWT_SECRET
    );

router.post("/register", async (req, res) => {
    const {
        name,
        email,
        phone_number,
        password
    } = req.body;

    if (!name || !email || !phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "الاسم والبريد الإلكتروني ورقم الهاتف وكلمة المرور مطلوبة"
        });
    }

    const cleanName = String(name).trim();
    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone_number).trim();

    db.get(
        `
        SELECT id, email, phone_number
        FROM delivery_accounts
        WHERE email = ? OR phone_number = ?
        LIMIT 1
        `,
        [cleanEmail, cleanPhone],
        async (err, existing) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            if (existing) {
                return res.status(409).json({
                    success: false,
                    message:
                        existing.email?.toLowerCase() === cleanEmail
                            ? "البريد الإلكتروني مستخدم بالفعل"
                            : "رقم الهاتف مستخدم بالفعل"
                });
            }

            try {
                const passwordHash = await bcrypt.hash(password, 12);
                const now = new Date().toISOString();
                const id = crypto.randomUUID();

                db.run(
                    `
                    INSERT INTO delivery_accounts (
                        id,
                        name,
                        email,
                        phone_number,
                        profile_picture,
                        password,
                        account_type,
                        account_status,
                        language,
                        balance,
                        points,
                        is_active,
                        orders_count,
                        completed_orders,
                        cancelled_orders,
                        total_earnings,
                        total_delivery_fees,
                        total_commission,
                        current_order_id,
                        orders_history,
                        last_login,
                        created_at,
                        updated_at
                    )
                    VALUES (
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?, ?,
                        ?, ?, ?, ?, ?
                    )
                    `,
                    [
                        id,
                        cleanName,
                        cleanEmail,
                        cleanPhone,
                        "https://i.ibb.co/HRbkkLw/3177440-1.jpg",
                        passwordHash,

                        "delivery",
                        "active",
                        "ar",

                        0,
                        0,
                        0,

                        0,
                        0,
                        0,

                        0,
                        0,
                        0,

                        null,
                        "[]",

                        null,
                        now,
                        now
                    ],
                    function (insertErr) {
                        if (insertErr) {
                            console.error(insertErr);

                            return res.status(
                                insertErr.message.includes("UNIQUE")
                                    ? 409
                                    : 500
                            ).json({
                                success: false,
                                message:
                                    insertErr.message.includes("UNIQUE")
                                        ? "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
                                        : "حدث خطأ أثناء إنشاء حساب الدليفري"
                            });
                        }

                        db.get(
                            `
                            SELECT *
                            FROM delivery_accounts
                            WHERE id = ?
                            LIMIT 1
                            `,
                            [id],
                            (getErr, delivery) => {
                                if (getErr) {
                                    console.error(getErr);

                                    return res.status(500).json({
                                        success: false,
                                        message: "حدث خطأ أثناء جلب بيانات حساب الدليفري"
                                    });
                                }

                                return res.status(201).json({
                                    success: true,
                                    message: "تم إنشاء حساب الدليفري بنجاح",
                                    token: generateToken(delivery.id),
                                    delivery: deliveryData(delivery)
                                });
                            }
                        );
                    }
                );
            } catch (error) {
                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ أثناء إنشاء حساب الدليفري"
                });
            }
        }
    );
});

router.post("/login", async (req, res) => {
    const {
        phone_number,
        password
    } = req.body;

    if (!phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "رقم الهاتف وكلمة المرور مطلوبان"
        });
    }

    const cleanPhone = String(phone_number).trim();

    db.get(
        `
        SELECT *
        FROM delivery_accounts
        WHERE phone_number = ?
        LIMIT 1
        `,
        [cleanPhone],
        async (err, delivery) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            if (!delivery || delivery.account_status !== "active") {
                return res.status(401).json({
                    success: false,
                    message: "رقم الهاتف أو كلمة المرور غير صحيحة"
                });
            }

            try {
                const passwordMatch = await bcrypt.compare(
                    password,
                    delivery.password
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
                    UPDATE delivery_accounts
                    SET last_login = ?,
                        updated_at = ?
                    WHERE id = ?
                    `,
                    [now, now, delivery.id],
                    updateErr => {
                        if (updateErr) {
                            console.error(updateErr);

                            return res.status(500).json({
                                success: false,
                                message: "حدث خطأ أثناء تسجيل الدخول"
                            });
                        }

                        delivery.last_login = now;
                        delivery.updated_at = now;

                        return res.json({
                            success: true,
                            message: "تم تسجيل الدخول بنجاح",
                            token: generateToken(delivery.id),
                            delivery: deliveryData(delivery, now)
                        });
                    }
                );
            } catch (error) {
                console.error(error);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ أثناء تسجيل الدخول"
                });
            }
        }
    );
});

router.post("/check-token", (req, res) => {
    const token = String(req.body.token || "").trim();

    if (!token) {
        return res.status(400).json({
            success: false,
            message: "التوكين مطلوب"
        });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || !decoded) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        const deliveryId =
            decoded.deliveryId ||
            decoded.userId ||
            decoded.id;

        if (!deliveryId) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        db.get(
            `
            SELECT *
            FROM delivery_accounts
            WHERE id = ?
            LIMIT 1
            `,
            [deliveryId],
            (dbErr, delivery) => {
                if (dbErr) {
                    console.error(dbErr);

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

                if (!delivery) {
                    return res.status(404).json({
                        success: false,
                        message: "حساب الدليفري غير موجود"
                    });
                }

                if (delivery.account_status !== "active") {
                    return res.status(403).json({
                        success: false,
                        message: "هذا الحساب غير نشط"
                    });
                }

                return res.json({
                    success: true,
                    message: "التوكين صالح",
                    delivery: deliveryData(delivery)
                });
            }
        );
    });
});
router.post("/toggle-active", (req, res) => {
    const token = String(req.body.token || "").trim();

    if (!token) {
        return res.status(400).json({
            success: false,
            message: "التوكين مطلوب"
        });
    }

    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err || !decoded) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        const deliveryId =
            decoded.deliveryId ||
            decoded.userId ||
            decoded.id;

        if (!deliveryId) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        db.get(
            `
            SELECT id, name, account_status, is_active
            FROM delivery_accounts
            WHERE id = ?
            LIMIT 1
            `,
            [deliveryId],
            (dbErr, delivery) => {
                if (dbErr) {
                    console.error("Toggle Active DB Error:", dbErr);

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

                if (!delivery) {
                    return res.status(404).json({
                        success: false,
                        message: "حساب الدليفري غير موجود"
                    });
                }

                if (delivery.account_status !== "active") {
                    return res.status(403).json({
                        success: false,
                        message: "حساب الدليفري غير نشط"
                    });
                }

                const newStatus =
                    Number(delivery.is_active) === 1 ? 0 : 1;

                db.run(
                    `
                    UPDATE delivery_accounts
                    SET is_active = ?,
                        updated_at = ?
                    WHERE id = ?
                    `,
                    [
                        newStatus,
                        new Date().toISOString(),
                        deliveryId
                    ],
                    function (updateErr) {
                        if (updateErr) {
                            console.error(
                                "Toggle Active Update Error:",
                                updateErr
                            );

                            return res.status(500).json({
                                success: false,
                                message: "فشل تحديث حالة الدليفري"
                            });
                        }

                        if (this.changes === 0) {
                            return res.status(400).json({
                                success: false,
                                message: "لم يتم تغيير الحالة"
                            });
                        }

                        return res.json({
                            success: true,
                            message:
                                newStatus === 1
                                    ? "تم تنشيط الدليفري"
                                    : "تم إيقاف الدليفري",
                            is_active: newStatus
                        });
                    }
                );
            }
        );
    });
});
router.get("/create", async (req, res) => {
    const name = "عبدالرحمن محمد";
    const email = "abdelrahman@example.com";
    const phone_number = "01063720595";
    const password = "123";

    db.get(
        `SELECT id FROM delivery_accounts WHERE email = ? OR phone_number = ? LIMIT 1`,
        [email, phone_number],
        async (err, existing) => {
            if (err) return res.status(500).json({ success: false, message: "خطأ في قاعدة البيانات" });

            if (existing) {
                return res.json({
                    success: false,
                    message: "الحساب موجود بالفعل",
                    id: existing.id
                });
            }

            try {
                const passwordHash = await bcrypt.hash(password, 12);
                const now = new Date().toISOString();
                const id = crypto.randomUUID();

                db.run(
                    `INSERT INTO delivery_accounts (
                        id, name, email, phone_number, profile_picture, password,
                        account_type, account_status, language, balance, points,
                        is_active, orders_count, completed_orders, cancelled_orders,
                        total_earnings, total_delivery_fees, total_commission,
                        current_order_id, orders_history, last_login, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [
                        id,
                        name,
                        email,
                        phone_number,
                        "https://i.ibb.co/HRbkkLw/3177440-1.jpg",
                        passwordHash,
                        "delivery",
                        "active",
                        "ar",
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        0,
                        null,
                        "[]",
                        null,
                        now,
                        now
                    ],
                    err => {
                        if (err) {
                            console.error(err);
                            return res.status(500).json({
                                success: false,
                                message: "فشل إنشاء الحساب"
                            });
                        }

                        res.json({
                            success: true,
                            message: "تم إنشاء حساب الدليفري بنجاح",
                            id,
                            name,
                            email,
                            phone_number,
                            password
                        });
                    }
                );
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    success: false,
                    message: "حدث خطأ أثناء إنشاء الحساب"
                });
            }
        }
    );
});
/*----------------------------------*/

router.get("/all", (req, res) => {
    db.all(
        `
        SELECT *
        FROM delivery_accounts
        ORDER BY created_at DESC
        `,
        [],
        (err, deliveries) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات",
                    error: err.message
                });
            }

            return res.json({
                success: true,
                count: deliveries.length,
                deliveries
            });
        }
    );
});
module.exports = router;