
const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();
const { db } = require("../../mydb/delivery");

const JWT_SECRET = process.env.JWT_SECRET || "secretkey";

router.post("/update-profile", (req, res) => {
    const authHeader = String(req.headers.authorization || "").trim();

    const token = authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : String(req.body.token || "").trim();

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

    const allowedFields = [
        "name",
        "email",
        "phone_number",
        "profile_picture"
    ];

    const updates = {};
    
    for (const field of allowedFields) {
        if (req.body[field] !== undefined) {
            const value = String(req.body[field]).trim();

            if (!value) {
                return res.status(400).json({
                    success: false,
                    message: `حقل ${field} لا يمكن أن يكون فارغاً`
                });
            }

            updates[field] = field === "email"
                ? value.toLowerCase()
                : value;
        }
    }

    if (Object.keys(updates).length === 0) {
        return res.status(400).json({
            success: false,
            message: "يجب إرسال معلومة واحدة على الأقل للتعديل"
        });
    }

    if (updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(updates.email)) {
        return res.status(400).json({
            success: false,
            message: "البريد الإلكتروني غير صالح"
        });
    }

    if (updates.profile_picture) {
        try {
            const imageUrl = new URL(updates.profile_picture);

            if (!["http:", "https:"].includes(imageUrl.protocol)) {
                throw new Error();
            }
        } catch {
            return res.status(400).json({
                success: false,
                message: "رابط صورة البروفايل غير صالح"
            });
        }
    }

    db.get(
        `SELECT id, account_status FROM delivery_accounts WHERE id = ? LIMIT 1`,
        [deliveryId],
        (err, delivery) => {
            if (err) {
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

            const conditions = [];
            const params = [];

            if (updates.email) {
                conditions.push("LOWER(email) = ?");
                params.push(updates.email);
            }

            if (updates.phone_number) {
                conditions.push("phone_number = ?");
                params.push(updates.phone_number);
            }

            const checkExisting = callback => {
                if (conditions.length === 0) {
                    return callback(null, null);
                }

                db.get(
                    `
                    SELECT id, email, phone_number
                    FROM delivery_accounts
                    WHERE (${conditions.join(" OR ")})
                    AND id != ?
                    LIMIT 1
                    `,
                    [...params, deliveryId],
                    callback
                );
            };

            checkExisting((checkErr, existing) => {
                if (checkErr) {
                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ أثناء التحقق من البيانات"
                    });
                }

                if (existing) {
                    return res.status(409).json({
                        success: false,
                        message:
                            updates.email &&
                            existing.email?.toLowerCase() === updates.email
                                ? "البريد الإلكتروني مستخدم بالفعل"
                                : "رقم الهاتف مستخدم بالفعل"
                    });
                }

                const fields = Object.keys(updates);

                const setClause = fields
                    .map(field => `${field} = ?`)
                    .join(", ");

                const values = fields.map(field => updates[field]);

                const now = new Date().toISOString();

                db.run(
                    `
                    UPDATE delivery_accounts
                    SET ${setClause},
                        updated_at = ?
                    WHERE id = ?
                    `,
                    [...values, now, deliveryId],
                    function (updateErr) {
                        if (updateErr) {
                            if (updateErr.message.includes("UNIQUE")) {
                                return res.status(409).json({
                                    success: false,
                                    message: "البريد الإلكتروني أو رقم الهاتف مستخدم بالفعل"
                                });
                            }

                            return res.status(500).json({
                                success: false,
                                message: "حدث خطأ أثناء تحديث البيانات"
                            });
                        }

                        db.get(
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
                                updated_at
                            FROM delivery_accounts
                            WHERE id = ?
                            LIMIT 1
                            `,
                            [deliveryId],
                            (getErr, updatedDelivery) => {
                                if (getErr || !updatedDelivery) {
                                    return res.status(500).json({
                                        success: false,
                                        message: "تم التحديث ولكن تعذر جلب البيانات"
                                    });
                                }

                                return res.json({
                                    success: true,
                                    message: "تم تحديث البيانات الشخصية بنجاح",
                                    delivery: updatedDelivery
                                });
                            }
                        );
                    }
                );
            });
        }
    );
});

module.exports = router;
