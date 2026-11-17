const express = require("express");
const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const router = express.Router();

const { db: restaurantsDb } = require("../mydb/restaurants");
const { db: usersDb } = require("../mydb/users");
const { db: discountCodesDb } = require("../mydb/discount_codes");

const JWT_SECRET = "secretkey";

function dbGet(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) return reject(err);
            resolve(row || null);
        });
    });
}

function dbAll(db, sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) return reject(err);
            resolve(rows || []);
        });
    });
}

function dbRun(db, sql, params = []) {
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

function normalizeCouponCode(value) {
    return typeof value === "string"
        ? value.trim().toUpperCase()
        : "";
}

function validAmount(value) {
    return typeof value === "number" &&
        Number.isFinite(value) &&
        value >= 0;
}

function roundMoney(value) {
    return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getProductId(product) {
    return product?.id ?? product?.productId;
}

function findProduct(menu, productId) {
    for (const section of menu) {
        if (!section || typeof section !== "object") continue;

        if (Array.isArray(section.items)) {
            const found = section.items.find(
                item =>
                    item &&
                    String(getProductId(item)) === String(productId)
            );

            if (found) return found;
        }
    }

    return menu.find(
        item =>
            item &&
            !Array.isArray(item.items) &&
            String(getProductId(item)) === String(productId)
    ) || null;
}

function getGroupName(group) {
    return normalizeText(
        group?.title ??
        group?.name ??
        group?.label ??
        group?.groupName
    );
}

function getOptionName(option) {
    return normalizeText(
        option?.name ??
        option?.title ??
        option?.label
    );
}

function normalizeProductOptions(product, selectedOptions) {
    if (
        selectedOptions !== undefined &&
        !Array.isArray(selectedOptions)
    ) {
        return {
            error: "خيارات أحد المنتجات غير صحيحة"
        };
    }

    const selections = Array.isArray(selectedOptions)
        ? selectedOptions
        : [];

    const sourceGroups = Array.isArray(product.options)
        ? product.options
        : [];

    const normalizedGroups = [];
    const usedGroups = new Set();

    let optionsUnitPrice = 0;

    for (const selectedGroup of selections) {
        if (
            !selectedGroup ||
            typeof selectedGroup !== "object" ||
            Array.isArray(selectedGroup)
        ) {
            return {
                error: "صيغة مجموعة الخيارات غير صحيحة"
            };
        }

        const selectedGroupName = getGroupName(selectedGroup);

        let groupIndex = -1;

        if (
            selectedGroup.id !== undefined &&
            selectedGroup.id !== null
        ) {
            groupIndex = sourceGroups.findIndex(
                group =>
                    group &&
                    group.id !== undefined &&
                    group.id !== null &&
                    String(group.id) === String(selectedGroup.id)
            );
        }

        if (groupIndex === -1 && selectedGroupName) {
            groupIndex = sourceGroups.findIndex(
                group =>
                    getGroupName(group) === selectedGroupName
            );
        }

        if (groupIndex === -1) {
            return {
                error: "مجموعة الخيارات المرسلة لا تطابق خيارات المنتج"
            };
        }

        if (usedGroups.has(groupIndex)) {
            return {
                error: "تم إرسال مجموعة الخيارات أكثر من مرة"
            };
        }

        usedGroups.add(groupIndex);

        const sourceGroup = sourceGroups[groupIndex];

        const sourceOptions = Array.isArray(sourceGroup.items)
            ? sourceGroup.items
            : [];

        const selectedItems = Array.isArray(selectedGroup.items)
            ? selectedGroup.items
            : [];

        const groupName = String(
            sourceGroup.title ||
            sourceGroup.name ||
            sourceGroup.label ||
            ""
        );

        if (
            sourceGroup.required === true &&
            selectedItems.length === 0
        ) {
            return {
                error: `يجب اختيار خيار من مجموعة ${groupName}`
            };
        }

        if (
            sourceGroup.multi === false &&
            selectedItems.length > 1
        ) {
            return {
                error: `يمكن اختيار خيار واحد فقط من مجموعة ${groupName}`
            };
        }

        const normalizedSelectedOptions = [];
        const usedOptions = new Set();

        for (const selectedOption of selectedItems) {
            if (
                !selectedOption ||
                typeof selectedOption !== "object" ||
                Array.isArray(selectedOption)
            ) {
                return {
                    error: "أحد الخيارات المحددة غير صحيح"
                };
            }

            let foundOption = null;

            if (
                selectedOption.id !== undefined &&
                selectedOption.id !== null
            ) {
                foundOption = sourceOptions.find(
                    option =>
                        option &&
                        option.id !== undefined &&
                        option.id !== null &&
                        String(option.id) === String(selectedOption.id)
                ) || null;
            }

            if (!foundOption) {
                const selectedName = getOptionName(selectedOption);

                if (selectedName) {
                    foundOption = sourceOptions.find(
                        option =>
                            getOptionName(option) === selectedName
                    ) || null;
                }
            }

            if (!foundOption) {
                return {
                    error: "أحد الخيارات المحددة غير موجود في قائمة المطعم"
                };
            }

            const optionKey =
                foundOption.id !== undefined &&
                foundOption.id !== null
                    ? `id:${String(foundOption.id)}`
                    : `name:${getOptionName(foundOption)}`;

            if (usedOptions.has(optionKey)) {
                return {
                    error: "لا يمكن اختيار الخيار نفسه أكثر من مرة"
                };
            }

            usedOptions.add(optionKey);

            const optionPrice = Number(foundOption.price ?? 0);

            if (!validAmount(optionPrice)) {
                return {
                    error: "سعر أحد خيارات المنتج غير صحيح"
                };
            }

            normalizedSelectedOptions.push({
                name: String(
                    foundOption.name ||
                    foundOption.title ||
                    foundOption.label ||
                    ""
                ),
                price: optionPrice
            });

            optionsUnitPrice += optionPrice;
        }

        normalizedGroups.push({
            title: groupName,
            items: normalizedSelectedOptions
        });
    }

    for (let i = 0; i < sourceGroups.length; i++) {
        if (
            sourceGroups[i]?.required === true &&
            !usedGroups.has(i)
        ) {
            const groupName = String(
                sourceGroups[i].title ||
                sourceGroups[i].name ||
                sourceGroups[i].label ||
                ""
            );

            return {
                error: `يجب اختيار خيار من مجموعة ${groupName}`
            };
        }
    }

    return {
        options: normalizedGroups,
        optionsUnitPrice: roundMoney(optionsUnitPrice)
    };
}

function getApplicableIds(coupon) {
    return parseArray(coupon.applicable_ids).map(String);
}

function couponAppliesToOrder(
    coupon,
    restaurantId,
    items,
    menu
) {
    const type = normalizeText(coupon.applicable_to || "all");
    const ids = getApplicableIds(coupon);

    if (type === "all") return true;

    if (!ids.length) return false;

    if (["restaurant", "restaurants"].includes(type)) {
        return ids.includes(String(restaurantId));
    }

    if (["product", "products"].includes(type)) {
        return items.some(
            item => ids.includes(String(item.productId))
        );
    }

    if (["category", "categories"].includes(type)) {
        return items.some(item => {
            const product = findProduct(menu, item.productId);

            const categoryId =
                product?.categoryId ??
                product?.category_id ??
                product?.category?.id;

            return categoryId !== undefined &&
                categoryId !== null &&
                ids.includes(String(categoryId));
        });
    }

    return false;
}

async function hasPreviousOrder(userId) {
    const rows = await dbAll(
        restaurantsDb,
        "SELECT orders FROM restaurants"
    );

    for (const row of rows) {
        const orders = parseArray(row.orders);

        if (
            orders.some(order => {
                const status = normalizeText(order?.orderStatus);

                return String(order?.customer?.userId) ===
                    String(userId) &&
                    ![
                        "cancelled",
                        "canceled",
                        "rejected"
                    ].includes(status);
            })
        ) {
            return true;
        }
    }

    return false;
}

async function getAuthenticatedUser(req) {
    const authorization = req.headers?.authorization;
    const bodyToken = req.body?.token;

    const token =
        typeof authorization === "string" &&
        authorization.startsWith("Bearer ")
            ? authorization.slice(7).trim()
            : bodyToken;

    if (typeof token !== "string" || !token) {
        const error = new Error("التوكين مطلوب");
        error.status = 401;
        throw error;
    }

    let decoded;

    try {
        decoded = jwt.verify(token, JWT_SECRET);
    } catch {
        const error = new Error(
            "التوكين غير صالح أو منتهي الصلاحية"
        );

        error.status = 401;
        throw error;
    }

    const userId = decoded.userId ?? decoded.id;

    if (userId === undefined || userId === null) {
        const error = new Error(
            "التوكين لا يحتوي على معرّف المستخدم"
        );

        error.status = 401;
        throw error;
    }

    const user = await dbGet(
        usersDb,
        "SELECT * FROM users WHERE id = ?",
        [String(userId)]
    );

    if (!user) {
        const error = new Error("حساب المستخدم غير موجود");
        error.status = 401;
        throw error;
    }

    if (
        !["user", "customer"].includes(
            normalizeText(user.account_type)
        )
    ) {
        const error = new Error(
            "هذا الحساب غير مصرح له بإرسال الطلبات"
        );

        error.status = 403;
        throw error;
    }

    if (normalizeText(user.account_status) !== "active") {
        const error = new Error("الحساب غير نشط");
        error.status = 403;
        throw error;
    }

    return user;
}

async function buildOrderItems(menu, items) {
    if (!Array.isArray(items) || items.length === 0) {
        return {
            error: "يجب إضافة منتج واحد على الأقل"
        };
    }

    const normalizedItems = [];
    let subtotal = 0;

    for (const item of items) {
        if (
            !item ||
            item.productId === undefined ||
            item.productId === null ||
            !Number.isSafeInteger(item.qty) ||
            item.qty < 1 ||
            item.qty > 1000
        ) {
            return {
                error: "بيانات أحد المنتجات غير صحيحة"
            };
        }

        const product = findProduct(menu, item.productId);

        if (!product) {
            return {
                error: `المنتج غير موجود في قائمة المطعم: ${item.productId}`
            };
        }

        if (
            product.is_available === false ||
            Number(product.is_available) === 0
        ) {
            return {
                error: `المنتج غير متاح حاليًا: ${
                    product.name_ar ||
                    product.name ||
                    item.productId
                }`
            };
        }

        const unitPrice = Number(product.price);

        if (!validAmount(unitPrice)) {
            return {
                error: "سعر المنتج في قاعدة البيانات غير صحيح"
            };
        }

        const optionResult = normalizeProductOptions(
            product,
            item.options
        );

        if (optionResult.error) {
            return optionResult;
        }

        const finalUnitPrice = roundMoney(
            unitPrice + optionResult.optionsUnitPrice
        );

        const itemTotal = roundMoney(
            finalUnitPrice * item.qty
        );

        normalizedItems.push({
            productId: String(getProductId(product)),
            productName: String(
                product.name_ar ||
                product.name ||
                product.productName ||
                ""
            ),
            productImage: String(
                product.image ||
                product.productImage ||
                ""
            ),
            unitPrice: finalUnitPrice,
            qty: item.qty,
            total: itemTotal,
            isGift: item.isGift === true,
            options: optionResult.options
        });

        subtotal += itemTotal;
    }

    return {
        items: normalizedItems,
        subtotal: roundMoney(subtotal)
    };
}

async function validateCoupon({
    code,
    userId,
    restaurantId,
    items,
    menu,
    subtotal,
    currency,
    deliveryFee
}) {
    const normalizedCode = normalizeCouponCode(code);

    if (!normalizedCode) {
        return {
            valid: true,
            coupon: null,
            discount: 0,
            freeDelivery: false,
            deliveryDiscount: 0
        };
    }

    const coupon = await dbGet(
        discountCodesDb,
        `SELECT *
         FROM discount_codes
         WHERE UPPER(TRIM(code)) = ?
         LIMIT 1`,
        [normalizedCode]
    );

    if (!coupon || Number(coupon.is_active) !== 1) {
        return {
            valid: false,
            message: "كود الخصم غير صحيح أو غير فعال"
        };
    }

    const now = Date.now();

    if (coupon.starts_at) {
        const start = Date.parse(coupon.starts_at);

        if (!Number.isFinite(start)) {
            return {
                valid: false,
                message: "تاريخ بداية كود الخصم غير صحيح"
            };
        }

        if (now < start) {
            return {
                valid: false,
                message: "لم يبدأ تفعيل كود الخصم بعد"
            };
        }
    }

    if (coupon.expires_at) {
        const end = Date.parse(coupon.expires_at);

        if (!Number.isFinite(end)) {
            return {
                valid: false,
                message: "تاريخ انتهاء كود الخصم غير صحيح"
            };
        }

        if (now > end) {
            return {
                valid: false,
                message: "انتهت صلاحية كود الخصم"
            };
        }
    }

    if (
        normalizeText(coupon.currency || "EGP") !==
        normalizeText(currency || "EGP")
    ) {
        return {
            valid: false,
            message: "عملة كود الخصم غير متوافقة مع الطلب"
        };
    }

    if (
        normalizeText(coupon.target_type) === "specific_user" &&
        String(coupon.target_user_id) !== String(userId)
    ) {
        return {
            valid: false,
            message: "كود الخصم غير مخصص لحسابك"
        };
    }

    const minimum = Number(coupon.min_order_amount ?? 0);

    if (!validAmount(minimum)) {
        return {
            valid: false,
            message: "الحد الأدنى لكود الخصم غير صحيح"
        };
    }

    if (subtotal < minimum) {
        return {
            valid: false,
            message: "قيمة الطلب أقل من الحد الأدنى لاستخدام الكود"
        };
    }

    if (
        coupon.usage_limit !== null &&
        coupon.usage_limit !== undefined
    ) {
        const usageLimit = Number(coupon.usage_limit);
        const usageCount = Number(coupon.usage_count ?? 0);

        if (
            !Number.isSafeInteger(usageLimit) ||
            usageLimit < 0 ||
            !Number.isSafeInteger(usageCount) ||
            usageCount < 0
        ) {
            return {
                valid: false,
                message: "بيانات عدد استخدامات الكوبون غير صحيحة"
            };
        }

        if (usageCount >= usageLimit) {
            return {
                valid: false,
                message: "تم استنفاد مرات استخدام كود الخصم"
            };
        }
    }

    const usagePerUser = Number(coupon.usage_per_user ?? 1);

    if (
        !Number.isSafeInteger(usagePerUser) ||
        usagePerUser < 1
    ) {
        return {
            valid: false,
            message: "حد استخدام الكوبون غير صحيح"
        };
    }

    const previousUsage = await dbGet(
        discountCodesDb,
        `SELECT COUNT(*) AS count
         FROM discount_code_usages
         WHERE discount_code_id = ?
           AND user_id = ?
           AND status IN ('reserved', 'applied')`,
        [coupon.id, String(userId)]
    );

    if (
        Number(previousUsage?.count || 0) >= usagePerUser
    ) {
        return {
            valid: false,
            message: "لقد وصلت إلى الحد المسموح لاستخدام كود الخصم"
        };
    }

    if (
        Number(coupon.first_order_only) === 1 &&
        await hasPreviousOrder(userId)
    ) {
        return {
            valid: false,
            message: "كود الخصم متاح لأول طلب فقط"
        };
    }

    if (
        !couponAppliesToOrder(
            coupon,
            restaurantId,
            items,
            menu
        )
    ) {
        return {
            valid: false,
            message: "كود الخصم غير متاح لهذا المطعم أو المنتجات"
        };
    }

    const discountType = normalizeText(coupon.discount_type);
    const discountValue = Number(coupon.discount_value);

    if (!validAmount(discountValue)) {
        return {
            valid: false,
            message: "قيمة كود الخصم غير صحيحة"
        };
    }

    let discount = 0;
    let freeDelivery = false;
    let deliveryDiscount = 0;

    if (discountType === "percentage") {
        if (discountValue > 100) {
            return {
                valid: false,
                message: "نسبة الخصم غير صحيحة"
            };
        }

        discount = subtotal * discountValue / 100;

        if (
            coupon.max_discount_amount !== null &&
            coupon.max_discount_amount !== undefined
        ) {
            const maxDiscount = Number(
                coupon.max_discount_amount
            );

            if (!validAmount(maxDiscount)) {
                return {
                    valid: false,
                    message: "الحد الأقصى للخصم غير صحيح"
                };
            }

            discount = Math.min(discount, maxDiscount);
        }
    } else if (discountType === "fixed") {
        discount = discountValue;
    } else if (discountType === "free_delivery") {
        freeDelivery = true;
        deliveryDiscount = roundMoney(deliveryFee);
    } else {
        return {
            valid: false,
            message: "نوع كود الخصم غير مدعوم"
        };
    }

    discount = roundMoney(
        Math.min(discount, subtotal)
    );

    return {
        valid: true,
        coupon,
        discount,
        freeDelivery,
        deliveryDiscount
    };
}

async function getOrderContext(req, bodyOverride = req.body || {}) {
    const user = await getAuthenticatedUser({
        headers: req.headers,
        body: bodyOverride
    });

    const body = bodyOverride;

    const restaurantId = Number(
        body.restaurant?.restaurantId ??
        body.restaurantId
    );

    if (
        !Number.isSafeInteger(restaurantId) ||
        restaurantId <= 0
    ) {
        const error = new Error("معرّف المطعم غير صحيح");
        error.status = 400;
        throw error;
    }

    const restaurant = await dbGet(
        restaurantsDb,
        "SELECT * FROM restaurants WHERE id = ?",
        [restaurantId]
    );

    if (!restaurant) {
        const error = new Error("المطعم غير موجود");
        error.status = 404;
        throw error;
    }

    if (
        normalizeText(restaurant.account_status) !== "active" ||
        Number(restaurant.is_open) !== 1 ||
        Number(restaurant.is_accepting_orders) !== 1
    ) {
        const error = new Error(
            "المطعم لا يستقبل الطلبات حاليًا"
        );

        error.status = 400;
        throw error;
    }

    const menu = parseArray(restaurant.menu);

    const orderItems = await buildOrderItems(
        menu,
        body.items
    );

    if (orderItems.error) {
        const error = new Error(orderItems.error);
        error.status = 400;
        throw error;
    }

    const minimumOrder = Number(
        restaurant.minimum_order ?? 0
    );

    if (!validAmount(minimumOrder)) {
        const error = new Error(
            "الحد الأدنى للطلب غير صحيح"
        );

        error.status = 500;
        throw error;
    }

    if (orderItems.subtotal < minimumOrder) {
        const error = new Error(
            "الطلب أقل من الحد الأدنى للمطعم"
        );

        error.status = 400;
        throw error;
    }

    const pricing = body.pricing || {};
    const currency = String(pricing.currency || "EGP");

    const deliveryFee = Number(
        pricing.deliveryFee ??
        restaurant.delivery_fee ??
        0
    );

    if (!validAmount(deliveryFee)) {
        const error = new Error(
            "رسوم التوصيل غير صحيحة"
        );

        error.status = 400;
        throw error;
    }

    const code =
        pricing.couponCode ??
        body.couponCode ??
        "";

    const couponResult = await validateCoupon({
        code,
        userId: user.id,
        restaurantId,
        items: orderItems.items,
        menu,
        subtotal: orderItems.subtotal,
        currency,
        deliveryFee
    });

    if (!couponResult.valid) {
        const error = new Error(couponResult.message);
        error.status = 400;
        throw error;
    }

    return {
        user,
        body,
        restaurant,
        restaurantId,
        menu,
        items: orderItems.items,
        subtotal: orderItems.subtotal,
        pricing,
        currency,
        originalDeliveryFee: roundMoney(deliveryFee),
        deliveryFee: couponResult.freeDelivery
            ? 0
            : roundMoney(deliveryFee),
        couponResult
    };
}

router.post("/validate-coupon", async (req, res) => {
    try {
        const body = req.body || {};

        const couponCode =
            body.couponCode ??
            body.code ??
            body.pricing?.couponCode;

        if (
            typeof couponCode !== "string" ||
            !couponCode.trim()
        ) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: "أدخل كود الخصم"
            });
        }

        const context = await getOrderContext(req, {
            ...body,
            pricing: {
                ...(body.pricing || {}),
                couponCode: couponCode.trim()
            }
        });

        const couponResult = context.couponResult;
        const pricing = context.pricing;

        const vat = Number(pricing.vat ?? 0);
        const processingFee = Number(
            pricing.processingFee ?? 0
        );
        const tip = Number(pricing.tip ?? 0);

        if (
            ![vat, processingFee, tip].every(validAmount)
        ) {
            return res.status(400).json({
                success: false,
                valid: false,
                message: "بيانات الرسوم والضرائب غير صحيحة"
            });
        }

        const total = roundMoney(
            context.subtotal +
            context.deliveryFee +
            vat +
            processingFee +
            tip -
            couponResult.discount
        );

        return res.status(200).json({
            success: true,
            valid: true,
            message: "كود الخصم صالح",
            coupon: {
                code: couponResult.coupon?.code || null,
                name: couponResult.coupon?.name || "",
                discountType:
                    couponResult.coupon?.discount_type || null,
                discountValue: Number(
                    couponResult.coupon?.discount_value || 0
                )
            },
            pricing: {
                currency: context.currency,
                subtotal: context.subtotal,
                originalDeliveryFee:
                    context.originalDeliveryFee,
                deliveryFee: context.deliveryFee,
                discount: couponResult.discount,
                freeDeliveryDiscount:
                    couponResult.deliveryDiscount,
                vat,
                processingFee,
                tip,
                total
            }
        });
    } catch (err) {
        console.error(
            "Validate Coupon Error:",
            err.stack || err
        );

        return res.status(err.status || 500).json({
            success: false,
            valid: false,
            message: err.status
                ? err.message
                : "حدث خطأ أثناء التحقق من كود الخصم"
        });
    }
});

