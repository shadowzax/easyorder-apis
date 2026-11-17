
const express = require("express");

const router = express.Router();

const { db } = require("../../mydb/restaurants");
const { db: deliveryDb } = require("../../mydb/delivery");

const ORDER_STATUSES = [
    "pending",
    "accepted",
    "preparing",
    "ready_for_delivery",
    "ready_for_pickup",
    "picked_up",
    "on_the_way",
    "out_for_delivery",
    "delivered",
    "cancelled",
    "rejected",
    "customer_refused"
];

const TERMINAL_STATUSES = [
    "delivered",
    "cancelled",
    "rejected",
    "customer_refused"
];

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

function addStatusTimestamp(order, status, now) {
    const updated = { ...order };

    const timestampFields = {
        pending: "pendingAt",
        accepted: "acceptedAt",
        preparing: "preparationStartedAt",
        ready_for_delivery: "readyForDeliveryAt",
        ready_for_pickup: "readyForPickupAt",
        picked_up: "pickedUpAt",
        on_the_way: "onTheWayAt",
        out_for_delivery: "outForDeliveryAt",
        delivered: "deliveredAt",
        cancelled: "cancelledAt",
        rejected: "rejectedAt",
        customer_refused: "customerRefusedAt"
    };

    const field = timestampFields[status];

    if (field) {
        updated[field] = now;
    }

    if (status === "preparing") {
        updated.preparationStartedAt = now;

        const minutes = Number(updated.preparationTimeMinutes);

        if (Number.isFinite(minutes) && minutes > 0) {
            updated.estimatedReadyAt = new Date(
                new Date(now).getTime() + minutes * 60000
            ).toISOString();
        }
    }

    if (
        status === "ready_for_delivery" ||
        status === "ready_for_pickup"
    ) {
        if (updated.preparationStartedAt) {
            const elapsed =
                (new Date(now).getTime() -
                    new Date(updated.preparationStartedAt).getTime()) / 60000;

            updated.actualPreparationTimeMinutes = Math.max(
                0,
                Math.round(elapsed)
            );
        }
    }

    return updated;
}

router.get("/", async (req, res) => {
    try {
        const restaurants = await dbAll(
            db,
            "SELECT * FROM restaurants ORDER BY created_at DESC"
        );

        const orders = [];

        restaurants.forEach(restaurant => {
            const restaurantOrders = parseArray(restaurant.orders);

            restaurantOrders.forEach(order => {
                orders.push({
                    ...order,
                    restaurant: {
                        ...(order.restaurant || {}),
                        restaurantId: String(restaurant.id),
                        id: restaurant.id,
                        name:
                            restaurant.restaurant_name_ar ||
                            restaurant.restaurant_name_en ||
                            restaurant.name ||
                            "",
                        logo: restaurant.logo || "",
                        phone_number: restaurant.phone_number || "",
                        address:
                            restaurant.address_ar ||
                            restaurant.address_en ||
                            ""
                    }
                });
            });
        });

        orders.sort((a, b) => {
            return (
                new Date(b.createdAt || 0).getTime() -
                new Date(a.createdAt || 0).getTime()
            );
        });

        return res.json({
            success: true,
            count: orders.length,
            restaurants_count: restaurants.length,
            orders
        });
    } catch (err) {
        console.error("Get All Orders Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب الطلبات"
        });
    }
});

