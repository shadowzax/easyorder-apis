const express = require("express");
const bcrypt = require("bcrypt");
const crypto = require("crypto");

const router = express.Router();
const { db } = require("../../mydb/delivery");

const DEFAULT_PROFILE_PICTURE = "https://i.ibb.co/HRbkkLw/3177440-1.jpg";

const SETTLEMENT_PASSWORD_HASHES = ["01025", "01063"].map(value =>
    crypto.createHash("sha256").update(value).digest()
);

const parse = (value, fallback = null) => {
    if (value === null || value === undefined || value === "") return fallback;
    if (typeof value === "object") return value;
    try { return JSON.parse(value); } catch { return fallback; }
};

const number = (value, fallback = 0) => {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
};

const bool = value => Number(value) === 1 || value === true;

const normalizeEmail = value => String(value || "").trim().toLowerCase();
const normalizePhone = value => String(value || "").trim();

const validAmount = value => {
    const amount = Number(value);
    return Number.isFinite(amount) && amount > 0;
};

const verifySettlementPassword = value => {
    const password = String(value || "");
    if (!password) return false;
    const candidate = crypto.createHash("sha256").update(password).digest();
    return SETTLEMENT_PASSWORD_HASHES.some(hash => crypto.timingSafeEqual(candidate, hash));
};

const dbGet = (sql, params = []) => new Promise((resolve, reject) => {
    db.get(sql, params, (error, row) => {
        if (error) return reject(error);
        resolve(row || null);
    });
});

const dbAll = (sql, params = []) => new Promise((resolve, reject) => {
    db.all(sql, params, (error, rows) => {
        if (error) return reject(error);
        resolve(rows || []);
    });
});

const dbRun = (sql, params = []) => new Promise((resolve, reject) => {
    db.run(sql, params, function (error) {
        if (error) return reject(error);
        resolve({ changes: this.changes, lastID: this.lastID });
    });
});

const dbTransaction = async callback => {
    await dbRun("BEGIN IMMEDIATE");
    try {
        const result = await callback();
        await dbRun("COMMIT");
        return result;
    } catch (error) {
        try { await dbRun("ROLLBACK"); } catch {}
        throw error;
    }
};

const createError = (message, statusCode = 400) => {
    const error = new Error(message);
    error.statusCode = statusCode;
    return error;
};

const getDelivery = async id => dbGet("SELECT * FROM delivery_accounts WHERE id = ?", [id]);

/* =====================================================================
 *  التحقق من أن التسوية "فعلية" — لازم يكون فيه مبلغ مسجل أو معرف تسوية
 *  وليس فقط flag boolean (لإصلاح مشكلة appSettled: true بدون مبلغ فعلي)
 * ===================================================================== */
const isActuallySettled = (settlement, party) => {
    if (!settlement || typeof settlement !== "object") return false;
    const flag = party === "app" ? settlement.appSettled : settlement.restaurantSettled;
    if (flag !== true) return false;

    const amountField = party === "app" ? "appSettledAmount" : "restaurantSettledAmount";
    const idField = party === "app" ? "appSettlementId" : "restaurantSettlementId";

    const recordedAmount = number(settlement[amountField]);
    const recordedId = settlement[idField];
    const hasId = recordedId !== undefined
        && recordedId !== null
        && String(recordedId).trim() !== "";

    return recordedAmount > 0 || hasId;
};

const calculateDueFromOrders = orders => {
    let dueApp = 0;
    let dueRest = 0;
    if (!Array.isArray(orders)) return { dueApp, dueRest };
    for (const order of orders) {
        if (!order || typeof order !== "object" || !order.settlement) continue;
        const s = order.settlement;
        if (!isActuallySettled(s, "app")) dueApp += number(s.deliveryCashToApp);
        if (!isActuallySettled(s, "restaurant")) dueRest += number(s.deliveryCashToRestaurant);
    }
    return { dueApp, dueRest };
};

const resolveDueAmounts = delivery => {
    if (!delivery) return { dueApp: 0, dueRest: 0 };
    const orders = parse(delivery.orders_history, []);
    if (Array.isArray(orders) && orders.length > 0) {
        return calculateDueFromOrders(orders);
    }
    const storedApp = number(delivery.total_amount_due_to_app);
    const storedRest = number(delivery.total_amount_due_to_restaurant);
    return {
        dueApp: storedApp > 0 ? storedApp : 0,
        dueRest: storedRest > 0 ? storedRest : 0
    };
};

/* =====================================================================
 *  تعليم الطلبات كمسوّاة بشكل فعلي (المبلغ + المعرف) داخل orders_history
 * ===================================================================== */
