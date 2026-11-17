
const express = require("express");
const jwt = require("jsonwebtoken");
const crypto = require("crypto");

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
            resolve({ changes: this.changes, lastID: this.lastID });
        });
    });
}

function parseArray(value) {
    if (Array.isArray(value)) return value;

    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function hasOwn(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
}

function normalizeOptions(options) {
    if (!Array.isArray(options)) return null;

    const normalized = [];

    for (const option of options) {
        if (!option || typeof option !== "object" || Array.isArray(option)) {
            return null;
        }

        if (!Array.isArray(option.items)) return null;

        const title = String(option.title ?? option.title_ar ?? "").trim();

        if (!title) return null;

        const items = [];

        for (const item of option.items) {
            if (!item || typeof item !== "object" || Array.isArray(item)) {
                return null;
            }

            const name = String(item.name ?? item.name_ar ?? "").trim();
            const price = item.price === undefined ? 0 : Number(item.price);

            if (!name || !Number.isFinite(price) || price < 0) {
                return null;
            }

            items.push({
                id: item.id || crypto.randomUUID(),
                name,
                name_ar: String(item.name_ar ?? item.name ?? "").trim(),
                name_en: String(item.name_en ?? "").trim(),
                name_ru: String(item.name_ru ?? "").trim(),
                price
            });
        }

        normalized.push({
            id: option.id || crypto.randomUUID(),
            title,
            title_ar: String(option.title_ar ?? option.title ?? "").trim(),
            title_en: String(option.title_en ?? "").trim(),
            title_ru: String(option.title_ru ?? "").trim(),
            required: option.required === true,
            multi: option.multi === true,
            items
        });
    }

    return normalized;
}

async function getRestaurant(req, res) {
    const token = String(
        req.body?.token ||
        req.headers.authorization?.replace(/^Bearer\s+/i, "") ||
        ""
    ).trim();

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

    const restaurantId = decoded.restaurantId ?? decoded.id ?? decoded.userId;

    if (!restaurantId) {
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
        "SELECT name FROM pragma_table_info('restaurants') WHERE name = 'menu'"
    );

    if (!column) {
        res.status(500).json({
            success: false,
            message: "عمود menu غير موجود في جدول restaurants"
        });
        return null;
    }

    return restaurant;
}

function getItemLocation(categories, categoryId, itemId) {
    const category = categories.find(
        entry => String(entry.id) === String(categoryId)
    );

    if (!category) {
        return { error: "category" };
    }

    if (!Array.isArray(category.items)) {
        return { error: "items" };
    }

    const itemIndex = category.items.findIndex(
        item => String(item.id) === String(itemId)
    );

    if (itemIndex === -1) {
        return { error: "item" };
    }

    return {
        category,
        item: category.items[itemIndex],
        itemIndex
    };
}

function validateOptions(options) {
    if (!Array.isArray(options)) return false;

    for (const option of options) {
        if (!option.title) return false;

        for (const item of option.items) {
            if (
                !item.name ||
                !Number.isFinite(item.price) ||
                item.price < 0
            ) {
                return false;
            }
        }
    }

    return true;
}

router.post("/add-category", async (req, res) => {
    try {
        const name_ar = String(req.body.name_ar || "").trim();
        const name_en = String(req.body.name_en || "").trim();
        const name_ru = String(req.body.name_ru || "").trim();

        if (!name_ar) {
            return res.status(400).json({
                success: false,
                message: "اسم القسم بالعربية مطلوب"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);

        const duplicate = categories.some(category =>
            String(category.name_ar || "").trim().toLowerCase() ===
            name_ar.toLowerCase()
        );

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: "يوجد قسم بهذا الاسم بالفعل"
            });
        }

        const categoryId = categories.reduce((max, category) => {
            const id = Number(category.id);
            return Number.isSafeInteger(id) ? Math.max(max, id) : max;
        }, 0) + 1;

        const newCategory = {
            id: categoryId,
            name_ar,
            name_en,
            name_ru,
            items: []
        };

        categories.push(newCategory);

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.status(201).json({
            success: true,
            message: "تمت إضافة القسم بنجاح",
            category: newCategory,
            categories
        });
    } catch (error) {
        console.error("Add Category Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إضافة القسم"
        });
    }
});


