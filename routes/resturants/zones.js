const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();
const { db } = require("../../mydb/restaurants");

const JWT_SECRET = "secretkey";

function dbGet(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row);
        });
    });
}

function dbRun(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function (err) {
            if (err) return reject(err);
            resolve({
                changes: this.changes,
                lastID: this.lastID
            });
        });
    });
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function parseZones(value) {
    if (Array.isArray(value)) return value;

    if (typeof value !== "string" || !value.trim()) {
        return [];
    }

    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
        throw new Error("INVALID_DELIVERY_ZONES");
    }

    return parsed;
}

function getToken(req) {
    const authorization = req.headers.authorization || "";
    const bearer = authorization.match(/^Bearer\s+(.+)$/i);

    return String(
        req.body?.token ||
        req.query?.token ||
        (bearer ? bearer[1] : "") ||
        ""
    ).trim();
}

async function getRestaurant(req, res) {
    const token = getToken(req);

    if (!token) {
        res.status(401).json({
            success: false,
            message: "التوكن مطلوب"
        });
        return null;
    }

    let decoded;

    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        res.status(401).json({
            success: false,
            message: "التوكن غير صالح أو منتهي الصلاحية"
        });
        return null;
    }

    const restaurantId =
        decoded.restaurantId ??
        decoded.id ??
        decoded.userId;

    if (
        restaurantId === undefined ||
        restaurantId === null ||
        String(restaurantId).trim() === ""
    ) {
        res.status(401).json({
            success: false,
            message: "التوكن لا يحتوي على معرّف المطعم"
        });
        return null;
    }

    const restaurant = await dbGet(
        "SELECT * FROM restaurants WHERE id = ?",
        [restaurantId]
    );

    if (!restaurant) {
        res.status(404).json({
            success: false,
            message: "المطعم غير موجود"
        });
        return null;
    }

    const column = await dbGet(
        "SELECT name FROM pragma_table_info('restaurants') WHERE name = 'delivery_zones'"
    );

    if (!column) {
        res.status(500).json({
            success: false,
            message: "عمود delivery_zones غير موجود في جدول restaurants"
        });
        return null;
    }

    return restaurant;
}

function getZones(restaurant) {
    try {
        return parseZones(restaurant.delivery_zones);
    } catch {
        throw new Error("INVALID_DELIVERY_ZONES");
    }
}

async function saveZones(restaurantId, zones) {
    const result = await dbRun(
        "UPDATE restaurants SET delivery_zones = ? WHERE id = ?",
        [JSON.stringify(zones), restaurantId]
    );

    if (result.changes === 0) {
        const restaurant = await dbGet(
            "SELECT id FROM restaurants WHERE id = ?",
            [restaurantId]
        );

        if (!restaurant) {
            throw new Error("RESTAURANT_NOT_FOUND");
        }
    }
}

function validateZoneData(body, partial = false) {
    const allowedFields = [
        "name_ar",
        "name_en",
        "name_ru",
        "city",
        "delivery_fee",
        "minimum_order",
        "delivery_time",
        "status",
        "description"
    ];

    const zone = {};

    if (partial) {
        const provided = allowedFields.filter(field =>
            hasOwn(body, field)
        );

        if (provided.length === 0) {
            return {
                error: "أرسل حقلًا واحدًا على الأقل لتعديله"
            };
        }
    }

    for (const field of [
        "name_ar",
        "name_en",
        "name_ru",
        "city",
        "description"
    ]) {
        if (!hasOwn(body, field)) {
            if (!partial && ["name_ar", "city"].includes(field)) {
                return {
                    error: field === "name_ar"
                        ? "اسم المنطقة بالعربية مطلوب"
                        : "المدينة مطلوبة"
                };
            }

            continue;
        }

        if (typeof body[field] !== "string") {
            return {
                error: `قيمة ${field} يجب أن تكون نصًا`
            };
        }

        zone[field] = body[field].trim();
    }

    if (hasOwn(zone, "name_ar") && !zone.name_ar) {
        return {
            error: "اسم المنطقة بالعربية مطلوب"
        };
    }

    if (hasOwn(zone, "city") && !zone.city) {
        return {
            error: "اسم المدينة مطلوب"
        };
    }

    for (const field of [
        "delivery_fee",
        "minimum_order",
        "delivery_time"
    ]) {
        if (!hasOwn(body, field)) {
            if (!partial) {
                zone[field] = field === "delivery_time" ? 30 : 0;
            }

            continue;
        }

        if (
            body[field] === null ||
            body[field] === "" ||
            typeof body[field] === "boolean"
        ) {
            return {
                error: `قيمة ${field} غير صالحة`
            };
        }

        const value = Number(body[field]);

        if (
            !Number.isFinite(value) ||
            value < 0 ||
            (field === "delivery_time" && !Number.isInteger(value))
        ) {
            return {
                error: `قيمة ${field} غير صالحة`
            };
        }

        zone[field] = value;
    }

    if (hasOwn(body, "status")) {
        if (!["active", "inactive"].includes(body.status)) {
            return {
                error: "حالة المنطقة يجب أن تكون active أو inactive"
            };
        }

        zone.status = body.status;
    } else if (!partial) {
        zone.status = "active";
    }

    return {
        zone
    };
}