const markOrdersSettled = async (driver, scope, now, settlementIds = {}) => {
    if (scope !== "app" && scope !== "restaurant" && scope !== "all") return;
    const orders = parse(driver.orders_history, []);
    if (!Array.isArray(orders) || !orders.length) return;

    let changed = false;
    const updated = orders.map(order => {
        if (!order || typeof order !== "object" || !order.settlement) return order;
        const s = { ...order.settlement };
        let touched = false;

        if ((scope === "app" || scope === "all") && !isActuallySettled(s, "app")) {
            s.appSettled = true;
            s.appSettledAt = now;
            s.appSettledAmount = number(s.deliveryCashToApp);
            if (settlementIds.app) s.appSettlementId = settlementIds.app;
            touched = true;
        }

        if ((scope === "restaurant" || scope === "all") && !isActuallySettled(s, "restaurant")) {
            s.restaurantSettled = true;
            s.restaurantSettledAt = now;
            s.restaurantSettledAmount = number(s.deliveryCashToRestaurant);
            if (settlementIds.restaurant) s.restaurantSettlementId = settlementIds.restaurant;
            touched = true;
        }

        if (touched) { changed = true; return { ...order, settlement: s }; }
        return order;
    });

    if (changed) {
        await dbRun(
            "UPDATE delivery_accounts SET orders_history = ?, updated_at = ? WHERE id = ?",
            [JSON.stringify(updated), now, driver.id]
        );
    }
};

const deliveryData = delivery => {
    if (!delivery) return null;
    const due = resolveDueAmounts(delivery);
    return {
        id: delivery.id,
        name: delivery.name,
        email: delivery.email,
        phone_number: delivery.phone_number,
        profile_picture: delivery.profile_picture || DEFAULT_PROFILE_PICTURE,
        account_type: delivery.account_type,
        account_status: delivery.account_status,
        language: delivery.language,
        balance: number(delivery.balance),
        points: number(delivery.points),
        is_active: bool(delivery.is_active),
        orders_count: number(delivery.orders_count),
        completed_orders: number(delivery.completed_orders),
        cancelled_orders: number(delivery.cancelled_orders),
        total_earnings: number(delivery.total_earnings),
        total_earned_lifetime: number(delivery.total_earned_lifetime),
        total_withdrawn: number(delivery.total_withdrawn),
        pending_withdrawals: number(delivery.pending_withdrawals),
        total_order_value: number(delivery.total_order_value),
        total_items_subtotal: number(delivery.total_items_subtotal),
        total_discounts: number(delivery.total_discounts),
        total_vat: number(delivery.total_vat),
        total_processing_fees: number(delivery.total_processing_fees),
        total_delivery_fees: number(delivery.total_delivery_fees),
        total_commission: number(delivery.total_commission),
        total_app_commission: number(delivery.total_app_commission),
        total_restaurant_commission: number(delivery.total_restaurant_commission),
        total_restaurant_net: number(delivery.total_restaurant_net),
        total_app_net: number(delivery.total_app_net),
        total_delivery_net_earnings: number(delivery.total_delivery_net_earnings),
        total_amount_due_to_restaurant: due.dueRest,
        total_amount_due_to_app: due.dueApp,
        total_tips: number(delivery.total_tips),
        total_cash_collected: number(delivery.total_cash_collected),
        total_cash_to_restaurant: number(delivery.total_cash_to_restaurant),
        total_cash_to_app: number(delivery.total_cash_to_app),
        total_cash_to_delivery: number(delivery.total_cash_to_delivery),
        total_card_collected: number(delivery.total_card_collected),
        total_wallet_collected: number(delivery.total_wallet_collected),
        current_order_id: delivery.current_order_id,
        orders_history: parse(delivery.orders_history, []),
        last_login: delivery.last_login,
        created_at: delivery.created_at,
        updated_at: delivery.updated_at
    };
};