const multer = require("multer");
const fs = require("fs");
const axios = require("axios");

const API_KEY = "cd3664692e0290e136732602b869ba5e";

const upload = multer({
    dest: "uploads/",
    limits: {
        fileSize: 5 * 1024 * 1024
    },
    fileFilter: (req, file, cb) => {
        if (!file.mimetype.startsWith("image/")) {
            return cb(new Error("يجب رفع ملف صورة فقط"));
        }

        cb(null, true);
    }
});

async function uploadImage(filePath, expiration = 0) {
    const image = await fs.promises.readFile(filePath);
    const base64Image = image.toString("base64");

    const formData = new URLSearchParams();

    formData.append("key", API_KEY);
    formData.append("image", base64Image);

    if (expiration) {
        formData.append("expiration", String(expiration));
    }

    const response = await axios.post(
        "https://api.imgbb.com/1/upload",
        formData,
        {
            headers: {
                "Content-Type": "application/x-www-form-urlencoded"
            }
        }
    );

    if (response.data?.success) {
        return response.data.data.url;
    }

    throw new Error(
        response.data?.error?.message || "Image upload failed"
    );
}

router.post("/add-item", upload.single("image"), async (req, res) => {
    const uploadedFilePath = req.file?.path;

    try {
        const categoryId = String(req.body.categoryId ?? "").trim();
        const name_ar = String(req.body.name_ar || "").trim();
        const name_en = String(req.body.name_en || "").trim();
        const name_ru = String(req.body.name_ru || "").trim();
        const description_ar = String(req.body.description_ar || "").trim();
        const description_en = String(req.body.description_en || "").trim();
        const description_ru = String(req.body.description_ru || "").trim();

        const price = Number(req.body.price);

        const is_available = req.body.is_available === undefined
            ? true
            : req.body.is_available;

        if (!categoryId) {
            return res.status(400).json({
                success: false,
                message: "معرّف القسم مطلوب"
            });
        }

        if (!name_ar) {
            return res.status(400).json({
                success: false,
                message: "اسم الصنف بالعربية مطلوب"
            });
        }

        if (!Number.isFinite(price) || price < 0) {
            return res.status(400).json({
                success: false,
                message: "سعر الصنف غير صالح"
            });
        }

        if (typeof is_available !== "boolean") {
            return res.status(400).json({
                success: false,
                message: "قيمة is_available يجب أن تكون true أو false"
            });
        }

        if (
            req.body.options !== undefined &&
            !Array.isArray(req.body.options)
        ) {
            return res.status(400).json({
                success: false,
                message: "الخيارات يجب أن تكون مصفوفة"
            });
        }

        const restaurant = await getRestaurant(req, res);

        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);

        const category = categories.find(
            entry => String(entry.id) === categoryId
        );

        if (!category) {
            return res.status(404).json({
                success: false,
                message: "القسم غير موجود"
            });
        }

        if (!Array.isArray(category.items)) {
            category.items = [];
        }

        const duplicate = category.items.some(item =>
            String(item.name_ar || "").trim().toLowerCase() ===
            name_ar.toLowerCase()
        );

        if (duplicate) {
            return res.status(409).json({
                success: false,
                message: "يوجد صنف بهذا الاسم داخل القسم بالفعل"
            });
        }

        const options = normalizeOptions(req.body.options || []);

        if (!options || !validateOptions(options)) {
            return res.status(400).json({
                success: false,
                message: "بيانات الخيارات غير صالحة"
            });
        }

        let image = "";

        if (req.file) {
            image = await uploadImage(req.file.path);
        } else if (req.body.image) {
            image = String(req.body.image).trim();

            try {
                const parsedUrl = new URL(image);

                if (
                    parsedUrl.protocol !== "https:" &&
                    parsedUrl.protocol !== "http:"
                ) {
                    throw new Error("Invalid image URL");
                }
            } catch {
                return res.status(400).json({
                    success: false,
                    message: "رابط الصورة غير صالح"
                });
            }
        }

        const numericIds = category.items
            .map(item => Number(item.id))
            .filter(id => Number.isSafeInteger(id) && id > 0);

        const itemId = numericIds.length
            ? Math.max(...numericIds) + 1
            : 1;

        const newItem = {
            id: itemId,
            name_ar,
            name_en,
            name_ru,
            description_ar,
            description_en,
            description_ru,
            price,
            image,
            is_available,
            options
        };

        category.items.push(newItem);

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.status(201).json({
            success: true,
            message: "تمت إضافة الصنف بنجاح",
            item: newItem,
            category,
            categories
        });

    } catch (error) {
        console.error("Add Item Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء إضافة الصنف"
        });

    } finally {
        if (uploadedFilePath) {
            await fs.promises.unlink(uploadedFilePath).catch(() => {});
        }
    }
});

