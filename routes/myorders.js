const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

const { db: restaurantsDb } = require("../mydb/restaurants");
const { db: usersDb } = require("../mydb/users");

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

router.get("/", async (req, res) => {
    try {
        const authHeader = String(
            req.headers.authorization || ""
        ).trim();

        const token = authHeader.startsWith("Bearer ")
            ? authHeader.slice(7).trim()
            : String(req.query.token || "").trim();

        if (!token) {
            return res.status(400).json({
                success: false,
                message: "التوكين مطلوب"
            });
        }

        let decoded;

        try {
            decoded = jwt.verify(token, JWT_SECRET);
        } catch {
            return res.status(401).json({
                success: false,
                message: "التوكين غير صالح أو منتهي الصلاحية"
            });
        }

        const userId = decoded.userId ?? decoded.id;

        if (
            userId == null ||
            String(userId).trim() === ""
        ) {
            return res.status(401).json({
                success: false,
                message: "بيانات التوكين غير صالحة"
            });
        }

        const user = await dbGet(
            usersDb,
            "SELECT * FROM users WHERE id = ? LIMIT 1",
            [userId]
        );

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "المستخدم غير موجود"
            });
        }

        if (
            !["customer", "user"].includes(
                normalizeText(user.account_type)
            )
        ) {
            return res.status(403).json({
                success: false,
                message: "غير مصرح لهذا الحساب بعرض الطلبات"
            });
        }

        const restaurants = await dbAll(
            restaurantsDb,
            "SELECT id, orders FROM restaurants"
        );

        const orders = [];

        for (const restaurant of restaurants) {
            const restaurantOrders = parseArray(
                restaurant.orders
            );

            for (const order of restaurantOrders) {
                const orderUserId =
                    order.customer?.userId ??
                    order.customer?.id ??
                    order.userId ??
                    order.user_id;

                if (
                    orderUserId != null &&
                    String(orderUserId) === String(userId)
                ) {
                    orders.push(order);
                }
            }
        }

        orders.sort((a, b) => {
            const dateA =
                Date.parse(a.createdAt || "") || 0;

            const dateB =
                Date.parse(b.createdAt || "") || 0;

            return dateB - dateA;
        });

        return res.status(200).json({
            success: true,
            message: "تم جلب طلبات المستخدم بنجاح",
            userId: String(userId),
            count: orders.length,
            orders
        });

    } catch (err) {
        console.error("Get User Orders Error:", err);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب الطلبات"
        });
    }
});

module.exports = router;