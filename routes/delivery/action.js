
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

const router = express.Router();

const { db } = require("../../mydb/delivery");
const { db: restaurantsDb } = require("../../mydb/restaurants");

const JWT_SECRET = "secretkey";

function dbGet(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function dbAll(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function dbRun(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) {
            if (err) return reject(err);

            resolve({
                changes: this.changes,
                lastID: this.lastID
            });
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

function parseObject(value) {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        return value;
    }

    try {
        const parsed = JSON.parse(value || "{}");

        return parsed &&
            typeof parsed === "object" &&
            !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
}

function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function money(value) {
    const number = Number(value);

    return Number.isFinite(number)
        ? Math.round((number + Number.EPSILON) * 100) / 100
        : 0;
}

function firstValue(...values) {
    return values.find(value =>
        value !== undefined &&
        value !== null &&
        value !== ""
    );
}

function getToken(req) {
    const authorization = req.headers.authorization || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);

    return String(
        (bearer && bearer[1]) ||
        req.body?.token ||
        req.query?.token ||
        ""
    ).trim();
}

function createError(message, status = 400) {
    const error = new Error(message);
    error.status = status;
    return error;
}

function quoteIdentifier(value) {
    return `"${String(value).replace(/"/g, '""')}"`;
}

async function getTableColumns(database, tableName) {
    return dbAll(
        database,
        `PRAGMA table_info(${quoteIdentifier(tableName)})`
    );
}

async function tableExists(database, tableName) {
    const row = await dbGet(
        database,
        `SELECT name
         FROM sqlite_master
         WHERE type = 'table'
           AND name = ?
         LIMIT 1`,
        [tableName]
    );

    return !!row;
}

function isPreparationTimeExpired(order, now = new Date()) {
    const preparation = parseObject(order.preparation);

    const estimatedReadyAt =
        order.estimatedReadyAt ??
        order.estimated_ready_at ??
        order.preparationEndsAt ??
        order.preparationEndTime ??
        preparation.estimatedReadyAt ??
        preparation.readyAt ??
        preparation.endsAt;

    if (estimatedReadyAt) {
        const readyTime = new Date(estimatedReadyAt).getTime();

        if (Number.isFinite(readyTime)) {
            return now.getTime() >= readyTime;
        }
    }

    const preparationStartedAt =
        order.preparationStartedAt ??
        order.preparation_started_at ??
        order.preparingAt ??
        order.preparationStartTime ??
        preparation.startedAt ??
        preparation.startTime;

    const preparationTimeMinutes = Number(
        order.preparationTimeMinutes ??
        order.preparation_time_minutes ??
        order.preparationDuration ??
        order.preparation_time ??
        preparation.durationMinutes ??
        preparation.timeMinutes ??
        preparation.duration
    );

    if (
        !preparationStartedAt ||
        !Number.isFinite(preparationTimeMinutes) ||
        preparationTimeMinutes < 0
    ) {
        return false;
    }

    const startedTime = new Date(preparationStartedAt).getTime();

    if (!Number.isFinite(startedTime)) {
        return false;
    }

    const readyTime =
        startedTime + preparationTimeMinutes * 60 * 1000;

    return now.getTime() >= readyTime;
}

async function verifyDelivery(token) {
    let decoded;

    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        throw createError(
            "توكن الدليفري غير صالح أو منتهي الصلاحية",
            401
        );
    }

    const deliveryId =
        decoded.deliveryId ??
        decoded.userId ??
        decoded.id;

    if (deliveryId == null || String(deliveryId).trim() === "") {
        throw createError(
            "التوكن لا يحتوي على معرف الدليفري",
            401
        );
    }

    const delivery = await dbGet(
        db,
        `SELECT *
         FROM delivery_accounts
         WHERE id = ?
           AND LOWER(TRIM(account_type)) = 'delivery'
         LIMIT 1`,
        [String(deliveryId)]
    );

    if (!delivery) {
        throw createError("حساب الدليفري غير موجود", 404);
    }

    return delivery;
}

function findOrderIndex(history, orderId) {
    return history.findIndex(item =>
        String(item.orderId ?? item.id ?? "") === String(orderId)
    );
}

const transitions = {
    ready_for_delivery: ["picked_up"],
    preparing: ["picked_up"],
    picked_up: ["on_the_way"],
    on_the_way: ["delivered", "customer_refused"]
};

const timestampFields = {
    picked_up: "pickedUpAt",
    on_the_way: "onTheWayAt",
    delivered: "deliveredAt",
    customer_refused: "customerRefusedAt"
};

const messages = {
    picked_up: "تم تأكيد استلام الطلب من المطعم",
    on_the_way: "تم تأكيد خروج المندوب لتوصيل الطلب",
    delivered: "تم تأكيد تسليم الطلب وتحديث بيانات المطعم والدليفري",
    customer_refused: "تم تسجيل رفض العميل استلام الطلب"
};

async function getRestaurantOrdersColumn() {
    const columns = await getTableColumns(
        restaurantsDb,
        "restaurants"
    );

    return [
        "orders",
        "orders_history",
        "orders_json"
    ].find(name => columns.some(column => column.name === name)) || null;
}

async function getRestaurantOrder(order) {
    const restaurantId = String(
        order.restaurantId ??
        order.restaurant?.restaurantId ??
        ""
    ).trim();

    if (!restaurantId) {
        throw createError("معرف المطعم غير موجود في الطلب", 400);
    }

    const ordersColumn = await getRestaurantOrdersColumn();

    if (!ordersColumn) {
        throw createError(
            "لم يتم العثور على عمود سجل الطلبات في جدول المطاعم",
            500
        );
    }

    const restaurant = await dbGet(
        restaurantsDb,
        `SELECT id, ${quoteIdentifier(ordersColumn)} AS restaurant_orders
         FROM restaurants
         WHERE id = ?
         LIMIT 1`,
        [restaurantId]
    );

    if (!restaurant) {
        throw createError("المطعم غير موجود في قاعدة البيانات", 404);
    }

    const restaurantOrders = parseArray(restaurant.restaurant_orders);
    const orderId = String(order.orderId ?? order.id ?? "");

    const restaurantOrderIndex = findOrderIndex(
        restaurantOrders,
        orderId
    );

    if (restaurantOrderIndex === -1) {
        throw createError(
            "الطلب غير موجود في سجل طلبات المطعم",
            404
        );
    }

    return {
        restaurantId,
        ordersColumn,
        restaurantOrders,
        restaurantOrderIndex,
        restaurantOrder: restaurantOrders[restaurantOrderIndex]
    };
}

async function updateRestaurantOrder(
    order,
    deliveryId,
    status,
    now,
    reason
) {
    const restaurantData = await getRestaurantOrder(order);

    const {
        restaurantId,
        ordersColumn,
        restaurantOrders,
        restaurantOrderIndex
    } = restaurantData;

    const restaurantOrder = restaurantData.restaurantOrder;
    const restaurantStatus = normalizeText(restaurantOrder.orderStatus);

    if (restaurantStatus === status) {
        return restaurantOrder;
    }

    let allowedNextStatuses = transitions[restaurantStatus] || [];

    if (
        status === "picked_up" &&
        restaurantStatus === "preparing"
    ) {
        const preparationData = {
            ...restaurantOrder,
            ...order
        };

        if (!isPreparationTimeExpired(preparationData, new Date(now))) {
            throw createError(
                "لا يمكن استلام الطلب قبل انتهاء وقت التحضير المحدد من المطعم",
                409
            );
        }

        allowedNextStatuses = ["picked_up"];
    }

    if (!allowedNextStatuses.includes(status)) {
        throw createError(
            "حالة الطلب في قاعدة بيانات المطعم لا تسمح بهذا التحديث",
            409
        );
    }

    const updatedRestaurantOrder = {
        ...restaurantOrder,
        orderId: String(order.orderId ?? order.id ?? ""),
        deliveryId: String(deliveryId),
        orderStatus: status,
        [timestampFields[status]]: now,
        updatedAt: now
    };

    if (
        status === "picked_up" &&
        restaurantStatus === "preparing"
    ) {
        updatedRestaurantOrder.pickedUpAfterPreparationTimeout = true;
    }

    if (status === "customer_refused") {
        updatedRestaurantOrder.customerRefused = true;
        updatedRestaurantOrder.customerRefusalReason = reason || null;
    }

    if (order.settlement) {
        updatedRestaurantOrder.settlement = {
            ...parseObject(restaurantOrder.settlement),
            ...parseObject(order.settlement)
        };
    }

    if (order.payment) {
        updatedRestaurantOrder.payment = {
            ...parseObject(restaurantOrder.payment),
            ...parseObject(order.payment)
        };
    }

    restaurantOrders[restaurantOrderIndex] = updatedRestaurantOrder;

    const result = await dbRun(
        restaurantsDb,
        `UPDATE restaurants
         SET ${quoteIdentifier(ordersColumn)} = ?
         WHERE id = ?`,
        [
            JSON.stringify(restaurantOrders),
            restaurantId
        ]
    );

    if (result.changes !== 1) {
        throw createError(
            "تعذر تحديث الطلب في قاعدة بيانات المطعم",
            500
        );
    }

    return updatedRestaurantOrder;
}

function calculateDeliveryFinancials(order) {
    const pricing = parseObject(order.pricing);
    const settlement = parseObject(order.settlement);
    const deliveryData = parseObject(order.delivery);

    const deliveryFee = money(firstValue(
        pricing.deliveryFee,
        pricing.delivery_fee,
        settlement.deliveryFee,
        settlement.delivery_fee,
        deliveryData.deliveryFee,
        deliveryData.delivery_fee,
        order.deliveryFee,
        order.delivery_fee,
        0
    ));

    const deliveryCommission = money(firstValue(
        settlement.deliveryCommissionAmount,
        settlement.deliveryCommission,
        settlement.delivery_commission,
        pricing.deliveryCommissionAmount,
        pricing.deliveryCommission,
        pricing.delivery_commission,
        deliveryData.deliveryCommission,
        deliveryData.delivery_commission,
        order.deliveryCommission,
        order.delivery_commission,
        0
    ));

    const savedNet = money(firstValue(
        settlement.deliveryNetEarnings,
        settlement.delivery_net_earnings,
        order.deliveryNetEarnings,
        order.delivery_net_earnings,
        0
    ));

    const deliveryNetEarnings = savedNet > 0
        ? savedNet
        : money(Math.max(0, deliveryFee - deliveryCommission));

    const tipAmount = money(firstValue(
        pricing.tip,
        pricing.tipAmount,
        pricing.tip_amount,
        settlement.tipAmount,
        settlement.tip_amount,
        order.tip,
        order.tipAmount,
        0
    ));

    const deliveryEarnings = money(
        deliveryNetEarnings + tipAmount
    );

    return {
        pricing,
        settlement,
        deliveryFee,
        deliveryCommission,
        deliveryNetEarnings,
        tipAmount,
        deliveryEarnings,
        currency: String(
            firstValue(
                pricing.currency,
                settlement.currency,
                "EGP"
            )
        )
    };
}

async function updateDeliveryOrder(
    delivery,
    orderId,
    requestedStatus,
    reason,
    now,
    restaurantOrder = {}
) {
    const history = parseArray(delivery.orders_history);
    const orderIndex = findOrderIndex(history, orderId);

    if (orderIndex === -1) {
        throw createError(
            "الطلب غير موجود في سجل الدليفري الخاص بك",
            404
        );
    }

    const order = history[orderIndex];

    if (String(order.deliveryId ?? "") !== String(delivery.id)) {
        throw createError(
            "هذا الطلب غير مُعيّن لحساب الدليفري الخاص بك",
            403
        );
    }

    const currentStatus = normalizeText(order.orderStatus);
    const allowedNextStatuses = transitions[currentStatus] || [];

    const isInactive =
        normalizeText(delivery.account_status) !== "active" ||
        Number(delivery.is_active) !== 1;

    if (
        isInactive &&
        !["picked_up", "on_the_way"].includes(currentStatus)
    ) {
        throw createError(
            "الحساب غير نشط، ويمكنك فقط إكمال الطلبات التي استلمتها بالفعل",
            403
        );
    }

    if (
        requestedStatus === "picked_up" &&
        currentStatus === "preparing"
    ) {
        const preparationData = {
            ...order,
            ...restaurantOrder
        };

        if (!isPreparationTimeExpired(preparationData, new Date(now))) {
            throw createError(
                "لا يمكن استلام الطلب قبل انتهاء وقت التحضير المحدد من المطعم",
                409
            );
        }
    }

    if (!allowedNextStatuses.includes(requestedStatus)) {
        throw createError(
            "لا يمكن الانتقال من الحالة الحالية إلى الحالة المطلوبة",
            409
        );
    }

    const payment = parseObject(order.payment);
    const isCashPayment = normalizeText(payment.method) === "cash";

    const updatedOrder = {
        ...order,
        orderId,
        deliveryId: String(delivery.id),
        orderStatus: requestedStatus,
        [timestampFields[requestedStatus]]: now,
        updatedAt: now
    };

    if (
        requestedStatus === "picked_up" &&
        currentStatus === "preparing"
    ) {
        updatedOrder.pickedUpAfterPreparationTimeout = true;
    }

    if (requestedStatus === "customer_refused") {
        updatedOrder.customerRefused = true;
        updatedOrder.customerRefusalReason = reason || null;
    }

    let financial = null;

    if (requestedStatus === "delivered") {
        const settlementExists = await tableExists(
            db,
            "delivery_settlements"
        );

        const transactionsExist = await tableExists(
            db,
            "delivery_transactions"
        );

        if (!settlementExists || !transactionsExist) {
            throw createError(
                "جداول التسويات والمعاملات المالية للدليفري غير موجودة",
                500
            );
        }

        const existingSettlement = await dbGet(
            db,
            `SELECT id
             FROM delivery_settlements
             WHERE delivery_id = ?
               AND order_id = ?
             LIMIT 1`,
            [String(delivery.id), orderId]
        );

        if (existingSettlement) {
            throw createError(
                "تم تسجيل التسوية المالية لهذا الطلب من قبل",
                409
            );
        }

        const calculated = calculateDeliveryFinancials(order);
        const pricing = calculated.pricing;
        const settlement = calculated.settlement;

        const orderTotal = money(pricing.total);
        const deliveryFee = calculated.deliveryFee;
        const deliveryCommission = calculated.deliveryCommission;
        const deliveryNetEarnings = calculated.deliveryNetEarnings;
        const tipAmount = calculated.tipAmount;
        const deliveryEarnings = calculated.deliveryEarnings;

        const cashCollected = isCashPayment ? orderTotal : 0;

        const cashToRestaurant = isCashPayment
            ? money(firstValue(
                settlement.deliveryCashToRestaurant,
                settlement.delivery_cash_to_restaurant,
                0
            ))
            : 0;

        const cashToApp = isCashPayment
            ? money(firstValue(
                settlement.deliveryCashToApp,
                settlement.delivery_cash_to_app,
                0
            ))
            : 0;

        const cashToDelivery = isCashPayment
            ? deliveryEarnings
            : 0;

        const cashToCollect = money(
            cashToRestaurant + cashToApp
        );

        const reconciliationDifference = money(
            cashCollected -
            cashToRestaurant -
            cashToApp -
            cashToDelivery
        );

        const balanceBefore = money(delivery.balance);

        const balanceAfter = money(
            balanceBefore + deliveryEarnings
        );

        const settlementId = crypto.randomUUID();

        await dbRun(
            db,
            `INSERT INTO delivery_settlements (
                id,
                delivery_id,
                order_id,
                currency,
                order_total,
                delivery_fee,
                delivery_commission,
                delivery_net_earnings,
                tip_amount,
                cash_collected,
                cash_to_restaurant,
                cash_to_app,
                cash_to_delivery,
                reconciliation_difference,
                settlement_status,
                notes,
                metadata,
                created_at,
                updated_at,
                completed_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                settlementId,
                String(delivery.id),
                orderId,
                calculated.currency,
                orderTotal,
                deliveryFee,
                deliveryCommission,
                deliveryNetEarnings,
                tipAmount,
                cashCollected,
                cashToRestaurant,
                cashToApp,
                cashToDelivery,
                reconciliationDifference,
                "pending",
                "تسوية ناتجة عن إكمال الطلب",
                JSON.stringify({
                    orderNumber: order.orderNumber || null,
                    paymentMethod: payment.method || null,
                    deliveryFee,
                    deliveryCommission,
                    deliveryNetEarnings,
                    tipAmount,
                    tipCommission: 0,
                    originalSettlement: settlement
                }),
                now,
                now,
                null
            ]
        );

        if (deliveryEarnings > 0) {
            await dbRun(
                db,
                `INSERT INTO delivery_transactions (
                    id,
                    delivery_id,
                    order_id,
                    withdrawal_id,
                    transaction_type,
                    category,
                    amount,
                    currency,
                    direction,
                    status,
                    is_withdrawn,
                    description,
                    reference,
                    balance_before,
                    balance_after,
                    metadata,
                    created_at,
                    updated_at,
                    completed_at
                ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    crypto.randomUUID(),
                    String(delivery.id),
                    orderId,
                    "order_earning",
                    "earning",
                    deliveryEarnings,
                    calculated.currency,
                    "credit",
                    "completed",
                    0,
                    "صافي أرباح التوصيل والبقشيش للطلب " +
                        String(order.orderNumber || orderId),
                    String(order.orderNumber || orderId),
                    balanceBefore,
                    balanceAfter,
                    JSON.stringify({
                        deliveryFee,
                        deliveryCommission,
                        deliveryNetEarnings,
                        tipAmount,
                        tipCommission: 0,
                        orderNumber: order.orderNumber || null
                    }),
                    now,
                    now,
                    now
                ]
            );
        }

        updatedOrder.settlement = {
            ...settlement,
            deliveryFee,
            deliveryCommissionAmount: deliveryCommission,
            deliveryNetEarnings,
            deliveryCollectedCash: cashCollected,
            deliveryCashToRestaurant: cashToRestaurant,
            deliveryCashToApp: cashToApp,
            deliveryCashToDelivery: cashToDelivery,
            deliveryCashToCollect: cashToCollect,
            cashReconciliationDifference: reconciliationDifference,
            tipAmount,
            tipCommission: 0
        };

        if (isCashPayment) {
            updatedOrder.payment = {
                ...payment,
                status: "paid",
                paidAt: now
            };
        }

        financial = {
            currency: calculated.currency,
            orderTotal,
            deliveryFee,
            deliveryCommission,
            deliveryNetEarnings,
            tipAmount,
            tipCommission: 0,
            deliveryEarnings,
            cashCollected,
            cashToRestaurant,
            cashToApp,
            cashToDelivery,
            cashToCollect,
            reconciliationDifference,
            balanceBefore,
            balanceAfter,
            settlementId
        };
    }

    history[orderIndex] = updatedOrder;

    const nextCurrentOrderId =
        ["delivered", "customer_refused"].includes(requestedStatus) &&
        String(delivery.current_order_id ?? "") === orderId
            ? null
            : delivery.current_order_id || null;

    const accountColumns = await getTableColumns(
        db,
        "delivery_accounts"
    );

    const availableColumns = new Set(
        accountColumns.map(column => column.name)
    );

    const assignments = [];
    const params = [];

    function addAssignment(column, expression, values = []) {
        if (!availableColumns.has(column)) return;

        assignments.push(`${quoteIdentifier(column)} = ${expression}`);
        params.push(...values);
    }

    addAssignment("orders_history", "?", [
        JSON.stringify(history)
    ]);

    addAssignment("current_order_id", "?", [
        nextCurrentOrderId
    ]);

    addAssignment(
        "completed_orders",
        "COALESCE(completed_orders, 0) + ?",
        [requestedStatus === "delivered" ? 1 : 0]
    );

    addAssignment(
        "cancelled_orders",
        "COALESCE(cancelled_orders, 0) + ?",
        [requestedStatus === "customer_refused" ? 1 : 0]
    );

    addAssignment(
        "balance",
        "COALESCE(balance, 0) + ?",
        [financial ? financial.deliveryEarnings : 0]
    );

    addAssignment(
        "total_earnings",
        "COALESCE(total_earnings, 0) + ?",
        [financial ? financial.deliveryEarnings : 0]
    );

    addAssignment(
        "total_earned_lifetime",
        "COALESCE(total_earned_lifetime, 0) + ?",
        [financial ? financial.deliveryEarnings : 0]
    );

    addAssignment(
        "total_delivery_fees",
        "COALESCE(total_delivery_fees, 0) + ?",
        [financial ? financial.deliveryFee : 0]
    );

    addAssignment(
        "total_commission",
        "COALESCE(total_commission, 0) + ?",
        [financial ? financial.deliveryCommission : 0]
    );

    addAssignment(
        "total_tips",
        "COALESCE(total_tips, 0) + ?",
        [financial ? financial.tipAmount : 0]
    );

    addAssignment(
        "total_cash_collected",
        "COALESCE(total_cash_collected, 0) + ?",
        [financial ? financial.cashCollected : 0]
    );

    addAssignment(
        "total_cash_to_restaurant",
        "COALESCE(total_cash_to_restaurant, 0) + ?",
        [financial ? financial.cashToRestaurant : 0]
    );

    addAssignment(
        "total_cash_to_app",
        "COALESCE(total_cash_to_app, 0) + ?",
        [financial ? financial.cashToApp : 0]
    );

    addAssignment("updated_at", "?", [now]);

    if (!assignments.length) {
        throw createError(
            "لم يتم العثور على أعمدة قابلة للتحديث في حساب الدليفري",
            500
        );
    }

    params.push(String(delivery.id));

    let whereCondition = "id = ?";

    if (availableColumns.has("orders_history")) {
        whereCondition += " AND COALESCE(orders_history, '[]') = ?";
        params.push(delivery.orders_history || "[]");
    }

    const accountUpdate = await dbRun(
        db,
        `UPDATE delivery_accounts
         SET ${assignments.join(", ")}
         WHERE ${whereCondition}`,
        params
    );

    if (accountUpdate.changes !== 1) {
        throw createError(
            "تغيرت بيانات الطلب أو الحساب، حاول مرة أخرى",
            409
        );
    }

    return {
        order: updatedOrder,
        financial,
        nextCurrentOrderId
    };
}

