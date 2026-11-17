const express = require("express");
const cors = require("cors");
const path = require("path");

const app = express();
const PORT = 5001;

require("./mydb/users");

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.set("trust proxy", 1);

app.get("/", (req, res) => {
    res.status(200).send("Server Running");
});
const { db } = require("./mydb/discount_codes");


app.get("/discount-codes", (req, res) => {
    db.all(
        "SELECT * FROM discount_codes ORDER BY created_at DESC",
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "Failed to fetch discount codes"
                });
            }

            res.json({
                success: true,
                count: rows.length,
                codes: rows
            });
        }
    );
});

app.get("/generate-discount-codes", (req, res) => {
    const crypto = require("crypto");

    const types = [
        {
            type: "percentage",
            value: 10,
            name: "خصم 10%",
            description: "خصم بنسبة 10% على الطلب"
        },
        {
            type: "percentage",
            value: 20,
            name: "خصم 20%",
            description: "خصم بنسبة 20% على الطلب"
        },
        {
            type: "fixed",
            value: 25,
            name: "خصم 25 جنيه",
            description: "خصم 25 جنيه من قيمة الطلب"
        },
        {
            type: "fixed",
            value: 50,
            name: "خصم 50 جنيه",
            description: "خصم 50 جنيه من قيمة الطلب"
        },
        {
            type: "free_delivery",
            value: 0,
            name: "توصيل مجاني",
            description: "توصيل مجاني للطلب"
        },
        {
            type: "free_delivery",
            value: 0,
            name: "توصيل مجاني إضافي",
            description: "كود للحصول على توصيل مجاني"
        }
    ];

    const now = new Date().toISOString();
    const codes = types.map(item => ({
        id: crypto.randomUUID(),
        code: `EASY${crypto.randomBytes(5).toString("hex").toUpperCase()}`,
        name: item.name,
        description: item.description,
        discount_type: item.type,
        discount_value: item.value,
        now
    }));

    db.serialize(() => {
        db.run("BEGIN IMMEDIATE TRANSACTION");

        const stmt = db.prepare(`
            INSERT INTO discount_codes (
                id,
                code,
                name,
                description,
                discount_type,
                discount_value,
                currency,
                target_type,
                usage_per_user,
                usage_count,
                is_active,
                first_order_only,
                applicable_to,
                applicable_ids,
                combinable,
                metadata,
                created_at,
                updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 'EGP', 'all', 1, 0, 1, 0, 'all', '[]', 0, '{}', ?, ?)
        `);

        let completed = 0;
        let failed = false;
        const createdCodes = [];

        for (const item of codes) {
            stmt.run(
                [
                    item.id,
                    item.code,
                    item.name,
                    item.description,
                    item.discount_type,
                    item.discount_value,
                    item.now,
                    item.now
                ],
                function (err) {
                    if (failed) return;

                    if (err) {
                        failed = true;
                        stmt.finalize(() => {
                            db.run("ROLLBACK", () => {
                                res.status(500).json({
                                    success: false,
                                    message: "فشل إنشاء أكواد الخصم",
                                    error: err.message
                                });
                            });
                        });
                        return;
                    }

                    createdCodes.push({
                        id: item.id,
                        code: item.code,
                        name: item.name,
                        discount_type: item.discount_type,
                        discount_value: item.discount_value
                    });

                    completed++;

                    if (completed === codes.length) {
                        stmt.finalize(finalizeErr => {
                            if (finalizeErr) {
                                db.run("ROLLBACK", () => {
                                    res.status(500).json({
                                        success: false,
                                        message: "فشل إتمام إنشاء الأكواد"
                                    });
                                });
                                return;
                            }

                            db.run("COMMIT", commitErr => {
                                if (commitErr) {
                                    db.run("ROLLBACK", () => {
                                        res.status(500).json({
                                            success: false,
                                            message: "فشل حفظ الأكواد"
                                        });
                                    });
                                    return;
                                }

                                res.json({
                                    success: true,
                                    count: createdCodes.length,
                                    codes: createdCodes
                                });
                            });
                        });
                    }
                }
            );
        }
    });
});
const routes = ["auth","myorders","order","resturants/auth","delivery/profile","delivery/auth","delivery/action","resturants/resturants","resturants/categories","resturants/zones","resturants/resturant","resturants/action","resturants/hours","banners/create","admin/resturants","admin/orders","admin/users","admin/drivers"];

routes.forEach((route) => {
    app.use(`/api/${route}`, require(`./routes/${route}`));
});

app.use((req, res) => {
    res.status(404).json({
        success: false,
        message: "المسار غير موجود"
    });
});

app.use((err, req, res, next) => {
    console.error("Server Error:", err);

    res.status(500).json({
        success: false,
        message: "حدث خطأ في السيرفر"
    });
});

app.listen(PORT, "0.0.0.0", () => {
    console.log("Server started!");
    console.log("Port:", PORT);
    console.log("Server IP: http://68.168.30.100:" + PORT);
});