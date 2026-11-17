
const express = require("express");
const jwt = require("jsonwebtoken");
const { db } = require("../../mydb/restaurants");

const router = express.Router();
const JWT_SECRET = "secretkey";

const DAYS = ["sat", "sun", "mon", "tue", "wed", "thu", "fri"];

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
            resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
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

function getRestaurantId(decoded) {
    return decoded.restaurantId ?? decoded.id ?? decoded.userId ?? null;
}

function parseOpeningHours(value) {
    if (!value) return {};

    if (typeof value === "object" && !Array.isArray(value)) {
        return value;
    }

    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
        return null;
    }
}

function validateTime(value) {
    return typeof value === "string" &&
        /^([01]\d|2[0-3]):([0-5]\d)$/.test(value);
}

function timeToMinutes(value) {
    const [hours, minutes] = value.split(":").map(Number);
    return hours * 60 + minutes;
}

function validateShifts(shifts) {
    if (!Array.isArray(shifts)) {
        return "فترات العمل يجب أن تكون مصفوفة";
    }

    const intervals = [];

    for (const shift of shifts) {
        if (!shift || typeof shift !== "object" || Array.isArray(shift)) {
            return "بيانات فترة العمل غير صحيحة";
        }

        if (!validateTime(shift.from) || !validateTime(shift.to)) {
            return "وقت البداية والنهاية يجب أن يكونا بصيغة HH:MM";
        }

        if (shift.from === shift.to) {
            return "وقت البداية والنهاية لا يمكن أن يكونا متساويين";
        }

        const from = timeToMinutes(shift.from);
        let to = timeToMinutes(shift.to);

        if (to < from) {
            to += 1440;
        }

        intervals.push({
            from,
            to,
            nextDayFrom: from,
            nextDayTo: to > 1440 ? to - 1440 : 0
        });
    }

    const sorted = [...intervals].sort((a, b) => a.from - b.from);

    for (let i = 1; i < sorted.length; i++) {
        if (sorted[i].from < sorted[i - 1].to) {
            return "فترات العمل لا يمكن أن تتداخل";
        }
    }

    for (let i = 0; i < sorted.length; i++) {
        const current = sorted[i];

        if (current.to <= 1440) continue;

        const nextStart = current.to - 1440;

        for (let j = 0; j < sorted.length; j++) {
            if (i === j) continue;

            const other = sorted[j];

            if (other.from < nextStart && other.to > 0) {
                return "الشيفت الليلي يتداخل مع فترة عمل أخرى";
            }
        }
    }

    return null;
}

function validateWorkingHours(input) {
    if (!Array.isArray(input) || input.length !== 7) {
        return {
            error: "يجب إرسال ساعات العمل لجميع أيام الأسبوع السبعة"
        };
    }

    const result = [];
    const usedDays = new Set();

    for (const item of input) {
        if (!item || typeof item !== "object" || Array.isArray(item)) {
            return { error: "بيانات اليوم غير صحيحة" };
        }

        if (!DAYS.includes(item.day)) {
            return { error: "رمز اليوم غير صحيح" };
        }

        if (usedDays.has(item.day)) {
            return { error: "لا يمكن تكرار اليوم" };
        }

        if (typeof item.enabled !== "boolean") {
            return { error: "حقل enabled يجب أن يكون true أو false" };
        }

        if (!Array.isArray(item.shifts)) {
            return { error: "حقل shifts يجب أن يكون مصفوفة" };
        }

        if (item.enabled && item.shifts.length === 0) {
            return {
                error: "يجب تحديد فترة عمل واحدة على الأقل لليوم المفتوح"
            };
        }

        if (!item.enabled && item.shifts.length > 0) {
            return {
                error: "اليوم المغلق يجب ألا يحتوي على فترات عمل"
            };
        }

        const shiftsError = validateShifts(item.shifts);

        if (shiftsError) {
            return { error: `${item.day}: ${shiftsError}` };
        }

        usedDays.add(item.day);

        result.push({
            day: item.day,
            enabled: item.enabled,
            shifts: item.shifts.map(shift => ({
                from: shift.from,
                to: shift.to
            }))
        });
    }

    result.sort((a, b) => DAYS.indexOf(a.day) - DAYS.indexOf(b.day));

    return { data: result };
}

async function authenticateRestaurant(req, res, next) {
    const token = getToken(req);

    if (!token) {
        return res.status(401).json({
            success: false,
            message: "التوكن مطلوب"
        });
    }

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        const restaurantId = getRestaurantId(decoded);

        if (restaurantId === null || restaurantId === undefined) {
            return res.status(401).json({
                success: false,
                message: "التوكن لا يحتوي على معرف المطعم"
            });
        }

        const restaurant = await dbGet(
            "SELECT id, account_type, opening_hours FROM restaurants WHERE id = ?",
            [restaurantId]
        );

        if (!restaurant) {
            return res.status(404).json({
                success: false,
                message: "المطعم غير موجود"
            });
        }

        if (
            restaurant.account_type &&
            restaurant.account_type !== "restaurant"
        ) {
            return res.status(403).json({
                success: false,
                message: "هذا الحساب ليس حساب مطعم"
            });
        }

        req.restaurant = restaurant;
        return next();
    } catch (error) {
        if (
            error.name === "JsonWebTokenError" ||
            error.name === "TokenExpiredError" ||
            error.name === "NotBeforeError"
        ) {
            return res.status(401).json({
                success: false,
                message: "التوكن غير صالح أو منتهي الصلاحية"
            });
        }

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء التحقق من الحساب"
        });
    }
}

router.get("/opening-hours", authenticateRestaurant, (req, res) => {
    const openingHours = parseOpeningHours(req.restaurant.opening_hours);

    if (openingHours === null) {
        return res.status(500).json({
            success: false,
            message: "بيانات ساعات العمل المخزنة غير صالحة"
        });
    }

    return res.json({
        success: true,
        restaurant_id: req.restaurant.id,
        opening_hours: openingHours
    });
});

router.put("/opening-hours", authenticateRestaurant, async (req, res) => {
    try {
        const { same_hours_all_days, shifts, working_hours } = req.body;
        let input;

        if (same_hours_all_days === true) {
            const shiftsError = validateShifts(shifts);

            if (shiftsError) {
                return res.status(400).json({
                    success: false,
                    message: shiftsError
                });
            }

            if (shifts.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "يجب تحديد فترة عمل واحدة على الأقل"
                });
            }

            input = DAYS.map(day => ({
                day,
                enabled: true,
                shifts: shifts.map(shift => ({
                    from: shift.from,
                    to: shift.to
                }))
            }));
        } else {
            input = working_hours;
        }

        const validation = validateWorkingHours(input);

        if (validation.error) {
            return res.status(400).json({
                success: false,
                message: validation.error
            });
        }

        const openingHours = JSON.stringify(validation.data);

        await dbRun(
            "UPDATE restaurants SET opening_hours = ? WHERE id = ?",
            [openingHours, req.restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم تحديث ساعات العمل بنجاح",
            restaurant_id: req.restaurant.id,
            opening_hours: validation.data
        });
    } catch (error) {
        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء حفظ ساعات العمل"
        });
    }
});

module.exports = router;