router.patch("/update-order-status", async (req, res) => {
    let deliveryTransactionStarted = false;

    try {
        const token = getToken(req);
        const orderId = String(req.body?.orderId ?? "").trim();
        const requestedStatus = normalizeText(req.body?.status);

        const reason = typeof req.body?.reason === "string"
            ? req.body.reason.trim()
            : "";

        if (!token || !orderId || !requestedStatus) {
            return res.status(400).json({
                success: false,
                message: "توكن الدليفري ومعرف الطلب والحالة الجديدة مطلوبون"
            });
        }

        if (
            requestedStatus === "customer_refused" &&
            reason.length > 500
        ) {
            return res.status(400).json({
                success: false,
                message: "سبب رفض العميل يجب ألا يتجاوز 500 حرف"
            });
        }

        const allowedStatuses = [...new Set(
            Object.values(transitions).flat()
        )];

        if (!allowedStatuses.includes(requestedStatus)) {
            return res.status(400).json({
                success: false,
                message: "الحالة المطلوبة غير صحيحة",
                allowedStatuses
            });
        }

        const verifiedDelivery = await verifyDelivery(token);

        await dbRun(db, "BEGIN IMMEDIATE");
        deliveryTransactionStarted = true;

        const delivery = await dbGet(
            db,
            `SELECT *
             FROM delivery_accounts
             WHERE id = ?
               AND LOWER(TRIM(account_type)) = 'delivery'
             LIMIT 1`,
            [String(verifiedDelivery.id)]
        );

        if (!delivery) {
            throw createError("حساب الدليفري غير موجود", 404);
        }

        const history = parseArray(delivery.orders_history);
        const orderIndex = findOrderIndex(history, orderId);

        if (orderIndex === -1) {
            throw createError(
                "الطلب غير موجود في سجل الدليفري الخاص بك",
                404
            );
        }

        const order = history[orderIndex];

        if (String(order.deliveryId ?? "") !== String(delivery.id)) {
            throw createError(
                "هذا الطلب غير مُعيّن لحساب الدليفري الخاص بك",
                403
            );
        }

        const restaurantData = await getRestaurantOrder(order);
        const now = new Date().toISOString();

        const result = await updateDeliveryOrder(
            delivery,
            orderId,
            requestedStatus,
            reason,
            now,
            restaurantData.restaurantOrder
        );

        const restaurantOrder = await updateRestaurantOrder(
            result.order,
            delivery.id,
            requestedStatus,
            now,
            reason
        );

        await dbRun(db, "COMMIT");
        deliveryTransactionStarted = false;

        const updatedDelivery = await dbGet(
            db,
            `SELECT *
             FROM delivery_accounts
             WHERE id = ?`,
            [String(delivery.id)]
        );

        return res.status(200).json({
            success: true,
            message: messages[requestedStatus],
            order: result.order,
            restaurantOrder,
            financial: result.financial,
            delivery: updatedDelivery
        });

    } catch (error) {
        if (deliveryTransactionStarted) {
            try {
                await dbRun(db, "ROLLBACK");
            } catch (rollbackError) {
                console.error(
                    "Delivery Rollback Error:",
                    rollbackError.message
                );
            }
        }

        console.error("Delivery Order Status Error:", error);

        return res.status(error.status || 500).json({
            success: false,
            message: error.status
                ? error.message
                : "حدث خطأ أثناء تحديث حالة الطلب"
        });
    }
});

