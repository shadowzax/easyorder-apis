
const express = require("express");
const bcrypt = require("bcrypt");

const router = express.Router();
const { db } = require("../../mydb/restaurants");

const DEFAULT_LOGO = "https://i.ibb.co/KjtHhwN4/logo-1.png";
const ADMIN_PASSWORD = "01063";

const JSON_FIELDS = [
    "opening_hours",
    "menu",
    "reviews",
    "customers",
    "delivery_zones",
    "delivery_services",
    "offers",
    "gallery",
    "social_links",
    "tags",
    "notifications",
    "discount_codes",
    "settings"
];

const BOOLEAN_FIELDS = [
    "phone_verified",
    "email_verified",
    "is_open",
    "is_accepting_orders",
    "delivery_available",
    "is_featured"
];

const NUMBER_FIELDS = [
    "latitude",
    "longitude",
    "balance",
    "points",
    "orders_count",
    "completed_orders",
    "cancelled_orders",
    "sales_commission",
    "delivery_commission",
    "rating",
    "ratings_count",
    "delivery_fee",
    "minimum_order",
    "maximum_order",
    "preparation_time_min",
    "preparation_time_max",
    "delivery_time_min",
    "delivery_time_max",
    "sort_order"
];

const STRING_FIELDS = [
    "owner_name",
    "restaurant_name_ar",
    "restaurant_name_en",
    "restaurant_name_ru",
    "email",
    "phone_number",
    "logo",
    "cover_image",
    "description_ar",
    "description_en",
    "description_ru",
    "category_ar",
    "category_en",
    "category_ru",
    "address_ar",
    "address_en",
    "address_ru",
    "account_type",
    "account_status",
    "language",
    "closed_reason"
];

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

const removeCityFields = value => {
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
};

const dbGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });

const dbAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows);
        });
    });

const dbRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);

            resolve({
                lastID: this.lastID,
                changes: this.changes
            });
        });
    });

const restaurantData = r => ({
    id: r.id,
    owner_name: r.owner_name,
    restaurant_name_ar: r.restaurant_name_ar,
    restaurant_name_en: r.restaurant_name_en,
    restaurant_name_ru: r.restaurant_name_ru,
    email: r.email,
    phone_number: r.phone_number,
    logo: r.logo || DEFAULT_LOGO,
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
    completed_orders: r.completed_orders,
    cancelled_orders: r.cancelled_orders,
    sales_commission: r.sales_commission,
    delivery_commission: r.delivery_commission,
    phone_verified: bool(r.phone_verified),
    email_verified: bool(r.email_verified),
    rating: r.rating,
    ratings_count: r.ratings_count,
    is_open: bool(r.is_open),
    is_accepting_orders: bool(r.is_accepting_orders),
    delivery_available: bool(r.delivery_available),
    closed_reason: r.closed_reason,
    delivery_fee: r.delivery_fee,
    minimum_order: r.minimum_order,
    maximum_order: r.maximum_order,
    preparation_time_min: r.preparation_time_min,
    preparation_time_max: r.preparation_time_max,
    delivery_time_min: r.delivery_time_min,
    delivery_time_max: r.delivery_time_max,
    is_featured: bool(r.is_featured),
    sort_order: r.sort_order,
    opening_hours: parse(r.opening_hours, {}),
    menu: parse(r.menu, []),
    reviews: parse(r.reviews, []),
    customers: parse(r.customers, []),
    delivery_zones: removeCityFields(parse(r.delivery_zones, [])),
    delivery_services: parse(r.delivery_services, []),
    offers: parse(r.offers, []),
    gallery: parse(r.gallery, []),
    social_links: parse(r.social_links, {}),
    tags: parse(r.tags, []),
    notifications: parse(r.notifications, []),
    discount_codes: parse(r.discount_codes, []),
    settings: parse(r.settings, {}),
    last_login: r.last_login,
    created_at: r.created_at,
    updated_at: r.updated_at
});

const checkAdminPassword = req => {
    return String(req.body?.admin_password || "") === ADMIN_PASSWORD;
};