router.patch("/update-order-status", async (req, res) => {
    try {
        const orderId = String(req.body?.orderId || "").trim();

        const newStatus = normalizeText(
            req.body?.orderStatus ?? req.body?.status
        );

        if (!orderId || !newStatus) {
            return res.status(400).json({
                success: false,
                message: "معرّف الطلب والحالة الجديدة مطلوبان"
            });
        }

        if (!ORDER_STATUSES.includes(newStatus)) {
            return res.status(400).json({
                success: false,
                message: "حالة الطلب غير صحيحة",
                allowedStatuses: ORDER_STATUSES
            });
        }

        const restaurants = await dbAll(
            db,
            "SELECT * FROM restaurants ORDER BY created_at DESC"
        );

        let selectedRestaurant = null;
        let selectedOrderIndex = -1;
        let selectedOrders = null;
        let selectedOrder = null;

        for (const restaurant of restaurants) {
            const orders = parseArray(restaurant.orders);

            const index = orders.findIndex(
                order => String(order.id) === orderId
            );

            if (index !== -1) {
                selectedRestaurant = restaurant;
                selectedOrderIndex = index;
                selectedOrders = orders;
                selectedOrder = orders[index];
                break;
            }
        }

        if (!selectedRestaurant || selectedOrderIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "الطلب غير موجود"
            });
        }

        const previousStatus = normalizeText(
            selectedOrder.orderStatus
        );

        if (previousStatus === newStatus) {
            return res.status(200).json({
                success: true,
                message: "الطلب بالفعل في هذه الحالة",
                previousStatus,
                order: selectedOrder
            });
        }

        const now = new Date().toISOString();

        const updatedOrder = addStatusTimestamp(
            selectedOrder,
            newStatus,
            now
        );

        updatedOrder.orderStatus = newStatus;
        updatedOrder.updatedAt = now;

        if (req.body?.reason !== undefined) {
            const reason = String(req.body.reason).trim();

            if (reason.length > 500) {
                return res.status(400).json({
                    success: false,
                    message: "السبب يجب ألا يتجاوز 500 حرف"
                });
            }

            if (reason) {
                updatedOrder.adminStatusReason = reason;
            }
        }

        if (req.body?.preparationTimeMinutes !== undefined) {
            const minutes = Number(req.body.preparationTimeMinutes);

            if (
                !Number.isInteger(minutes) ||
                minutes < 1 ||
                minutes > 1440
            ) {
                return res.status(400).json({
                    success: false,
                    message: "مدة التحضير يجب أن تكون من 1 إلى 1440 دقيقة"
                });
            }

            updatedOrder.preparationTimeMinutes = minutes;

            if (newStatus === "preparing") {
                updatedOrder.preparationStartedAt = now;
                updatedOrder.estimatedReadyAt = new Date(
                    new Date(now).getTime() + minutes * 60000
                ).toISOString();
            }
        }

        updatedOrder.statusUpdatedBy = "admin";

        selectedOrders[selectedOrderIndex] = updatedOrder;

        const originalOrdersValue =
            selectedRestaurant.orders ?? "[]";

        const restaurantUpdate = await dbRun(
            db,
            `UPDATE restaurants
             SET orders = ?,
                 updated_at = ?
             WHERE id = ?
               AND COALESCE(orders, '[]') = ?`,
            [
                JSON.stringify(selectedOrders),
                now,
                selectedRestaurant.id,
                originalOrdersValue
            ]
        );

        if (restaurantUpdate.changes !== 1) {
            return res.status(409).json({
                success: false,
                message: "تغيرت بيانات الطلب، حاول مرة أخرى"
            });
        }

        let deliveryUpdated = false;
        let deliveryMessage = null;

        const deliveryId = String(
            updatedOrder.delivery?.deliveryId ||
            updatedOrder.deliveryId ||
            ""
        ).trim();

        if (deliveryId) {
            const deliveryAccount = await dbGet(
                deliveryDb,
                `SELECT *
                 FROM delivery_accounts
                 WHERE id = ?
                 LIMIT 1`,
                [deliveryId]
            );

            if (deliveryAccount) {
                const deliveryHistory = parseArray(
                    deliveryAccount.orders_history
                );

                const historyIndex = deliveryHistory.findIndex(
                    item =>
                        String(item.orderId ?? item.id) === orderId
                );

                if (historyIndex !== -1) {
                    deliveryHistory[historyIndex] = {
                        ...deliveryHistory[historyIndex],
                        ...updatedOrder,
                        orderId,
                        restaurantId: String(selectedRestaurant.id),
                        deliveryId,
                        orderStatus: newStatus,
                        updatedAt: now,
                        statusUpdatedBy: "admin"
                    };

                    const deliveryResult = await dbRun(
                        deliveryDb,
                        `UPDATE delivery_accounts
                         SET orders_history = ?,
                             current_order_id = CASE
                                 WHEN current_order_id = ?
                                  AND ? = 1
                                 THEN NULL
                                 ELSE current_order_id
                             END,
                             updated_at = ?
                         WHERE id = ?`,
                        [
                            JSON.stringify(deliveryHistory),
                            orderId,
                            TERMINAL_STATUSES.includes(newStatus) ? 1 : 0,
                            now,
                            deliveryId
                        ]
                    );

                    deliveryUpdated = deliveryResult.changes === 1;

                    if (!deliveryUpdated) {
                        deliveryMessage = "تعذر تحديث سجل المندوب";
                    }
                } else {
                    deliveryMessage = "الطلب غير موجود في سجل المندوب";
                }
            } else {
                deliveryMessage = "حساب المندوب غير موجود";
            }
        }

        const messages = {
            pending: "تم إعادة الطلب إلى حالة الانتظار",
            accepted: "تم قبول الطلب",
            preparing: "تم بدء تحضير الطلب",
            ready_for_delivery: "الطلب جاهز للتسليم للمندوب",
            ready_for_pickup: "الطلب جاهز للاستلام من المطعم",
            picked_up: "تم استلام الطلب من المطعم",
            on_the_way: "المندوب في الطريق إلى العميل",
            out_for_delivery: "الطلب خرج للتوصيل",
            delivered: "تم تسليم الطلب",
            cancelled: "تم إلغاء الطلب",
            rejected: "تم رفض الطلب",
            customer_refused: "تم تسجيل رفض العميل للاستلام"
        };

        return res.status(200).json({
            success: true,
            message: messages[newStatus] || "تم تحديث حالة الطلب بنجاح",
            previousStatus,
            newStatus,
            order: updatedOrder,
            deliveryUpdated,
            deliveryMessage
        });
    } catch (err) {
        console.error("Update Order Status Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تحديث حالة الطلب"
        });
    }
});

module.exports = router;