const addTransaction = async ({ deliveryId, transactionType, category, amount = 0, direction = "credit", description = "", balanceBefore = 0, balanceAfter = 0, metadata = {} }) => {
    const now = new Date().toISOString();
    return dbRun(
        `INSERT INTO delivery_transactions (
            id, delivery_id, order_id, withdrawal_id, transaction_type, category,
            amount, currency, direction, status, is_withdrawn, description, reference,
            balance_before, balance_after, metadata, created_at, updated_at, completed_at
        ) VALUES (?, ?, NULL, NULL, ?, ?, ?, 'EGP', ?, 'completed', 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [crypto.randomUUID(), deliveryId, transactionType, category, amount, direction, description, crypto.randomUUID(), balanceBefore, balanceAfter, JSON.stringify(metadata), now, now, now]
    );
};

/* =====================================================================
 *  إدراج سجل تسوية — تقبل settlementId صريحاً لتوحيد المراجع
 * ===================================================================== */
const insertSettlement = async ({ delivery, party, amount, appAmount, restaurantAmount, paymentMethod, description, reference, settlementId, now }) => {
    const columns = await dbAll("PRAGMA table_info(delivery_settlements)");
    if (!columns.length) throw new Error("جدول التسويات غير موجود في قاعدة البيانات");

    const finalSettlementId = settlementId || crypto.randomUUID();
    const finalReference = reference || finalSettlementId;

    const metadata = {
        settlement_type: party, delivery_id: delivery.id, driver_name: delivery.name,
        driver_phone: delivery.phone_number, amount, currency: "EGP",
        app_amount: appAmount, restaurant_amount: restaurantAmount,
        payment_method: paymentMethod, description, reference: finalReference,
        performed_at: now
    };

    const settlementRowId = crypto.randomUUID();

    const orderCol = columns.find(c => c.name.toLowerCase() === "order_id");
    const withdrawalCol = columns.find(c => c.name.toLowerCase() === "withdrawal_id");
    const orderRequired = Boolean(orderCol && orderCol.notnull);
    const withdrawalRequired = Boolean(withdrawalCol && withdrawalCol.notnull);

    const valuesMap = {
        id: settlementRowId,
        settlement_id: finalSettlementId,
        delivery_id: delivery.id,
        driver_id: delivery.id,
        driver_name: delivery.name,
        name: delivery.name,
        phone_number: delivery.phone_number,
        driver_phone: delivery.phone_number,
        order_id: orderRequired ? crypto.randomUUID() : null,
        withdrawal_id: withdrawalRequired ? crypto.randomUUID() : null,
        settlement_type: party,
        recipient_type: party,
        beneficiary_type: party,
        beneficiary: party,
        recipient: party,
        type: "cash_settlement",
        kind: "cash_settlement",
        category: "settlement",
        amount,
        total_amount: amount,
        settled_amount: amount,
        currency: "EGP",
        direction: "credit",
        status: "completed",
        is_withdrawn: 0,
        description,
        notes: description,
        reference: finalReference,
        payment_method: paymentMethod,
        app_amount: appAmount,
        amount_to_app: appAmount,
        amount_due_to_app: appAmount,
        total_amount_due_to_app: appAmount,
        restaurant_amount: restaurantAmount,
        amount_to_restaurant: restaurantAmount,
        amount_due_to_restaurant: restaurantAmount,
        total_amount_due_to_restaurant: restaurantAmount,
        balance_before: number(delivery.balance),
        balance_after: number(delivery.balance),
        metadata: JSON.stringify(metadata),
        details: JSON.stringify(metadata),
        created_at: now,
        requested_at: now,
        settled_at: now,
        completed_at: now,
        updated_at: now
    };

    const insertColumns = [];
    const insertValues = [];

    for (const column of columns) {
        const key = column.name.toLowerCase();
        if (Object.prototype.hasOwnProperty.call(valuesMap, key)) {
            const value = valuesMap[key];
            if (value === null && column.notnull && column.dflt_value === null) {
                insertValues.push(/INT|REAL|NUM|DEC|BOOL/i.test(column.type) ? 0 : crypto.randomUUID());
            } else {
                insertValues.push(value);
            }
            insertColumns.push(column.name);
            continue;
        }
        if (column.pk || !column.notnull || column.dflt_value !== null) continue;
        insertColumns.push(column.name);
        if (/INT|REAL|NUM|DEC|BOOL/i.test(column.type)) insertValues.push(0);
        else if (key.includes("status")) insertValues.push("completed");
        else if (key.includes("order") || key.includes("withdrawal")) insertValues.push(crypto.randomUUID());
        else insertValues.push("");
    }

    if (!insertColumns.length) throw new Error("تعذر تجهيز سجل التسوية");
    const placeholders = insertColumns.map(() => "?").join(", ");
    await dbRun(`INSERT INTO delivery_settlements (${insertColumns.join(", ")}) VALUES (${placeholders})`, insertValues);
    return { settlementRowId, settlementId: finalSettlementId, reference: finalReference };
};

/* =====================================================================
 *  تنفيذ التصفية — كل الخطوات داخل نفس المعاملة
 * ===================================================================== */
const performSettlement = async ({ deliveryId, scope, paymentMethod, description }) => {
    return dbTransaction(async () => {
        const driver = await getDelivery(deliveryId);
        if (!driver) throw createError("السائق غير موجود", 404);

        const resolved = resolveDueAmounts(driver);
        const appOutstanding = resolved.dueApp;
        const restaurantOutstanding = resolved.dueRest;

        if (appOutstanding < 0 || restaurantOutstanding < 0) {
            throw createError("يوجد خطأ في قيمة المستحقات المسجلة، يرجى مراجعة الحساب", 400);
        }

        let appAmount = 0;
        let restaurantAmount = 0;
        if (scope === "app") appAmount = appOutstanding;
        if (scope === "restaurant") restaurantAmount = restaurantOutstanding;
        if (scope === "all") { appAmount = appOutstanding; restaurantAmount = restaurantOutstanding; }

        const totalAmount = appAmount + restaurantAmount;
        if (totalAmount <= 0) throw createError("لا توجد مستحقات مالية معلقة لإتمام عملية التصفية", 400);

        const now = new Date().toISOString();
        const reference = crypto.randomUUID();
        const settlements = [];
        const settlementIds = {};

        /* 1) إنشاء سجلات التسوية أولاً للحصول على المعرفات */
        if (appAmount > 0) {
            const settlementId = crypto.randomUUID();
            settlementIds.app = settlementId;
            await insertSettlement({
                delivery: driver, party: "app", amount: appAmount, appAmount, restaurantAmount: 0,
                paymentMethod, description: description || "تصفية مستحقات التطبيق من السائق",
                reference: settlementId, settlementId, now
            });
            await addTransaction({
                deliveryId: driver.id, transactionType: "cash_settlement", category: "app_settlement",
                amount: appAmount, direction: "debit",
                description: description || "تصفية مستحقات التطبيق",
                balanceBefore: number(driver.balance), balanceAfter: number(driver.balance),
                metadata: {
                    settlement_id: settlementId, reference, settlement_type: "app",
                    payment_method: paymentMethod, amount: appAmount, currency: "EGP",
                    status: "completed", previous_amount_due_to_app: appOutstanding,
                    remaining_amount_due_to_app: 0, performed_at: now
                }
            });
            settlements.push({ settlement_id: settlementId, type: "app", amount: appAmount, currency: "EGP", status: "completed" });
        }

        if (restaurantAmount > 0) {
            const settlementId = crypto.randomUUID();
            settlementIds.restaurant = settlementId;
            await insertSettlement({
                delivery: driver, party: "restaurant", amount: restaurantAmount, appAmount: 0, restaurantAmount,
                paymentMethod, description: description || "تصفية مستحقات المطعم من السائق",
                reference: settlementId, settlementId, now
            });
            await addTransaction({
                deliveryId: driver.id, transactionType: "cash_settlement", category: "restaurant_settlement",
                amount: restaurantAmount, direction: "debit",
                description: description || "تصفية مستحقات المطعم",
                balanceBefore: number(driver.balance), balanceAfter: number(driver.balance),
                metadata: {
                    settlement_id: settlementId, reference, settlement_type: "restaurant",
                    payment_method: paymentMethod, amount: restaurantAmount, currency: "EGP",
                    status: "completed", previous_amount_due_to_restaurant: restaurantOutstanding,
                    remaining_amount_due_to_restaurant: 0, performed_at: now
                }
            });
            settlements.push({ settlement_id: settlementId, type: "restaurant", amount: restaurantAmount, currency: "EGP", status: "completed" });
        }

        /* 2) تعليم الطلبات كمسوّاة فعلياً (مع تسجيل المبلغ والمعرف) */
        await markOrdersSettled(driver, scope, now, settlementIds);

        /* 3) تصفير المستحقات في delivery_accounts داخل نفس المعاملة */
        const updates = [];
        const params = [];
        if (scope === "app" || scope === "all") updates.push("total_amount_due_to_app = 0");
        if (scope === "restaurant" || scope === "all") updates.push("total_amount_due_to_restaurant = 0");
        updates.push("updated_at = ?"); params.push(now);
        params.push(driver.id);

        const updateResult = await dbRun(
            `UPDATE delivery_accounts SET ${updates.join(", ")} WHERE id = ?`,
            params
        );
        if (updateResult.changes !== 1) throw createError("تعذر تحديث مستحقات السائق", 409);

        const updatedDriver = await getDelivery(driver.id);
        return {
            driver: deliveryData(updatedDriver),
            settlement: {
                reference, scope, payment_method: paymentMethod,
                total_amount: totalAmount, app_amount: appAmount, restaurant_amount: restaurantAmount,
                currency: "EGP", status: "completed", created_at: now, settlements
            }
        };
    });
};

const settlementHandler = async (req, res, forcedScope = null) => {
    try {
        const password = req.body?.password;
        if (!verifySettlementPassword(password)) {
            return res.status(401).json({ success: false, message: "كلمة مرور التصفية غير صحيحة" });
        }
        const scope = forcedScope || String(req.body?.scope || "all").trim();
        if (!["app", "restaurant", "all"].includes(scope)) {
            return res.status(400).json({ success: false, message: "نوع التصفية غير صحيح، استخدم app أو restaurant أو all" });
        }
        const paymentMethod = String(req.body?.payment_method || "cash").trim().slice(0, 50);
        const description = String(req.body?.description || "").trim().slice(0, 500);
        const result = await performSettlement({ deliveryId: req.params.id, scope, paymentMethod, description });
        res.json({ success: true, message: "تمت تصفية المستحقات وتسجيل العملية بنجاح", settlement: result.settlement, driver: result.driver });
    } catch (error) {
        res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "حدث خطأ أثناء تصفية المستحقات",
            error: error.statusCode ? undefined : error.message
        });
    }
};

router.post("/register", async (req, res) => {
    try {
        const { name, email, phone_number, password, profile_picture, language } = req.body;
        if (!name || !phone_number || !password) {
            return res.status(400).json({ success: false, message: "الاسم ورقم الهاتف وكلمة المرور مطلوبة" });
        }
        if (String(password).length < 6) {
            return res.status(400).json({ success: false, message: "كلمة المرور يجب ألا تقل عن 6 أحرف" });
        }
        const normalizedEmail = normalizeEmail(email);
        const normalizedPhone = normalizePhone(phone_number);
        const existing = await dbGet(
            `SELECT id FROM delivery_accounts WHERE phone_number = ? OR (? != '' AND email = ?) LIMIT 1`,
            [normalizedPhone, normalizedEmail, normalizedEmail]
        );
        if (existing) {
            return res.status(409).json({ success: false, message: "رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل" });
        }
        const id = crypto.randomUUID();
        const hashedPassword = await bcrypt.hash(String(password), 12);
        const now = new Date().toISOString();
        await dbRun(
            `INSERT INTO delivery_accounts (
                id, name, email, phone_number, profile_picture, password, account_type,
                account_status, language, balance, points, is_active, orders_count,
                completed_orders, cancelled_orders, total_earnings, total_earned_lifetime,
                total_withdrawn, pending_withdrawals, orders_history, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'delivery', 'active', ?, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, '[]', ?, ?)`,
            [id, String(name).trim(), normalizedEmail || null, normalizedPhone, profile_picture || DEFAULT_PROFILE_PICTURE, hashedPassword, language || "ar", now, now]
        );
        const driver = await getDelivery(id);
        res.status(201).json({ success: true, message: "تم إنشاء حساب السائق بنجاح", driver: deliveryData(driver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء إنشاء حساب السائق", error: error.message });
    }
});

router.post("/login", async (req, res) => {
    try {
        const phone = normalizePhone(req.body.phone_number);
        const password = String(req.body.password || "");
        if (!phone || !password) {
            return res.status(400).json({ success: false, message: "رقم الهاتف وكلمة المرور مطلوبان" });
        }
        const driver = await dbGet("SELECT * FROM delivery_accounts WHERE phone_number = ?", [phone]);
        if (!driver) {
            return res.status(401).json({ success: false, message: "رقم الهاتف أو كلمة المرور غير صحيحة" });
        }
        const validPassword = await bcrypt.compare(password, driver.password);
        if (!validPassword) {
            return res.status(401).json({ success: false, message: "رقم الهاتف أو كلمة المرور غير صحيحة" });
        }
        if (driver.account_status !== "active") {
            return res.status(403).json({ success: false, message: "حساب السائق غير مفعل" });
        }
        const now = new Date().toISOString();
        await dbRun("UPDATE delivery_accounts SET last_login = ?, updated_at = ? WHERE id = ?", [now, now, driver.id]);
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم تسجيل الدخول بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تسجيل الدخول", error: error.message });
    }
});

router.get("/all", async (req, res) => {
    try {
        const drivers = await dbAll("SELECT * FROM delivery_accounts ORDER BY created_at DESC");
        res.json({ success: true, count: drivers.length, drivers: drivers.map(deliveryData) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب السائقين", error: error.message });
    }
});

router.get("/statistics", async (req, res) => {
    try {
        const statistics = await dbGet(`
            SELECT
                COUNT(*) AS total_drivers,
                SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active_drivers,
                SUM(CASE WHEN is_active = 0 THEN 1 ELSE 0 END) AS inactive_drivers,
                SUM(CASE WHEN account_status = 'active' THEN 1 ELSE 0 END) AS approved_drivers,
                SUM(CASE WHEN account_status != 'active' THEN 1 ELSE 0 END) AS unapproved_drivers,
                COALESCE(SUM(balance), 0) AS total_balance,
                COALESCE(SUM(points), 0) AS total_points,
                COALESCE(SUM(orders_count), 0) AS total_orders,
                COALESCE(SUM(completed_orders), 0) AS completed_orders,
                COALESCE(SUM(cancelled_orders), 0) AS cancelled_orders,
                COALESCE(SUM(total_earnings), 0) AS total_earnings,
                COALESCE(SUM(total_earned_lifetime), 0) AS total_earned_lifetime,
                COALESCE(SUM(total_withdrawn), 0) AS total_withdrawn,
                COALESCE(SUM(pending_withdrawals), 0) AS pending_withdrawals,
                COALESCE(SUM(total_delivery_fees), 0) AS total_delivery_fees,
                COALESCE(SUM(total_tips), 0) AS total_tips,
                COALESCE(SUM(total_cash_collected), 0) AS total_cash_collected
            FROM delivery_accounts
        `);
        const withdrawals = await dbGet(`
            SELECT
                COUNT(*) AS total_withdrawals,
                COALESCE(SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END), 0) AS pending_amount,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN amount ELSE 0 END), 0) AS completed_amount
            FROM delivery_withdrawals
        `);
        const dueRows = await dbAll("SELECT total_amount_due_to_app, total_amount_due_to_restaurant, orders_history FROM delivery_accounts");
        let totalDueApp = 0;
        let totalDueRest = 0;
        for (const row of dueRows) {
            const due = resolveDueAmounts(row);
            totalDueApp += due.dueApp;
            totalDueRest += due.dueRest;
        }
        res.json({
            success: true,
            statistics: {
                ...statistics,
                ...withdrawals,
                total_amount_due_to_app: totalDueApp,
                total_amount_due_to_restaurant: totalDueRest
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب الإحصائيات", error: error.message });
    }
});

router.get("/counts", async (req, res) => {
    try {
        const drivers = await dbAll("SELECT id, account_status, is_active, current_order_id FROM delivery_accounts");
        const counts = { all: 0, active: 0, pending: 0, busy: 0, suspended: 0, offline: 0 };
        for (const d of drivers) {
            counts.all++;
            const status = String(d.account_status || "").toLowerCase();
            const isActive = bool(d.is_active);
            const isBusy = d.current_order_id != null && d.current_order_id !== "";
            if (status === "suspended") counts.suspended++;
            else if (status === "pending") counts.pending++;
            else if (isActive) { if (isBusy) counts.busy++; else counts.active++; }
            else counts.offline++;
        }
        res.json({ success: true, ...counts });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب الإحصائيات", error: error.message });
    }
});

router.get("/", async (req, res) => {
    try {
        const limit = req.query.limit ? Number(req.query.limit) : null;
        const offset = req.query.offset ? Number(req.query.offset) : null;
        const status = String(req.query.status || "all").toLowerCase();
        const search = String(req.query.search || "").trim();

        const where = [];
        const params = [];

        if (status === "active") {
            where.push("account_status = 'active' AND is_active = 1 AND (current_order_id IS NULL OR current_order_id = '')");
        } else if (status === "pending") {
            where.push("account_status = 'pending'");
        } else if (status === "busy") {
            where.push("is_active = 1 AND current_order_id IS NOT NULL AND current_order_id != ''");
        } else if (status === "suspended") {
            where.push("account_status = 'suspended'");
        } else if (status === "offline") {
            where.push("account_status = 'active' AND is_active = 0");
        }

        if (search) {
            where.push("(name LIKE ? OR phone_number LIKE ? OR email LIKE ?)");
            const term = "%" + search + "%";
            params.push(term, term, term);
        }

        let sql = "SELECT * FROM delivery_accounts";
        if (where.length) sql += " WHERE " + where.join(" AND ");
        sql += " ORDER BY created_at DESC";

        if (limit && Number.isInteger(limit) && limit > 0) {
            sql += " LIMIT ?";
            params.push(limit);
            if (offset && Number.isInteger(offset) && offset >= 0) {
                sql += " OFFSET ?";
                params.push(offset);
            }
        }

        const drivers = await dbAll(sql, params);
        res.json({ success: true, count: drivers.length, drivers: drivers.map(deliveryData) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب السائقين", error: error.message });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        res.json({ success: true, driver: deliveryData(driver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب بيانات السائق", error: error.message });
    }
});

router.patch("/:id", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }

        const allowedFields = ["name", "email", "phone_number", "profile_picture", "language", "account_status", "is_active"];
        const updates = [];
        const values = [];

        for (const field of allowedFields) {
            if (req.body[field] === undefined) continue;
            let value = req.body[field];
            if (field === "email") value = normalizeEmail(value) || null;
            if (field === "phone_number") value = normalizePhone(value);
            if (field === "is_active") value = value === true || value === 1 || value === "1" ? 1 : 0;
            if (field === "account_status") {
                const allowedStatuses = ["active", "inactive", "pending", "suspended"];
                if (!allowedStatuses.includes(value)) {
                    return res.status(400).json({ success: false, message: "حالة الحساب غير صحيحة" });
                }
            }
            updates.push(`${field} = ?`);
            values.push(value);
        }

        if (req.body.password !== undefined) {
            const password = String(req.body.password);
            if (password.length < 6) {
                return res.status(400).json({ success: false, message: "كلمة المرور يجب ألا تقل عن 6 أحرف" });
            }
            updates.push("password = ?");
            values.push(await bcrypt.hash(password, 12));
        }

        if (updates.length === 0) {
            return res.status(400).json({ success: false, message: "لا توجد بيانات لتحديثها" });
        }

        if (req.body.email !== undefined || req.body.phone_number !== undefined) {
            const email = req.body.email !== undefined ? normalizeEmail(req.body.email) : normalizeEmail(driver.email);
            const phone = req.body.phone_number !== undefined ? normalizePhone(req.body.phone_number) : normalizePhone(driver.phone_number);
            const duplicate = await dbGet(
                `SELECT id FROM delivery_accounts WHERE id != ? AND (phone_number = ? OR (? != '' AND email = ?)) LIMIT 1`,
                [driver.id, phone, email, email]
            );
            if (duplicate) {
                return res.status(409).json({ success: false, message: "رقم الهاتف أو البريد الإلكتروني مستخدم بالفعل" });
            }
        }

        updates.push("updated_at = ?");
        values.push(new Date().toISOString());
        values.push(driver.id);

        await dbRun(`UPDATE delivery_accounts SET ${updates.join(", ")} WHERE id = ?`, values);
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم تحديث بيانات السائق بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تحديث بيانات السائق", error: error.message });
    }
});

router.post("/:id/status", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }

        const status = String(req.body.status || "").toLowerCase();
        if (!["active", "pending", "suspended", "offline", "busy"].includes(status)) {
            return res.status(400).json({ success: false, message: "حالة السائق غير صحيحة" });
        }

        const updates = [];
        const values = [];

        if (status === "active" || status === "busy") {
            updates.push("account_status = ?"); values.push("active");
            updates.push("is_active = ?"); values.push(1);
        } else if (status === "pending") {
            updates.push("account_status = ?"); values.push("pending");
            updates.push("is_active = ?"); values.push(0);
        } else if (status === "suspended") {
            updates.push("account_status = ?"); values.push("suspended");
            updates.push("is_active = ?"); values.push(0);
        } else if (status === "offline") {
            updates.push("is_active = ?"); values.push(0);
        }

        updates.push("updated_at = ?");
        values.push(new Date().toISOString());
        values.push(driver.id);

        await dbRun(`UPDATE delivery_accounts SET ${updates.join(", ")} WHERE id = ?`, values);
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم تحديث حالة السائق بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تحديث حالة السائق", error: error.message });
    }
});

router.patch("/:id/toggle-active", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const isActive = req.body.is_active === undefined
            ? (bool(driver.is_active) ? 0 : 1)
            : (req.body.is_active === true || req.body.is_active === 1 || req.body.is_active === "1" ? 1 : 0);
        await dbRun("UPDATE delivery_accounts SET is_active = ?, updated_at = ? WHERE id = ?", [isActive, new Date().toISOString(), driver.id]);
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: isActive ? "تم تفعيل السائق" : "تم إيقاف السائق", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تغيير حالة السائق", error: error.message });
    }
});

router.post("/:id/balance", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const amount = Number(req.body.amount);
        const action = req.body.action || "add";
        if (!validAmount(amount)) {
            return res.status(400).json({ success: false, message: "المبلغ غير صحيح" });
        }
        if (!["add", "subtract"].includes(action)) {
            return res.status(400).json({ success: false, message: "نوع العملية غير صحيح" });
        }
        const balanceBefore = number(driver.balance);
        const balanceAfter = action === "add" ? balanceBefore + amount : balanceBefore - amount;
        if (balanceAfter < 0) {
            return res.status(400).json({ success: false, message: "الرصيد غير كافٍ لإتمام العملية" });
        }
        const result = await dbRun(
            `UPDATE delivery_accounts SET balance = ?, updated_at = ? WHERE id = ? AND balance = ?`,
            [balanceAfter, new Date().toISOString(), driver.id, balanceBefore]
        );
        if (result.changes !== 1) {
            return res.status(409).json({ success: false, message: "تم تعديل الرصيد بواسطة عملية أخرى، حاول مرة أخرى" });
        }
        try {
            await addTransaction({ deliveryId: driver.id, transactionType: action === "add" ? "admin_credit" : "admin_debit", category: "admin_adjustment", amount, direction: action === "add" ? "credit" : "debit", description: req.body.description || "تعديل رصيد السائق بواسطة الإدارة", balanceBefore, balanceAfter, metadata: { action, source: "admin" } });
        } catch (error) {
            await dbRun("UPDATE delivery_accounts SET balance = ?, updated_at = ? WHERE id = ?", [balanceBefore, new Date().toISOString(), driver.id]);
            throw error;
        }
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم تحديث رصيد السائق بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تعديل الرصيد", error: error.message });
    }
});

router.post("/:id/points", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const points = Number(req.body.points);
        const action = req.body.action || "add";
        if (!Number.isInteger(points) || points <= 0) {
            return res.status(400).json({ success: false, message: "عدد النقاط غير صحيح" });
        }
        if (!["add", "subtract"].includes(action)) {
            return res.status(400).json({ success: false, message: "نوع العملية غير صحيح" });
        }
        const currentPoints = number(driver.points);
        const newPoints = action === "add" ? currentPoints + points : currentPoints - points;
        if (newPoints < 0) {
            return res.status(400).json({ success: false, message: "عدد النقاط غير كافٍ" });
        }
        const result = await dbRun(
            `UPDATE delivery_accounts SET points = ?, updated_at = ? WHERE id = ? AND points = ?`,
            [newPoints, new Date().toISOString(), driver.id, currentPoints]
        );
        if (result.changes !== 1) {
            return res.status(409).json({ success: false, message: "تم تعديل النقاط بواسطة عملية أخرى، حاول مرة أخرى" });
        }
        try {
            await addTransaction({ deliveryId: driver.id, transactionType: action === "add" ? "points_credit" : "points_debit", category: "points_adjustment", amount: 0, direction: action === "add" ? "credit" : "debit", description: req.body.description || "تعديل نقاط السائق بواسطة الإدارة", balanceBefore: number(driver.balance), balanceAfter: number(driver.balance), metadata: { action, points, points_before: currentPoints, points_after: newPoints, source: "admin" } });
        } catch (error) {
            await dbRun("UPDATE delivery_accounts SET points = ?, updated_at = ? WHERE id = ?", [currentPoints, new Date().toISOString(), driver.id]);
            throw error;
        }
        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم تحديث نقاط السائق بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء تعديل النقاط", error: error.message });
    }
});

router.post("/:id/gifts", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const giftType = req.body.gift_type;
        const description = req.body.description || "هدية من إدارة التطبيق";
        if (!["balance", "points"].includes(giftType)) {
            return res.status(400).json({ success: false, message: "نوع الهدية غير صحيح" });
        }
        const now = new Date().toISOString();

        if (giftType === "balance") {
            const amount = Number(req.body.amount);
            if (!validAmount(amount)) {
                return res.status(400).json({ success: false, message: "قيمة الهدية غير صحيحة" });
            }
            const balanceBefore = number(driver.balance);
            const balanceAfter = balanceBefore + amount;
            const result = await dbRun(`UPDATE delivery_accounts SET balance = ?, updated_at = ? WHERE id = ? AND balance = ?`, [balanceAfter, now, driver.id, balanceBefore]);
            if (result.changes !== 1) {
                return res.status(409).json({ success: false, message: "تعذر تحديث الرصيد، حاول مرة أخرى" });
            }
            try {
                await addTransaction({ deliveryId: driver.id, transactionType: "gift", category: "gift", amount, direction: "credit", description, balanceBefore, balanceAfter, metadata: { gift_type: "balance", source: "admin" } });
            } catch (error) {
                await dbRun("UPDATE delivery_accounts SET balance = ?, updated_at = ? WHERE id = ?", [balanceBefore, new Date().toISOString(), driver.id]);
                throw error;
            }
        }

        if (giftType === "points") {
            const points = Number(req.body.points);
            if (!Number.isInteger(points) || points <= 0) {
                return res.status(400).json({ success: false, message: "عدد نقاط الهدية غير صحيح" });
            }
            const pointsBefore = number(driver.points);
            const pointsAfter = pointsBefore + points;
            const result = await dbRun(`UPDATE delivery_accounts SET points = ?, updated_at = ? WHERE id = ? AND points = ?`, [pointsAfter, now, driver.id, pointsBefore]);
            if (result.changes !== 1) {
                return res.status(409).json({ success: false, message: "تعذر تحديث النقاط، حاول مرة أخرى" });
            }
            try {
                await addTransaction({ deliveryId: driver.id, transactionType: "gift", category: "gift", amount: 0, direction: "credit", description, balanceBefore: number(driver.balance), balanceAfter: number(driver.balance), metadata: { gift_type: "points", points, points_before: pointsBefore, points_after: pointsAfter, source: "admin" } });
            } catch (error) {
                await dbRun("UPDATE delivery_accounts SET points = ?, updated_at = ? WHERE id = ?", [pointsBefore, new Date().toISOString(), driver.id]);
                throw error;
            }
        }

        const updatedDriver = await getDelivery(driver.id);
        res.json({ success: true, message: "تم إرسال الهدية للسائق بنجاح", driver: deliveryData(updatedDriver) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء إرسال الهدية", error: error.message });
    }
});

router.post("/:id/settlements/clear", async (req, res) => settlementHandler(req, res));
router.post("/:id/settlements/clear-all", async (req, res) => settlementHandler(req, res, "all"));

router.get("/:id/transactions", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const transactions = await dbAll(`SELECT * FROM delivery_transactions WHERE delivery_id = ? ORDER BY created_at DESC`, [driver.id]);
        res.json({ success: true, count: transactions.length, transactions: transactions.map(t => ({ ...t, metadata: parse(t.metadata, {}) })) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب المعاملات", error: error.message });
    }
});

router.get("/:id/withdrawals", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const withdrawals = await dbAll(`SELECT * FROM delivery_withdrawals WHERE delivery_id = ? ORDER BY requested_at DESC`, [driver.id]);
        res.json({ success: true, count: withdrawals.length, withdrawals: withdrawals.map(w => ({ ...w, payment_details: parse(w.payment_details, {}) })) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب طلبات السحب", error: error.message });
    }
});

router.get("/:id/settlements", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        const settlements = await dbAll(`SELECT * FROM delivery_settlements WHERE delivery_id = ? ORDER BY created_at DESC`, [driver.id]);
        res.json({ success: true, count: settlements.length, settlements: settlements.map(s => ({ ...s, metadata: parse(s.metadata, {}), details: parse(s.details, {}) })) });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء جلب التسويات", error: error.message });
    }
});

router.delete("/:id", async (req, res) => {
    try {
        const driver = await getDelivery(req.params.id);
        if (!driver) {
            return res.status(404).json({ success: false, message: "السائق غير موجود" });
        }
        await dbRun("DELETE FROM delivery_transactions WHERE delivery_id = ?", [driver.id]);
        await dbRun("DELETE FROM delivery_withdrawals WHERE delivery_id = ?", [driver.id]);
        await dbRun("DELETE FROM delivery_settlements WHERE delivery_id = ?", [driver.id]);
        await dbRun("DELETE FROM delivery_accounts WHERE id = ?", [driver.id]);
        res.json({ success: true, message: "تم حذف السائق بنجاح" });
    } catch (error) {
        res.status(500).json({ success: false, message: "حدث خطأ أثناء حذف السائق", error: error.message });
    }
});

module.exports = router;