router.post("/register", async (req, res) => {
    try {
        const body = req.body || {};

        const requiredFields = [
            "owner_name",
            "restaurant_name_ar",
            "restaurant_name_en",
            "restaurant_name_ru",
            "email",
            "phone_number",
            "password"
        ];

        for (const field of requiredFields) {
            if (
                body[field] === undefined ||
                body[field] === null ||
                !String(body[field]).trim()
            ) {
                return res.status(400).json({
                    success: false,
                    message: `الحقل ${field} مطلوب`
                });
            }
        }

        const email = String(body.email).trim().toLowerCase();
        const phone = String(body.phone_number).trim();
        const password = String(body.password);

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({
                success: false,
                message: "البريد الإلكتروني غير صحيح"
            });
        }

        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: "كلمة المرور يجب ألا تقل عن 8 أحرف"
            });
        }

        const existing = await dbGet(
            "SELECT id, email, phone_number FROM restaurants WHERE email = ? OR phone_number = ? LIMIT 1",
            [email, phone]
        );

        if (existing) {
            return res.status(409).json({
                success: false,
                message: existing.email?.toLowerCase() === email
                    ? "البريد الإلكتروني مستخدم بالفعل"
                    : "رقم الهاتف مستخدم بالفعل"
            });
        }

        const passwordHash = await bcrypt.hash(password, 12);
        const now = new Date().toISOString();

        const initial = {
            ...body,
            email,
            phone_number: phone,
            password: passwordHash,
            logo: body.logo || DEFAULT_LOGO,
            cover_image: body.cover_image || null,
            account_type: "restaurant",
            account_status: "active",
            language: body.language || "ar",
            balance: 0,
            points: 0,
            orders_count: 0,
            completed_orders: 0,
            cancelled_orders: 0,
            sales_commission: 12,
            delivery_commission: 10,
            phone_verified: 0,
            email_verified: 0,
            rating: 0,
            ratings_count: 0,
            is_open: body.is_open === undefined ? 1 : (bool(body.is_open) ? 1 : 0),
            is_accepting_orders: body.is_accepting_orders === undefined ? 1 : (bool(body.is_accepting_orders) ? 1 : 0),
            delivery_available: body.delivery_available === undefined ? 1 : (bool(body.delivery_available) ? 1 : 0),
            closed_reason: body.closed_reason || "",
            delivery_fee: body.delivery_fee ?? 0,
            minimum_order: body.minimum_order ?? 0,
            maximum_order: body.maximum_order ?? 0,
            preparation_time_min: body.preparation_time_min ?? 15,
            preparation_time_max: body.preparation_time_max ?? 30,
            delivery_time_min: body.delivery_time_min ?? 30,
            delivery_time_max: body.delivery_time_max ?? 70,
            is_featured: 0,
            sort_order: body.sort_order ?? 0,
            opening_hours: JSON.stringify(body.opening_hours ?? {}),
            menu: JSON.stringify(body.menu ?? []),
            reviews: "[]",
            customers: "[]",
            delivery_zones: JSON.stringify(removeCityFields(body.delivery_zones ?? [])),
            delivery_services: JSON.stringify(body.delivery_services ?? []),
            offers: JSON.stringify(body.offers ?? []),
            gallery: JSON.stringify(body.gallery ?? []),
            social_links: JSON.stringify(body.social_links ?? {}),
            tags: JSON.stringify(body.tags ?? []),
            notifications: JSON.stringify(body.notifications ?? []),
            discount_codes: JSON.stringify(body.discount_codes ?? []),
            settings: JSON.stringify(body.settings ?? {}),
            last_login: null,
            created_at: now,
            updated_at: now
        };

        const columns = [
            ...STRING_FIELDS,
            "password",
            ...NUMBER_FIELDS,
            ...BOOLEAN_FIELDS,
            ...JSON_FIELDS,
            "last_login",
            "created_at",
            "updated_at"
        ];

        const uniqueColumns = [...new Set(columns)];

        const values = uniqueColumns.map(column => {
            if (JSON_FIELDS.includes(column)) return initial[column];
            return initial[column] ?? null;
        });

        const result = await dbRun(
            `INSERT INTO restaurants (${uniqueColumns.map(c => `"${c}"`).join(", ")})
             VALUES (${uniqueColumns.map(() => "?").join(", ")})`,
            values
        );

        const restaurant = await dbGet(
            "SELECT * FROM restaurants WHERE id = ?",
            [result.lastID]
        );

        return res.status(201).json({
            success: true,
            message: "تم إنشاء حساب المطعم بنجاح",
            restaurant: restaurantData(restaurant)
        });

    } catch (error) {
        console.error("Restaurant registration error:", error.message);

        if (error.message.includes("UNIQUE")) {
            return res.status(409).json({
                success: false,
                message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
            });
        }

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إنشاء حساب المطعم"
        });
    }
});