router.post("/send-order", async (req, res) => {
    let savedOrder = null;
    let savedRestaurantId = null;
    let savedCouponUsageId = null;
    let savedCouponId = null;
    let couponCountIncremented = false;

    try {
        const context = await getOrderContext(req);

        const {
            user,
            body,
            restaurant,
            restaurantId,
            items,
            subtotal,
            pricing,
            currency,
            originalDeliveryFee,
            deliveryFee,
            couponResult
        } = context;

        const payment = body.payment;
        const delivery = body.delivery || {};
        const deliveryAddress = delivery.address || {};

        if (!payment?.method) {
            return res.status(400).json({
                success: false,
                message: "طريقة الدفع مطلوبة"
            });
        }

        if (
            deliveryAddress.latitude !== undefined &&
            deliveryAddress.latitude !== null &&
            (
                !Number.isFinite(
                    Number(deliveryAddress.latitude)
                ) ||
                Number(deliveryAddress.latitude) < -90 ||
                Number(deliveryAddress.latitude) > 90
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "خط العرض غير صحيح"
            });
        }

        if (
            deliveryAddress.longitude !== undefined &&
            deliveryAddress.longitude !== null &&
            (
                !Number.isFinite(
                    Number(deliveryAddress.longitude)
                ) ||
                Number(deliveryAddress.longitude) < -180 ||
                Number(deliveryAddress.longitude) > 180
            )
        ) {
            return res.status(400).json({
                success: false,
                message: "خط الطول غير صحيح"
            });
        }

        const vat = Number(pricing.vat ?? 0);
        const processingFee = Number(
            pricing.processingFee ?? 0
        );
        const tip = Number(pricing.tip ?? 0);

        if (
            ![vat, processingFee, tip].every(validAmount)
        ) {
            return res.status(400).json({
                success: false,
                message: "بيانات الرسوم والضرائب غير صحيحة"
            });
        }

        const discount = couponResult.discount;

        const total = roundMoney(
            subtotal +
            deliveryFee +
            vat +
            processingFee +
            tip -
            discount
        );

        if (!validAmount(total)) {
            return res.status(400).json({
                success: false,
                message: "إجمالي الطلب غير صحيح"
            });
        }

        const salesCommissionRate = Number(
            restaurant.sales_commission ?? 0
        );

        const deliveryCommissionRate = Number(
            restaurant.delivery_commission ?? 0
        );

        if (
            !Number.isFinite(salesCommissionRate) ||
            salesCommissionRate < 0 ||
            salesCommissionRate > 100 ||
            !Number.isFinite(deliveryCommissionRate) ||
            deliveryCommissionRate < 0 ||
            deliveryCommissionRate > 100
        ) {
            return res.status(500).json({
                success: false,
                message: "نسب العمولات غير صحيحة"
            });
        }

        const salesCommissionAmount = roundMoney(
            subtotal * salesCommissionRate / 100
        );

        const restaurantProductsNet = roundMoney(
            subtotal -
            salesCommissionAmount -
            discount
        );

        const deliveryCommissionAmount = roundMoney(
            deliveryFee *
            deliveryCommissionRate /
            100
        );

        const restaurantDeliveryNet = roundMoney(
            deliveryFee - deliveryCommissionAmount
        );

        const appTotalEarnings = roundMoney(
            salesCommissionAmount +
            deliveryCommissionAmount +
            processingFee
        );

        const restaurantTotalDue = roundMoney(
            restaurantProductsNet +
            restaurantDeliveryNet
        );

        if (
            restaurantProductsNet < 0 ||
            restaurantTotalDue < 0
        ) {
            return res.status(400).json({
                success: false,
                message: "قيمة الخصم تتجاوز مستحقات المطعم"
            });
        }

        const isCashPayment =
            normalizeText(payment.method) === "cash";

        const now = new Date().toISOString();

        const order = {
            id: crypto.randomUUID(),
            orderNumber: String(
                crypto.randomInt(100000, 1000000)
            ),
            orderStatus: "pending",
            createdAt: now,
            updatedAt: now,
            customer: {
                userId: String(user.id),
                name: String(
                    user.name ||
                    user.display_name ||
                    [
                        user.first_name,
                        user.second_name,
                        user.third_name,
                        user.last_name
                    ].filter(Boolean).join(" ") ||
                    ""
                ),
                phone: String(
                    user.phone_number ||
                    user.phone ||
                    ""
                ),
                email: String(user.email || ""),
                profilePicture: String(
                    user.profile_picture || ""
                )
            },
            restaurant: {
                restaurantId: String(restaurant.id),
                restaurantName:
                    restaurant.restaurant_name_ar || "",
                restaurantLogo: restaurant.logo || "",
                phone: restaurant.phone_number || "",
                address: restaurant.address_ar || ""
            },
            items,
            delivery: {
                type: delivery.type || "home",
                deliveryId: null,
                deliveryPerson: null,
                address: {
                    fullText: String(
                        deliveryAddress.fullText || ""
                    ),
                    manualAddress: String(
                        deliveryAddress.manualAddress || ""
                    ),
                    details: String(
                        deliveryAddress.details || ""
                    ),
                    area: String(
                        deliveryAddress.area || ""
                    ),
                    apartment: String(
                        deliveryAddress.apartment || ""
                    ),
                    floor: String(
                        deliveryAddress.floor || ""
                    ),
                    latitude:
                        deliveryAddress.latitude ?? null,
                    longitude:
                        deliveryAddress.longitude ?? null
                },
                instructions: Array.isArray(
                    delivery.instructions
                )
                    ? delivery.instructions
                    : [],
                additionalInstructions: String(
                    delivery.additionalInstructions || ""
                )
            },
            payment: {
                method: String(payment.method),
                status: isCashPayment
                    ? "unpaid"
                    : "pending"
            },
            pricing: {
                currency,
                subtotal,
                deliveryFee,
                originalDeliveryFee,
                freeDeliveryDiscount:
                    couponResult.deliveryDiscount,
                vat,
                processingFee,
                tip,
                discount,
                couponCode:
                    couponResult.coupon?.code || null,
                couponName:
                    couponResult.coupon?.name || null,
                total
            },
            settlement: {
                restaurantSettled: false,
                restaurantSettledAt: null,
                salesCommissionRate,
                salesCommissionAmount,
                restaurantProductsNet,
                deliveryCommissionRate,
                deliveryCommissionAmount,
                restaurantDeliveryNet,
                appDeliveryCommission:
                    deliveryCommissionAmount,
                appTotalEarnings,
                restaurantTotalDue,
                deliveryCollectedCash:
                    isCashPayment ? total : 0,
                deliveryNetEarnings: 0,
                deliveryCashToRestaurant:
                    isCashPayment ? restaurantTotalDue : 0,
                deliveryCashToApp:
                    isCashPayment ? appTotalEarnings : 0,
                deliveryCashToCollect: isCashPayment
                    ? roundMoney(
                        restaurantTotalDue +
                        appTotalEarnings
                    )
                    : 0,
                cashReconciliationDifference:
                    isCashPayment
                        ? roundMoney(
                            total -
                            restaurantTotalDue -
                            appTotalEarnings
                        )
                        : 0
            }
        };

        const existingOrders = parseArray(
            restaurant.orders
        );

        const updatedOrders = [
            ...existingOrders,
            order
        ];

        const updateResult = await dbRun(
            restaurantsDb,
            `UPDATE restaurants
             SET orders = ?,
                 orders_count = COALESCE(orders_count, 0) + 1,
                 updated_at = ?
             WHERE id = ?`,
            [
                JSON.stringify(updatedOrders),
                now,
                restaurantId
            ]
        );

        if (updateResult.changes !== 1) {
            return res.status(500).json({
                success: false,
                message: "تعذر حفظ الطلب"
            });
        }

        savedOrder = order;
        savedRestaurantId = restaurantId;

        if (couponResult.coupon) {
            const coupon = couponResult.coupon;
            const usageId = crypto.randomUUID();

            savedCouponUsageId = usageId;
            savedCouponId = coupon.id;

            await dbRun(
                discountCodesDb,
                `INSERT INTO discount_code_usages (
                    id,
                    discount_code_id,
                    user_id,
                    order_id,
                    discount_amount,
                    order_amount,
                    status,
                    used_at,
                    updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, 'applied', ?, ?)`,
                [
                    usageId,
                    coupon.id,
                    String(user.id),
                    order.id,
                    discount,
                    total,
                    now,
                    now
                ]
            );

            const usageUpdate = await dbRun(
                discountCodesDb,
                `UPDATE discount_codes
                 SET usage_count = COALESCE(usage_count, 0) + 1,
                     updated_at = ?
                 WHERE id = ?
                   AND is_active = 1
                   AND (
                       usage_limit IS NULL
                       OR usage_count < usage_limit
                   )`,
                [now, coupon.id]
            );

            if (usageUpdate.changes !== 1) {
                throw new Error(
                    "تعذر تسجيل استخدام كود الخصم"
                );
            }

            couponCountIncremented = true;
        }

        return res.status(201).json({
            success: true,
            message: "تم إرسال الطلب بنجاح",
            order
        });
    } catch (err) {
        console.error(
            "Send Order Error:",
            err.stack || err
        );

        if (savedOrder && savedRestaurantId !== null) {
            try {
                const restaurant = await dbGet(
                    restaurantsDb,
                    "SELECT orders FROM restaurants WHERE id = ?",
                    [savedRestaurantId]
                );

                if (restaurant) {
                    const currentOrders = parseArray(
                        restaurant.orders
                    );

                    const filteredOrders =
                        currentOrders.filter(
                            order =>
                                String(order.id) !==
                                String(savedOrder.id)
                        );

                    await dbRun(
                        restaurantsDb,
                        `UPDATE restaurants
                         SET orders = ?,
                             orders_count = CASE
                                 WHEN COALESCE(orders_count, 0) > 0
                                 THEN orders_count - 1
                                 ELSE 0
                             END,
                             updated_at = ?
                         WHERE id = ?`,
                        [
                            JSON.stringify(filteredOrders),
                            new Date().toISOString(),
                            savedRestaurantId
                        ]
                    );
                }
            } catch (rollbackError) {
                console.error(
                    "Order rollback error:",
                    rollbackError.stack || rollbackError
                );
            }
        }

        if (savedCouponUsageId) {
            try {
                await dbRun(
                    discountCodesDb,
                    "DELETE FROM discount_code_usages WHERE id = ?",
                    [savedCouponUsageId]
                );
            } catch (rollbackError) {
                console.error(
                    "Coupon usage rollback error:",
                    rollbackError.stack || rollbackError
                );
            }
        }

        if (couponCountIncremented && savedCouponId) {
            try {
                await dbRun(
                    discountCodesDb,
                    `UPDATE discount_codes
                     SET usage_count = CASE
                         WHEN COALESCE(usage_count, 0) > 0
                         THEN usage_count - 1
                         ELSE 0
                     END,
                     updated_at = ?
                     WHERE id = ?`,
                    [
                        new Date().toISOString(),
                        savedCouponId
                    ]
                );
            } catch (rollbackError) {
                console.error(
                    "Coupon count rollback error:",
                    rollbackError.stack || rollbackError
                );
            }
        }

        return res.status(err.status || 500).json({
            success: false,
            message: err.status
                ? err.message
                : "حدث خطأ أثناء إرسال الطلب"
        });
    }
});

module.exports = router;