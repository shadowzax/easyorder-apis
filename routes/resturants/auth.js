const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const { db } = require("../../mydb/restaurants");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

const parse = (value, fallback) => {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "object") return value;
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

const restaurantData = (r, lastLogin = r.last_login) => ({
    id: r.id,
    owner_name_ar: r.owner_name_ar,
    owner_name_en: r.owner_name_en,
    owner_name_ru: r.owner_name_ru,
    restaurant_name_ar: r.restaurant_name_ar,
    restaurant_name_en: r.restaurant_name_en,
    restaurant_name_ru: r.restaurant_name_ru,
    email: r.email,
    phone_number: r.phone_number,
    logo: r.logo,
    cover_image: r.cover_image,
    description_ar: r.description_ar,
    description_en: r.description_en,
    description_ru: r.description_ru,
    category_ar: r.category_ar,
    category_en: r.category_en,
    category_ru: r.category_ru,
    address_ar: r.address_ar,
    address_en: r.address_en,
    address_ru: r.address_ru,
    latitude: r.latitude,
    longitude: r.longitude,
    account_type: r.account_type,
    account_status: r.account_status,
    language: r.language,
    balance: r.balance,
    points: r.points,
    orders_count: r.orders_count,
    sales_commission: r.sales_commission,
    delivery_commission: r.delivery_commission,
    phone_verified: bool(r.phone_verified),
    email_verified: bool(r.email_verified),
    is_open: bool(r.is_open),
    delivery_available: bool(r.delivery_available),
    delivery_fee: r.delivery_fee,
    minimum_order: r.minimum_order,
    opening_hours: parse(r.opening_hours, {}),
    menu: parse(r.menu, []),
    delivery_zones: parse(r.delivery_zones, []),
    delivery_services: parse(r.delivery_services, []),
    offers: parse(r.offers, []),
    gallery: parse(r.gallery, []),
    social_links: parse(r.social_links, {}),
    tags: parse(r.tags, []),
    notifications: parse(r.notifications, []),
    discount_codes: parse(r.discount_codes, []),
    settings: parse(r.settings, {}),
    last_login: lastLogin,
    created_at: r.created_at,
    updated_at: r.updated_at
});

const generateToken = id => jwt.sign({ restaurantId: id }, JWT_SECRET);

router.post("/register", async (req, res) => {
    const {
        owner_name_ar,
        owner_name_en,
        owner_name_ru,
        restaurant_name_ar,
        restaurant_name_en,
        restaurant_name_ru,
        email,
        phone_number,
        password,
        description_ar = "",
        description_en = "",
        description_ru = "",
        category_ar = "",
        category_en = "",
        category_ru = "",
        address_ar = "",
        address_en = "",
        address_ru = ""
    } = req.body;

    if (
        !owner_name_ar ||
        !owner_name_en ||
        !owner_name_ru ||
        !restaurant_name_ar ||
        !restaurant_name_en ||
        !restaurant_name_ru ||
        !email ||
        !phone_number ||
        !password
    ) {
        return res.status(400).json({
            success: false,
            message: "بيانات المالك والمطعم والبريد الإلكتروني ورقم الهاتف وكلمة المرور مطلوبة"
        });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanPhone = String(phone_number).trim();

    db.get(
        "SELECT id, email, phone_number FROM restaurants WHERE email = ? OR phone_number = ? LIMIT 1",
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

                const columns = [
                    "owner_name_ar","owner_name_en","owner_name_ru",
                    "restaurant_name_ar","restaurant_name_en","restaurant_name_ru",
                    "email","phone_number","password",
                    "logo","cover_image",
                    "description_ar","description_en","description_ru",
                    "category_ar","category_en","category_ru",
                    "address_ar","address_en","address_ru",
                    "latitude","longitude",
                    "account_type","account_status","language",
                    "balance","points","orders_count",
                    "sales_commission","delivery_commission",
                    "phone_verified","email_verified",
                    "is_open","delivery_available",
                    "delivery_fee","minimum_order",
                    "opening_hours","menu","delivery_zones","delivery_services",
                    "offers","gallery","social_links","tags","notifications",
                    "discount_codes","settings",
                    "last_login","created_at","updated_at"
                ];

                const values = [
                    String(owner_name_ar).trim(),
                    String(owner_name_en).trim(),
                    String(owner_name_ru).trim(),
                    String(restaurant_name_ar).trim(),
                    String(restaurant_name_en).trim(),
                    String(restaurant_name_ru).trim(),
                    cleanEmail,
                    cleanPhone,
                    passwordHash,
                    "https://i.ibb.co/HRbkkLw/3177440-1.jpg",
                    null,
                    String(description_ar).trim(),
                    String(description_en).trim(),
                    String(description_ru).trim(),
                    String(category_ar).trim(),
                    String(category_en).trim(),
                    String(category_ru).trim(),
                    String(address_ar).trim(),
                    String(address_en).trim(),
                    String(address_ru).trim(),
                    null,
                    null,
                    "restaurant",
                    "active",
                    "ar",
                    0,
                    0,
                    0,
                    12,
                    10,
                    0,
                    0,
                    1,
                    1,
                    0,
                    0,
                    "{}",
                    "[]",
                    "[]",
                    "[]",
                    "[]",
                    "[]",
                    "{}",
                    "[]",
                    "[]",
                    "[]",
                    "{}",
                    null,
                    now,
                    now
                ];

                db.run(
                    `INSERT INTO restaurants (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})`,
                    values,
                    function (insertErr) {
                        if (insertErr) {
                            console.error(insertErr);
                            return res.status(
                                insertErr.message.includes("UNIQUE") ? 409 : 500
                            ).json({
                                success: false,
                                message: insertErr.message.includes("UNIQUE")
                                    ? "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
                                    : "حدث خطأ أثناء إنشاء حساب المطعم"
                            });
                        }

                        db.get(
                            "SELECT * FROM restaurants WHERE id = ? LIMIT 1",
                            [this.lastID],
                            (getErr, restaurant) => {
                                if (getErr) {
                                    console.error(getErr);
                                    return res.status(500).json({
                                        success: false,
                                        message: "حدث خطأ أثناء جلب بيانات المطعم"
                                    });
                                }

                                res.status(201).json({
                                    success: true,
                                    message: "تم إنشاء حساب المطعم بنجاح",
                                    token: generateToken(restaurant.id),
                                    restaurant: restaurantData(restaurant)
                                });
                            }
                        );
                    }
                );
            } catch (error) {
                console.error(error);
                res.status(500).json({
                    success: false,
                    message: "حدث خطأ أثناء إنشاء حساب المطعم"
                });
            }
        }
    );
});

