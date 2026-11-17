
const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const { db } = require("../../mydb/restaurants");
const { db: deliveryDb } = require("../../mydb/delivery");

const JWT_SECRET = "secretkey";

function dbGet(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function dbRun(database, sql, params = []) {
    return new Promise((resolve, reject) => {
        database.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({ changes: this.changes });
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

function normalizeText(value) {
    return String(value ?? "")
        .normalize("NFC")
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase();
}

function isPickupOrder(order) {
    const delivery = order.delivery || {};

    const candidates = [
        order.orderType,
        order.deliveryType,
        order.fulfillmentType,
        order.deliveryMethod,
        order.type,
        delivery.type,
        delivery.method,
        delivery.deliveryType,
        delivery.fulfillmentType,
        delivery.methodType
    ].map(normalizeText);

    return candidates.some(value =>
        [
            "pickup",
            "pick_up",
            "pick-up",
            "self_pickup",
            "self-pickup",
            "restaurant_pickup",
            "collection",
            "استلام",
            "استلام من المطعم",
            "استلام من الفرع",
            "استلام ذاتي"
        ].includes(value)
    );
}

async function verifyRestaurant(token) {
    let decoded;

    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        const error = new Error("التوكين غير صالح أو منتهي الصلاحية");
        error.status = 401;
        throw error;
    }

    const restaurantId =
        decoded.restaurantId ?? decoded.userId ?? decoded.id;

    if (restaurantId == null || String(restaurantId).trim() === "") {
        const error = new Error("التوكين غير صالح");
        error.status = 401;
        throw error;
    }

    const restaurant = await dbGet(
        db,
        "SELECT * FROM restaurants WHERE id = ? LIMIT 1",
        [restaurantId]
    );

    if (!restaurant) {
        const error = new Error("حساب المطعم غير موجود");
        error.status = 404;
        throw error;
    }

    if (normalizeText(restaurant.account_status) !== "active") {
        const error = new Error("حساب المطعم غير نشط");
        error.status = 403;
        throw error;
    }

    if (normalizeText(restaurant.account_type) !== "restaurant") {
        const error = new Error("غير مصرح لهذا الحساب بتحديث الطلبات");
        error.status = 403;
        throw error;
    }

    return restaurant;
}

router.patch("/update-order-status", async (req, res) => {
    let assignedDelivery = null;
    let previousDeliveryHistory = null;
    let previousDeliveryCurrentOrderId = null;
    let previousDeliveryOrdersCount = null;
    let assignedDeliveryHistory = null;
    let restaurantUpdated = false;

    try {
        const token = String(req.body?.token || "").trim();
        const orderId = String(req.body?.orderId || "").trim();

        if (!token || !orderId) {
            return res.status(400).json({
                success: false,
                message: "التوكين ومعرّف الطلب مطلوبان"
            });
        }

        const restaurant = await verifyRestaurant(token);
        const orders = parseArray(restaurant.orders);

        const orderIndex = orders.findIndex(
            item => String(item.id) === orderId
        );

        if (orderIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "الطلب غير موجود في مطعمك"
            });
        }

        const order = orders[orderIndex];

        if (
            String(order.restaurant?.restaurantId) !==
            String(restaurant.id)
        ) {
            return res.status(403).json({
                success: false,
                message: "هذا الطلب لا يتبع مطعمك"
            });
        }

        const currentStatus = normalizeText(order.orderStatus);
        const pickupOrder = isPickupOrder(order);

        const nextStatus = pickupOrder
            ? {
                pending: "accepted",
                accepted: "preparing",
                preparing: "ready_for_pickup",
                ready_for_pickup: "delivered"
            }
            : {
                pending: "accepted",
                accepted: "preparing",
                preparing: "ready_for_delivery"
            };

        const newStatus = nextStatus[currentStatus];

        if (!newStatus) {
            return res.status(409).json({
                success: false,
                message: "لا يمكن تحديث الطلب في حالته الحالية",
                orderStatus: order.orderStatus,
                pickupOrder
            });
        }

        let preparationTimeMinutes = null;
        let estimatedReadyAt = null;

        if (newStatus === "preparing") {
            preparationTimeMinutes = Number(
                req.body?.preparationTimeMinutes
            );

            if (
                !Number.isInteger(preparationTimeMinutes) ||
                preparationTimeMinutes < 1 ||
                preparationTimeMinutes > 1440
            ) {
                return res.status(400).json({
                    success: false,
                    message: "يجب تحديد مدة تحضير صحيحة بالدقائق من 1 إلى 1440",
                    requiredField: "preparationTimeMinutes"
                });
            }
        }

        const nowDate = new Date();
        const now = nowDate.toISOString();

        if (newStatus === "preparing") {
            estimatedReadyAt = new Date(
                nowDate.getTime() +
                preparationTimeMinutes * 60 * 1000
            ).toISOString();
        }

        const updatedOrder = { ...order };

        if (newStatus === "accepted") {
            if (!pickupOrder) {
                const deliveryAccounts = await dbAll(
                    deliveryDb,
                    `SELECT *
                     FROM delivery_accounts
                     WHERE LOWER(TRIM(account_type)) = 'delivery'
                       AND LOWER(TRIM(account_status)) = 'active'
                       AND is_active = 1
                     ORDER BY created_at ASC`
                );

                const activeStatuses = new Set([
                    "accepted",
                    "preparing",
                    "ready_for_delivery",
                    "picked_up",
                    "on_the_way",
                    "out_for_delivery"
                ]);

                const rankedDeliveries = deliveryAccounts
                    .map(account => {
                        const history = parseArray(account.orders_history);

                        const activeCount = history.filter(item =>
                            activeStatuses.has(
                                normalizeText(item.orderStatus)
                            )
                        ).length;

                        return {
                            account,
                            history,
                            activeCount
                        };
                    })
                    .filter(item =>
                        !item.history.some(
                            historyItem =>
                                String(
                                    historyItem.orderId ?? historyItem.id
                                ) === orderId
                        )
                    )
                    .sort((a, b) => {
                        if (a.activeCount !== b.activeCount) {
                            return a.activeCount - b.activeCount;
                        }

                        const aDate =
                            Date.parse(a.account.created_at || "") || 0;
                        const bDate =
                            Date.parse(b.account.created_at || "") || 0;

                        return aDate - bDate;
                    });

                const selected = rankedDeliveries[0];

                if (!selected) {
                    return res.status(409).json({
                        success: false,
                        message: "لا يوجد مندوب توصيل متاح حاليًا"
                    });
                }

                const delivery = selected.account;

                previousDeliveryHistory =
                    delivery.orders_history || "[]";

                previousDeliveryCurrentOrderId =
                    delivery.current_order_id;

                previousDeliveryOrdersCount =
                    Number(delivery.orders_count) || 0;

                const deliveryOrder = {
                    ...order,
                    orderId,
                    restaurantId: String(restaurant.id),
                    deliveryId: String(delivery.id),
                    orderStatus: "accepted",
                    acceptedAt: now,
                    assignedAt: now,
                    updatedAt: now
                };

                const nextDeliveryHistory = JSON.stringify([
                    ...selected.history,
                    deliveryOrder
                ]);

                const nextCurrentOrderId =
                    selected.activeCount === 0
                        ? orderId
                        : delivery.current_order_id || orderId;

                const assignmentResult = await dbRun(
                    deliveryDb,
                    `UPDATE delivery_accounts
                     SET current_order_id = ?,
                         orders_history = ?,
                         orders_count = COALESCE(orders_count, 0) + 1,
                         updated_at = ?
                     WHERE id = ?
                       AND LOWER(TRIM(account_type)) = 'delivery'
                       AND LOWER(TRIM(account_status)) = 'active'
                       AND is_active = 1
                       AND COALESCE(orders_history, '[]') = ?`,
                    [
                        nextCurrentOrderId,
                        nextDeliveryHistory,
                        now,
                        delivery.id,
                        previousDeliveryHistory
                    ]
                );

                if (assignmentResult.changes !== 1) {
                    return res.status(409).json({
                        success: false,
                        message: "تغيرت بيانات المندوب، حاول مرة أخرى"
                    });
                }

                assignedDelivery = delivery;
                assignedDeliveryHistory = nextDeliveryHistory;

                updatedOrder.delivery = {
                    ...(order.delivery || {}),
                    deliveryId: String(delivery.id),
                    name: delivery.name,
                    phone_number: delivery.phone_number
                };

                updatedOrder.assignedAt = now;
            }

            updatedOrder.acceptedAt = now;
        }

        if (newStatus === "preparing") {
            updatedOrder.preparationStartedAt = now;
            updatedOrder.preparationTimeMinutes =
                preparationTimeMinutes;
            updatedOrder.estimatedReadyAt = estimatedReadyAt;
        }

        if (newStatus === "ready_for_pickup") {
            updatedOrder.readyForPickupAt = now;
            updatedOrder.actualPreparationTimeMinutes =
                Math.max(
                    0,
                    (new Date(now).getTime() -
                        new Date(updatedOrder.preparationStartedAt).getTime()) /
                    60000
                );
        }

        if (newStatus === "ready_for_delivery") {
            updatedOrder.readyForDeliveryAt = now;
            updatedOrder.actualPreparationTimeMinutes =
                Math.max(
                    0,
                    (new Date(now).getTime() -
                        new Date(updatedOrder.preparationStartedAt).getTime()) /
                    60000
                );
        }

        if (newStatus === "delivered") {
            updatedOrder.deliveredAt = now;
            updatedOrder.deliveryMethod = "pickup";
        }

        updatedOrder.orderStatus = newStatus;
        updatedOrder.updatedAt = now;

        if (assignedDelivery) {
            updatedOrder.delivery = {
                ...(updatedOrder.delivery || {}),
                deliveryId: String(assignedDelivery.id),
                name: assignedDelivery.name,
                phone_number: assignedDelivery.phone_number
            };
        }

        if (!pickupOrder && newStatus !== "accepted") {
            const deliveryId = String(
                updatedOrder.delivery?.deliveryId || ""
            );

            if (!deliveryId) {
                throw new Error("معرّف المندوب غير موجود");
            }

            const deliveryAccount = await dbGet(
                deliveryDb,
                `SELECT *
                 FROM delivery_accounts
                 WHERE id = ?
                 LIMIT 1`,
                [deliveryId]
            );

            if (!deliveryAccount) {
                throw new Error("حساب المندوب غير موجود");
            }

            const previousHistory =
                deliveryAccount.orders_history || "[]";

            const history = parseArray(previousHistory);

            const historyIndex = history.findIndex(
                item => String(item.orderId ?? item.id) === orderId
            );

            if (historyIndex === -1) {
                throw new Error("الطلب غير موجود في سجل المندوب");
            }

            history[historyIndex] = {
                ...history[historyIndex],
                ...updatedOrder,
                orderId,
                restaurantId: String(restaurant.id),
                deliveryId,
                orderStatus: newStatus,
                updatedAt: now
            };

            const deliveryResult = await dbRun(
                deliveryDb,
                `UPDATE delivery_accounts
                 SET orders_history = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND COALESCE(orders_history, '[]') = ?`,
                [
                    JSON.stringify(history),
                    now,
                    deliveryId,
                    previousHistory
                ]
            );

            if (deliveryResult.changes !== 1) {
                throw new Error(
                    "تعذر تحديث سجل المندوب بسبب تغيير متزامن"
                );
            }
        }

        orders[orderIndex] = updatedOrder;

        const restaurantResult = await dbRun(
            db,
            `UPDATE restaurants
             SET orders = ?,
                 updated_at = ?
             WHERE id = ?
               AND LOWER(TRIM(account_status)) = 'active'`,
            [
                JSON.stringify(orders),
                now,
                restaurant.id
            ]
        );

        if (restaurantResult.changes !== 1) {
            throw new Error("تعذر تحديث الطلب في قاعدة بيانات المطعم");
        }

        restaurantUpdated = true;

        const messages = {
            accepted: pickupOrder
                ? "تم قبول طلب الاستلام من المطعم"
                : "تم قبول الطلب وتعيين مندوب توصيل تلقائيًا",
            preparing: "بدأ المطعم تحضير الطلب وتم تحديد موعد الجاهزية المتوقع",
            ready_for_pickup: "الطلب جاهز للاستلام من المطعم",
            ready_for_delivery: "الطلب جاهز للتسليم للمندوب",
            delivered: "تم تسليم الطلب للعميل بنجاح"
        };

        return res.status(200).json({
            success: true,
            message: messages[newStatus],
            previousStatus: currentStatus,
            order: updatedOrder,
            preparation: newStatus === "preparing"
                ? {
                    preparationStartedAt: updatedOrder.preparationStartedAt,
                    preparationTimeMinutes:
                        updatedOrder.preparationTimeMinutes,
                    estimatedReadyAt: updatedOrder.estimatedReadyAt
                }
                : {
                    preparationStartedAt:
                        updatedOrder.preparationStartedAt || null,
                    preparationTimeMinutes:
                        updatedOrder.preparationTimeMinutes ?? null,
                    estimatedReadyAt:
                        updatedOrder.estimatedReadyAt || null,
                    actualPreparationTimeMinutes:
                        updatedOrder.actualPreparationTimeMinutes ?? null
                },
            delivery: updatedOrder.delivery || null
        });
    } catch (err) {
        if (assignedDelivery && !restaurantUpdated) {
            const rollbackTime = new Date().toISOString();

            await dbRun(
                deliveryDb,
                `UPDATE delivery_accounts
                 SET current_order_id = ?,
                     orders_history = ?,
                     orders_count = ?,
                     updated_at = ?
                 WHERE id = ?
                   AND COALESCE(orders_history, '[]') = ?`,
                [
                    previousDeliveryCurrentOrderId || null,
                    previousDeliveryHistory,
                    previousDeliveryOrdersCount,
                    rollbackTime,
                    assignedDelivery.id,
                    assignedDeliveryHistory
                ]
            ).catch(rollbackError => {
                console.error("Delivery Rollback Error:", rollbackError);
            });
        }

        console.error("Update Order Status Error:", err);

        return res.status(err.status || 500).json({
            success: false,
            message: err.status
                ? err.message
                : "حدث خطأ أثناء تحديث حالة الطلب"
        });
    }
});

router.patch("/reject-order", async (req, res) => {
    try {
        const token = String(req.body?.token || "").trim();
        const orderId = String(req.body?.orderId || "").trim();

        const reason = typeof req.body?.reason === "string"
            ? req.body.reason.trim()
            : "";

        if (!token || !orderId || !reason) {
            return res.status(400).json({
                success: false,
                message: "التوكين ومعرّف الطلب وسبب الرفض مطلوبون"
            });
        }

        if (reason.length > 500) {
            return res.status(400).json({
                success: false,
                message: "سبب الرفض يجب ألا يتجاوز 500 حرف"
            });
        }

        const restaurant = await verifyRestaurant(token);
        const orders = parseArray(restaurant.orders);

        const orderIndex = orders.findIndex(
            order => String(order.id) === orderId
        );

        if (orderIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "الطلب غير موجود في مطعمك"
            });
        }

        const order = orders[orderIndex];

        if (
            String(order.restaurant?.restaurantId) !==
            String(restaurant.id)
        ) {
            return res.status(403).json({
                success: false,
                message: "هذا الطلب لا يتبع مطعمك"
            });
        }

        if (normalizeText(order.orderStatus) !== "pending") {
            return res.status(409).json({
                success: false,
                message: "لا يمكن رفض الطلب في حالته الحالية",
                orderStatus: order.orderStatus
            });
        }

        const now = new Date().toISOString();

        const updatedOrder = {
            ...order,
            orderStatus: "rejected",
            rejectionReason: reason,
            rejectedAt: now,
            updatedAt: now
        };

        orders[orderIndex] = updatedOrder;

        const result = await dbRun(
            db,
            `UPDATE restaurants
             SET orders = ?,
                 cancelled_orders = COALESCE(cancelled_orders, 0) + 1,
                 updated_at = ?
             WHERE id = ?
               AND LOWER(TRIM(account_status)) = 'active'`,
            [
                JSON.stringify(orders),
                now,
                restaurant.id
            ]
        );

        if (result.changes !== 1) {
            return res.status(409).json({
                success: false,
                message: "تعذر تحديث الطلب، حاول مرة أخرى"
            });
        }

        return res.status(200).json({
            success: true,
            message: "تم رفض الطلب بنجاح",
            order: updatedOrder
        });
    } catch (err) {
        console.error("Reject Order Error:", err);

        return res.status(err.status || 500).json({
            success: false,
            message: err.status
                ? err.message
                : "حدث خطأ أثناء رفض الطلب"
        });
    }
});

module.exports = router;