router.get("/clear-all-orders", async (req, res) => {
    let restaurantsTransaction = false;
    let deliveryTransaction = false;

    try {
        const restaurantTables = await dbAll(
            restaurantsDb,
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        );

        const deliveryTables = await dbAll(
            db,
            "SELECT name FROM sqlite_master WHERE type = 'table'"
        );

        const restaurantTableNames = restaurantTables.map(table => table.name);
        const deliveryTableNames = deliveryTables.map(table => table.name);

        if (!restaurantTableNames.includes("restaurants")) {
            return res.status(500).json({
                success: false,
                message: "جدول المطاعم غير موجود"
            });
        }

        if (!deliveryTableNames.includes("delivery_accounts")) {
            return res.status(500).json({
                success: false,
                message: "جدول حسابات الدليفري غير موجود"
            });
        }

        const restaurantColumns = await getTableColumns(
            restaurantsDb,
            "restaurants"
        );

        const deliveryColumns = await getTableColumns(
            db,
            "delivery_accounts"
        );

        const restaurantColumnNames = restaurantColumns.map(column => column.name);
        const deliveryColumnNames = deliveryColumns.map(column => column.name);

        const restaurantOrdersColumn = restaurantColumns.find(column =>
            ["orders", "orders_history", "orders_json"].includes(column.name)
        );

        const deliveryOrdersColumn = deliveryColumns.find(column =>
            ["orders_history", "orders", "orders_json"].includes(column.name)
        );

        if (!restaurantOrdersColumn) {
            return res.status(400).json({
                success: false,
                message: "لم يتم العثور على عمود أوردرات المطاعم",
                restaurantColumns: restaurantColumnNames
            });
        }

        if (!deliveryOrdersColumn) {
            return res.status(400).json({
                success: false,
                message: "لم يتم العثور على عمود أوردرات الدليفري",
                deliveryColumns: deliveryColumnNames
            });
        }

        await dbRun(restaurantsDb, "BEGIN IMMEDIATE");
        restaurantsTransaction = true;

        await dbRun(db, "BEGIN IMMEDIATE");
        deliveryTransaction = true;

        const restaurants = await dbAll(
            restaurantsDb,
            `SELECT id, ${quoteIdentifier(restaurantOrdersColumn.name)} AS orders
             FROM restaurants`
        );

        const deliveryAccounts = await dbAll(
            db,
            `SELECT id, ${quoteIdentifier(deliveryOrdersColumn.name)} AS orders
             FROM delivery_accounts`
        );

        let restaurantOrdersDeleted = 0;
        let deliveryOrdersDeleted = 0;

        for (const restaurant of restaurants) {
            restaurantOrdersDeleted += parseArray(restaurant.orders).length;

            const assignments = [
                `${quoteIdentifier(restaurantOrdersColumn.name)} = ?`
            ];

            const params = [JSON.stringify([])];

            const restaurantStats = [
                "orders_count",
                "completed_orders",
                "cancelled_orders",
                "total_orders",
                "total_sales",
                "total_revenue",
                "total_earnings",
                "total_commission",
                "total_delivery_fees",
                "total_tips",
                "total_cash_collected"
            ];

            for (const column of restaurantStats) {
                if (restaurantColumnNames.includes(column)) {
                    assignments.push(`${quoteIdentifier(column)} = 0`);
                }
            }

            params.push(restaurant.id);

            await dbRun(
                restaurantsDb,
                `UPDATE restaurants
                 SET ${assignments.join(", ")}
                 WHERE id = ?`,
                params
            );
        }

        const zeroColumns = [
            "balance",
            "points",
            "orders_count",
            "completed_orders",
            "cancelled_orders",
            "total_orders",
            "total_earnings",
            "total_earned_lifetime",
            "total_withdrawn",
            "pending_withdrawals",
            "total_delivery_fees",
            "total_commission",
            "total_tips",
            "total_cash_collected",
            "total_cash_to_restaurant",
            "total_cash_to_app",
            "total_cash_to_delivery",
            "total_refunds",
            "total_penalties"
        ].filter(column => deliveryColumnNames.includes(column));

        const jsonColumns = [
            "orders_history",
            "orders",
            "orders_json",
            "transactions_history",
            "withdrawals_history"
        ].filter(column => deliveryColumnNames.includes(column));

        const deliveryAssignments = [
            ...zeroColumns.map(column => `${quoteIdentifier(column)} = 0`),
            ...jsonColumns.map(column => `${quoteIdentifier(column)} = '[]'`)
        ];

        for (const account of deliveryAccounts) {
            deliveryOrdersDeleted += parseArray(account.orders).length;
        }

        if (deliveryAssignments.length) {
            await dbRun(
                db,
                `UPDATE delivery_accounts
                 SET ${deliveryAssignments.join(", ")}`
            );
        }

        const tablesToClear = [
            "delivery_settlements",
            "delivery_transactions",
            "delivery_withdrawals",
            "delivery_withdrawal_transactions"
        ];

        const clearedTables = [];

        for (const table of tablesToClear) {
            if (!deliveryTableNames.includes(table)) continue;

            await dbRun(
                db,
                `DELETE FROM ${quoteIdentifier(table)}`
            );

            clearedTables.push(table);
        }

        await dbRun(restaurantsDb, "COMMIT");
        restaurantsTransaction = false;

        await dbRun(db, "COMMIT");
        deliveryTransaction = false;

        return res.json({
            success: true,
            message: "تم تصفير الأوردرات والإحصائيات والبيانات المالية للدليفري",
            restaurantOrdersDeleted,
            deliveryOrdersDeleted,
            restaurantStatisticsReset: true,
            deliveryStatisticsReset: true,
            deliveryFinancialDataReset: true,
            clearedTables
        });

    } catch (error) {
        if (restaurantsTransaction) {
            try {
                await dbRun(restaurantsDb, "ROLLBACK");
            } catch {}
        }

        if (deliveryTransaction) {
            try {
                await dbRun(db, "ROLLBACK");
            } catch {}
        }

        console.error(error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تصفير البيانات",
            error: error.message
        });
    }
});

module.exports = router;