router.patch("/make-item-unavailable", async (req, res) => {
    try {
        const categoryId = String(req.body?.categoryId ?? "").trim();
        const itemId = String(req.body?.itemId ?? "").trim();

        if (!categoryId || !itemId) {
            return res.status(400).json({
                success: false,
                message: "معرّف القسم ومعرّف الصنف مطلوبان"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);
        const result = getItemLocation(categories, categoryId, itemId);

        if (result.error === "category") {
            return res.status(404).json({
                success: false,
                message: "القسم غير موجود"
            });
        }

        if (result.error === "items") {
            return res.status(500).json({
                success: false,
                message: "قائمة الأصناف في هذا القسم غير صالحة"
            });
        }

        if (result.error === "item") {
            return res.status(404).json({
                success: false,
                message: "الصنف غير موجود في هذا القسم"
            });
        }

        result.item.is_available = false;

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم جعل الصنف غير متاح بنجاح",
            item: result.item,
            category: result.category
        });
    } catch (error) {
        console.error("Make Item Unavailable Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تغيير حالة الصنف"
        });
    }
});

router.put("/edit-item", async (req, res) => {
    try {
        const categoryId = String(req.body?.categoryId ?? "").trim();
        const itemId = String(req.body?.itemId ?? "").trim();

        if (!categoryId || !itemId) {
            return res.status(400).json({
                success: false,
                message: "معرّف القسم ومعرّف الصنف مطلوبان"
            });
        }

        const allowedFields = [
            "name_ar",
            "name_en",
            "name_ru",
            "description_ar",
            "description_en",
            "description_ru",
            "price",
            "image",
            "is_available",
            "options"
        ];

        const fieldsToUpdate = allowedFields.filter(field =>
            hasOwn(req.body, field)
        );

        if (fieldsToUpdate.length === 0) {
            return res.status(400).json({
                success: false,
                message: "أرسل حقلًا واحدًا على الأقل لتعديله"
            });
        }

        for (const field of [
            "name_ar",
            "name_en",
            "name_ru",
            "description_ar",
            "description_en",
            "description_ru",
            "image"
        ]) {
            if (hasOwn(req.body, field) && typeof req.body[field] !== "string") {
                return res.status(400).json({
                    success: false,
                    message: `قيمة ${field} يجب أن تكون نصًا`
                });
            }
        }

        if (hasOwn(req.body, "price")) {
            const price = Number(req.body.price);

            if (!Number.isFinite(price) || price < 0) {
                return res.status(400).json({
                    success: false,
                    message: "سعر الصنف غير صالح"
                });
            }
        }

        if (
            hasOwn(req.body, "is_available") &&
            typeof req.body.is_available !== "boolean"
        ) {
            return res.status(400).json({
                success: false,
                message: "قيمة is_available يجب أن تكون true أو false"
            });
        }

        if (
            hasOwn(req.body, "options") &&
            !Array.isArray(req.body.options)
        ) {
            return res.status(400).json({
                success: false,
                message: "الخيارات يجب أن تكون مصفوفة"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);
        const result = getItemLocation(categories, categoryId, itemId);

        if (result.error === "category") {
            return res.status(404).json({
                success: false,
                message: "القسم غير موجود"
            });
        }

        if (result.error === "items") {
            return res.status(500).json({
                success: false,
                message: "قائمة الأصناف في هذا القسم غير صالحة"
            });
        }

        if (result.error === "item") {
            return res.status(404).json({
                success: false,
                message: "الصنف غير موجود في هذا القسم"
            });
        }

        const item = result.item;

        if (hasOwn(req.body, "name_ar")) {
            const newName = req.body.name_ar.trim();

            if (!newName) {
                return res.status(400).json({
                    success: false,
                    message: "اسم الصنف بالعربية لا يمكن أن يكون فارغًا"
                });
            }

            const duplicate = result.category.items.some(other =>
                String(other.id) !== itemId &&
                String(other.name_ar || "").trim().toLowerCase() ===
                newName.toLowerCase()
            );

            if (duplicate) {
                return res.status(409).json({
                    success: false,
                    message: "يوجد صنف آخر بهذا الاسم داخل القسم"
                });
            }
        }

        for (const field of [
            "name_ar",
            "name_en",
            "name_ru",
            "description_ar",
            "description_en",
            "description_ru",
            "image"
        ]) {
            if (hasOwn(req.body, field)) {
                item[field] = req.body[field].trim();
            }
        }

        if (hasOwn(req.body, "price")) {
            item.price = Number(req.body.price);
        }

        if (hasOwn(req.body, "is_available")) {
            item.is_available = req.body.is_available;
        }

        if (hasOwn(req.body, "options")) {
            const options = normalizeOptions(req.body.options);

            if (!options || !validateOptions(options)) {
                return res.status(400).json({
                    success: false,
                    message: "بيانات الخيارات غير صالحة"
                });
            }

            item.options = options;
        }

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم تعديل الصنف بنجاح",
            item,
            category: result.category
        });
    } catch (error) {
        console.error("Edit Item Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء تعديل الصنف"
        });
    }
});