router.get("/", async (req, res) => {
    try {
        const restaurants = await dbAll(
            "SELECT * FROM restaurants ORDER BY sort_order ASC, id DESC"
        );

        return res.json({
            success: true,
            count: restaurants.length,
            restaurants: restaurants.map(restaurantData)
        });

    } catch (error) {
        console.error("Get restaurants error:", error.message);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب المطاعم"
        });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const restaurant = await dbGet(
            "SELECT * FROM restaurants WHERE id = ?",
            [req.params.id]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        return res.json({
            success: true,
            restaurant: restaurantData(restaurant)
        });

    } catch (error) {
        console.error("Get restaurant error:", error.message);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب بيانات المطعم"
        });
    }
});

router.put("/:id", async (req, res) => {
    try {
        const restaurant = await dbGet(
            "SELECT * FROM restaurants WHERE id = ?",
            [req.params.id]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        const body = req.body || {};
        const updates = {};

        const allowed = [
            ...STRING_FIELDS.filter(field =>
                !["account_status"].includes(field)
            ),
            ...NUMBER_FIELDS,
            ...BOOLEAN_FIELDS.filter(field =>
                !["is_open", "is_accepting_orders", "is_featured"].includes(field)
            ),
            ...JSON_FIELDS
        ];

        for (const field of allowed) {
            if (!Object.prototype.hasOwnProperty.call(body, field)) {
                continue;
            }

            let value = body[field];

            if (JSON_FIELDS.includes(field)) {
                if (typeof value !== "object" || value === null) {
                    return res.status(400).json({
                        success: false,
                        message: `قيمة ${field} يجب أن تكون JSON صحيحة`
                    });
                }

                if (field === "delivery_zones") {
                    value = removeCityFields(value);
                }

                value = JSON.stringify(value);
            } else if (BOOLEAN_FIELDS.includes(field)) {
                value = bool(value) ? 1 : 0;
            } else if (NUMBER_FIELDS.includes(field)) {
                if (value !== null && !Number.isFinite(Number(value))) {
                    return res.status(400).json({
                        success: false,
                        message: `قيمة ${field} يجب أن تكون رقمية`
                    });
                }

                value = value === null ? null : Number(value);
            } else if (typeof value === "string") {
                value = value.trim();
            }

            updates[field] = value;
        }

        if (body.password !== undefined && String(body.password).length > 0) {
            if (String(body.password).length < 8) {
                return res.status(400).json({
                    success: false,
                    message: "كلمة المرور يجب ألا تقل عن 8 أحرف"
                });
            }

            updates.password = await bcrypt.hash(String(body.password), 12);
        }

        if (updates.email !== undefined) {
            updates.email = String(updates.email).toLowerCase();

            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
                return res.status(400).json({
                    success: false,
                    message: "البريد الإلكتروني غير صحيح"
                });
            }
        }

        if (updates.email !== undefined || updates.phone_number !== undefined) {
            const email = updates.email ?? restaurant.email;
            const phone = updates.phone_number ?? restaurant.phone_number;

            const duplicate = await dbGet(
                "SELECT id, email FROM restaurants WHERE (email = ? OR phone_number = ?) AND id != ? LIMIT 1",
                [email, phone, restaurant.id]
            );

            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: duplicate.email?.toLowerCase() === email
                        ? "البريد الإلكتروني مستخدم بالفعل"
                        : "رقم الهاتف مستخدم بالفعل"
                });
            }
        }

        if (
            updates.preparation_time_min !== undefined &&
            updates.preparation_time_max !== undefined &&
            updates.preparation_time_min > updates.preparation_time_max
        ) {
            return res.status(400).json({
                success: false,
                message: "الحد الأدنى لوقت التحضير أكبر من الحد الأقصى"
            });
        }

        if (
            updates.delivery_time_min !== undefined &&
            updates.delivery_time_max !== undefined &&
            updates.delivery_time_min > updates.delivery_time_max
        ) {
            return res.status(400).json({
                success: false,
                message: "الحد الأدنى لوقت التوصيل أكبر من الحد الأقصى"
            });
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({
                success: false,
                message: "لا توجد بيانات لتعديلها"
            });
        }

        updates.updated_at = new Date().toISOString();

        const fields = Object.keys(updates);

        await dbRun(
            `UPDATE restaurants SET ${fields.map(field => `"${field}" = ?`).join(", ")}
             WHERE id = ?`,
            [...fields.map(field => updates[field]), restaurant.id]
        );

        const updated = await dbGet(
            "SELECT * FROM restaurants WHERE id = ?",
            [restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم تعديل بيانات المطعم بنجاح",
            restaurant: restaurantData(updated)
        });

    } catch (error) {
        console.error("Update restaurant error:", error.message);

        if (error.message.includes("UNIQUE")) {
            return res.status(409).json({
                success: false,
                message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
            });
        }

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تعديل بيانات المطعم"
        });
    }
});