function findZoneIndex(zones, id) {
    return zones.findIndex(
        zone => String(zone.id) === String(id)
    );
}

function hasDuplicateName(zones, name, excludedId = null) {
    const normalized = String(name || "").trim().toLowerCase();

    return zones.some(zone =>
        String(zone.id) !== String(excludedId) &&
        String(zone.name_ar || "").trim().toLowerCase() === normalized
    );
}

router.post("/add-zone", async (req, res) => {
    try {
        const validation = validateZoneData(req.body);

        if (validation.error) {
            return res.status(400).json({
                success: false,
                message: validation.error
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const zones = getZones(restaurant);
        const data = validation.zone;

        if (hasDuplicateName(zones, data.name_ar)) {
            return res.status(409).json({
                success: false,
                message: "توجد منطقة توصيل بهذا الاسم بالفعل"
            });
        }

        const numericIds = zones
            .map(zone => Number(zone.id))
            .filter(id => Number.isSafeInteger(id) && id > 0);

        const id = numericIds.length
            ? Math.max(...numericIds) + 1
            : 1;

        const newZone = {
            id,
            name_ar: data.name_ar,
            name_en: data.name_en || "",
            name_ru: data.name_ru || "",
            city: data.city,
            delivery_fee: data.delivery_fee,
            minimum_order: data.minimum_order,
            delivery_time: data.delivery_time,
            status: data.status,
            description: data.description || "",
            orders: 0
        };

        zones.push(newZone);

        await saveZones(restaurant.id, zones);

        return res.status(201).json({
            success: true,
            message: "تمت إضافة منطقة التوصيل بنجاح",
            zone: newZone,
            zones
        });
    } catch (error) {
        console.error("Add Delivery Zone Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إضافة منطقة التوصيل"
        });
    }
});

router.put("/edit-zone", async (req, res) => {
    try {
        const id = String(req.body?.id ?? "").trim();

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "معرّف منطقة التوصيل مطلوب"
            });
        }

        const validation = validateZoneData(req.body, true);

        if (validation.error) {
            return res.status(400).json({
                success: false,
                message: validation.error
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const zones = getZones(restaurant);
        const zoneIndex = findZoneIndex(zones, id);

        if (zoneIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "منطقة التوصيل غير موجودة"
            });
        }

        const zone = zones[zoneIndex];
        const data = validation.zone;

        if (
            data.name_ar &&
            hasDuplicateName(zones, data.name_ar, zone.id)
        ) {
            return res.status(409).json({
                success: false,
                message: "توجد منطقة أخرى بهذا الاسم بالفعل"
            });
        }

        Object.assign(zone, data);

        await saveZones(restaurant.id, zones);

        return res.json({
            success: true,
            message: "تم تعديل منطقة التوصيل بنجاح",
            zone,
            zones
        });
    } catch (error) {
        console.error("Edit Delivery Zone Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تعديل منطقة التوصيل"
        });
    }
});

router.delete("/delete-zone", async (req, res) => {
    try {
        const id = String(
            req.body?.id ??
            req.query?.id ??
            ""
        ).trim();

        if (!id) {
            return res.status(400).json({
                success: false,
                message: "معرّف منطقة التوصيل مطلوب"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const zones = getZones(restaurant);
        const zoneIndex = findZoneIndex(zones, id);

        if (zoneIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "منطقة التوصيل غير موجودة"
            });
        }

        const deletedZone = zones[zoneIndex];

        zones.splice(zoneIndex, 1);

        await saveZones(restaurant.id, zones);

        return res.json({
            success: true,
            message: "تم حذف منطقة التوصيل بنجاح",
            deletedZone,
            zones
        });
    } catch (error) {
        console.error("Delete Delivery Zone Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء حذف منطقة التوصيل"
        });
    }
});
router.get("/:restaurantId", async (req, res) => {
    try {
        const restaurantId = String(req.params.restaurantId || "").trim();

        if (!restaurantId) {
            return res.status(400).json({
                success: false,
                message: "معرّف المطعم مطلوب"
            });
        }

        const restaurant = await dbGet(
            "SELECT id, delivery_zones FROM restaurants WHERE id = ?",
            [restaurantId]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        let zones = [];

        try {
            zones = parseZones(restaurant.delivery_zones);
        } catch {
            return res.status(500).json({
                success: false,
                message: "بيانات مناطق التوصيل غير صالحة"
            });
        }

        return res.json({
            success: true,
            restaurantId: restaurant.id,
            count: zones.length,
            zones
        });

    } catch (error) {
        console.error("Get Delivery Zones Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء جلب مناطق التوصيل"
        });
    }
});
module.exports = router;