router.delete("/delete-category", async (req, res) => {
    try {
        const categoryId = String(
            req.body?.categoryId ?? req.query.categoryId ?? ""
        ).trim();

        if (!categoryId) {
            return res.status(400).json({
                success: false,
                message: "معرّف القسم مطلوب"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);

        const categoryIndex = categories.findIndex(
            category => String(category.id) === categoryId
        );

        if (categoryIndex === -1) {
            return res.status(404).json({
                success: false,
                message: "القسم غير موجود"
            });
        }

        const deletedCategory = categories[categoryIndex];
        categories.splice(categoryIndex, 1);

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم حذف القسم وجميع أصنافه بنجاح",
            deletedCategory,
            categories
        });
    } catch (error) {
        console.error("Delete Category Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء حذف القسم"
        });
    }
});

router.delete("/delete-item", async (req, res) => {
    try {
        const categoryId = String(
            req.body?.categoryId ?? req.query.categoryId ?? ""
        ).trim();

        const itemId = String(
            req.body?.itemId ?? req.query.itemId ?? ""
        ).trim();

        if (!categoryId || !itemId) {
            return res.status(400).json({
                success: false,
                message: "معرّف القسم ومعرّف الصنف مطلوبان"
            });
        }

        const restaurant = await getRestaurant(req, res);
        if (!restaurant) return;

        const categories = parseArray(restaurant.menu);
        const result = getItemLocation(categories, categoryId, itemId);

        if (result.error === "category") {
            return res.status(404).json({
                success: false,
                message: "القسم غير موجود"
            });
        }

        if (result.error === "items") {
            return res.status(500).json({
                success: false,
                message: "قائمة الأصناف في هذا القسم غير صالحة"
            });
        }

        if (result.error === "item") {
            return res.status(404).json({
                success: false,
                message: "الصنف غير موجود في هذا القسم"
            });
        }

        const deletedItem = result.item;
        result.category.items.splice(result.itemIndex, 1);

        await dbRun(
            "UPDATE restaurants SET menu = ? WHERE id = ?",
            [JSON.stringify(categories), restaurant.id]
        );

        return res.json({
            success: true,
            message: "تم حذف الصنف بنجاح",
            deletedItem,
            category: result.category,
            categories
        });
    } catch (error) {
        console.error("Delete Item Error:", error);

        return res.status(500).json({
            success: false,
            message: "حدث خطأ أثناء حذف الصنف"
        });
    }
});

module.exports = router;