router.post("/login", async (req, res) => {
    const { phone_number, password } = req.body;

    if (!phone_number || !password) {
        return res.status(400).json({
            success: false,
            message: "رقم الهاتف وكلمة المرور مطلوبان"
        });
    }

    db.get(
        "SELECT * FROM restaurants WHERE phone_number = ? LIMIT 1",
        [String(phone_number).trim()],
        async (err, restaurant) => {
            if (err) {
                console.error(err);
                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            if (!restaurant || restaurant.account_status !== "active") {
                return res.status(401).json({
                    success: false,
                    message: "رقم الهاتف أو كلمة المرور غير صحيحة"
                });
            }

            try {
                if (!(await bcrypt.compare(password, restaurant.password))) {
                    return res.status(401).json({
                        success: false,
                        message: "رقم الهاتف أو كلمة المرور غير صحيحة"
                    });
                }

                const now = new Date().toISOString();

                db.run(
                    "UPDATE restaurants SET last_login = ?, updated_at = ? WHERE id = ?",
                    [now, now, restaurant.id],
                    updateErr => {
                        if (updateErr) {
                            console.error(updateErr);
                            return res.status(500).json({
                                success: false,
                                message: "حدث خطأ أثناء تسجيل الدخول"
                            });
                        }

                        restaurant.last_login = now;
                        restaurant.updated_at = now;

                        res.json({
                            success: true,
                            message: "تم تسجيل الدخول بنجاح",
                            token: generateToken(restaurant.id),
                            restaurant: restaurantData(restaurant, now)
                        });
                    }
                );
            } catch (error) {
                console.error(error);
                res.status(500).json({
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

        const restaurantId =
            decoded.restaurantId || decoded.userId || decoded.id;

        if (!restaurantId) {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح"
            });
        }

        db.get(
            "SELECT * FROM restaurants WHERE id = ? LIMIT 1",
            [restaurantId],
            (dbErr, restaurant) => {
                if (dbErr) {
                    console.error(dbErr);

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

                if (!restaurant) {
                    return res.status(404).json({
                        success: false,
                        message: "حساب المطعم غير موجود"
                    });
                }

                if (restaurant.account_status !== "active") {
                    return res.status(403).json({
                        success: false,
                        message: "هذا الحساب غير نشط"
                    });
                }

                const restaurantData = { ...restaurant };

                const jsonFields = [
                    "menu",
                    "opening_hours",
                    "delivery_zones",
                    "delivery_services",
                    "offers",
                    "gallery",
                    "social_links",
                    "tags",
                    "notifications",
                    "discount_codes",
                    "settings",
                    "orders",
                    "reviews",
                    "customers"
                ];

                for (const field of jsonFields) {
                    if (typeof restaurantData[field] === "string") {
                        try {
                            restaurantData[field] =
                                JSON.parse(restaurantData[field]);
                        } catch {
                            restaurantData[field] = restaurantData[field];
                        }
                    }
                }

                return res.json({
                    success: true,
                    message: "التوكين صالح",
                    restaurant: restaurantData
                });
            }
        );
    });
});

module.exports = router;