router.patch("/:id/status", async (req, res) => {
    try {
        if (!checkAdminPassword(req)) {
            return res.status(403).json({
                success: false,
                message: "كلمة مرور الإدارة غير صحيحة"
            });
        }

        const restaurant = await dbGet(
            "SELECT id FROM restaurants WHERE id = ?",
            [req.params.id]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        const allowed = [
            "account_status",
            "is_open",
            "is_accepting_orders",
            "delivery_available",
            "closed_reason"
        ];

        const updates = {};

        for (const field of allowed) {
            if (req.body?.[field] === undefined) continue;

            if (field === "account_status") {
                if (!["active", "inactive", "suspended"].includes(req.body[field])) {
                    return res.status(400).json({
                        success: false,
                        message: "حالة الحساب غير صحيحة"
                    });
                }

                updates[field] = req.body[field];
            } else if ([
                "is_open",
                "is_accepting_orders",
                "delivery_available"
            ].includes(field)) {
                updates[field] = bool(req.body[field]) ? 1 : 0;
            } else {
                updates[field] = String(req.body[field]).trim();
            }
        }

        if (!Object.keys(updates).length) {
            return res.status(400).json({
                success: false,
                message: "لم يتم إرسال أي إعدادات"
            });
        }

        updates.updated_at = new Date().toISOString();

        const fields = Object.keys(updates);

        await dbRun(
            `UPDATE restaurants SET ${fields.map(f => `"${f}" = ?`).join(", ")} WHERE id = ?`,
            [...fields.map(f => updates[f]), restaurant.id]
        );

        const updated = await dbGet(
            "SELECT * FROM restaurants WHERE id = ?",
            [restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم تحديث حالة المطعم بنجاح",
            restaurant: restaurantData(updated)
        });

    } catch (error) {
        console.error("Restaurant status error:", error.message);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تحديث حالة المطعم"
        });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        if (!checkAdminPassword(req)) {
            return res.status(403).json({
                success: false,
                message: "كلمة مرور الإدارة غير صحيحة"
            });
        }

        const restaurant = await dbGet(
            "SELECT id, restaurant_name_ar FROM restaurants WHERE id = ?",
            [req.params.id]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        await dbRun(
            "DELETE FROM restaurants WHERE id = ?",
            [restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم حذف حساب المطعم بنجاح",
            restaurant_id: restaurant.id
        });

    } catch (error) {
        console.error("Delete restaurant error:", error.message);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء حذف حساب المطعم"
        });
    }
});

module.exports = router;
