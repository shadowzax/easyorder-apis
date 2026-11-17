const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

const router = express.Router();
const { db } = require("../../mydb/banners");

const uploadDir = path.join(__dirname, "..","..", "public", "uploads", "banners");

if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, uploadDir);
    },

    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const name = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}${ext}`;

        cb(null, name);
    }
});

const upload = multer({
    storage,

    limits: {
        fileSize: 10 * 1024 * 1024
    },

    fileFilter: (req, file, cb) => {
        const allowed = [
            "image/jpeg",
            "image/jpg",
            "image/png",
            "image/webp",
            "image/gif"
        ];

        if (!allowed.includes(file.mimetype)) {
            return cb(new Error("نوع الصورة غير مدعوم"));
        }

        cb(null, true);
    }
});


const bannerTypes = {
    hero: "hero_banners",
    carousel: "carousel_banners",
    middle: "middle_banners",
    general: "general_banners",
    delivery: "delivery_banners"
};


const getColumn = type => {
    return bannerTypes[String(type).toLowerCase()];
};


const parseBanners = value => {
    if (!value) return [];

    try {
        const result = JSON.parse(value);
        return Array.isArray(result) ? result : [];
    } catch {
        return [];
    }
};


/*
|--------------------------------------------------------------------------
| GET ALL BANNERS
|--------------------------------------------------------------------------
*/

router.get("/", (req, res) => {
    db.get(
        "SELECT * FROM banners WHERE id = 1 LIMIT 1",
        [],
        (err, row) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            if (!row) {
                return res.status(404).json({
                    success: false,
                    message: "قاعدة البانرات غير موجودة"
                });
            }

            res.json({
                success: true,

                banners: {
                    hero: parseBanners(row.hero_banners),
                    carousel: parseBanners(row.carousel_banners),
                    middle: parseBanners(row.middle_banners),
                    general: parseBanners(row.general_banners),
                    delivery: parseBanners(row.delivery_banners)
                }
            });
        }
    );
});


/*
|--------------------------------------------------------------------------
| GET BANNERS BY TYPE
|--------------------------------------------------------------------------
*/

router.get("/:type", (req, res) => {
    const column = getColumn(req.params.type);

    if (!column) {
        return res.status(400).json({
            success: false,
            message: "نوع البانر غير صالح"
        });
    }

    db.get(
        `SELECT ${column} FROM banners WHERE id = 1 LIMIT 1`,
        [],
        (err, row) => {
            if (err) {
                console.error(err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            res.json({
                success: true,
                type: req.params.type,
                banners: parseBanners(row?.[column])
            });
        }
    );
});


/*
|--------------------------------------------------------------------------
| CREATE + UPLOAD BANNER
|--------------------------------------------------------------------------
*/

router.post(
    "/:type",
    upload.single("banner"),
    (req, res) => {
        const column = getColumn(req.params.type);

        if (!column) {
            if (req.file) {
                fs.unlinkSync(req.file.path);
            }

            return res.status(400).json({
                success: false,
                message: "نوع البانر غير صالح"
            });
        }

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "صورة البانر مطلوبة"
            });
        }

        const banner = {
            id: crypto.randomUUID(),

            image: `/uploads/banners/${req.file.filename}`,

            title: req.body.title || "",
            description: req.body.description || "",

            link: req.body.link || "",

            active:
                req.body.active === undefined
                    ? true
                    : (
                        req.body.active === true ||
                        req.body.active === "true" ||
                        req.body.active === "1"
                    ),

            created_at: new Date().toISOString()
        };

        db.get(
            `SELECT ${column} FROM banners WHERE id = 1 LIMIT 1`,
            [],
            (err, row) => {
                if (err) {
                    console.error(err);

                    fs.unlink(req.file.path, () => {});

                    return res.status(500).json({
                        success: false,
                        message: "حدث خطأ في قاعدة البيانات"
                    });
                }

                const banners = parseBanners(row?.[column]);

                banners.push(banner);

                db.run(
                    `
                    UPDATE banners
                    SET ${column} = ?,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = 1
                    `,
                    [JSON.stringify(banners)],
                    function (updateErr) {
                        if (updateErr) {
                            console.error(updateErr);

                            fs.unlink(req.file.path, () => {});

                            return res.status(500).json({
                                success: false,
                                message: "حدث خطأ أثناء حفظ البانر"
                            });
                        }

                        res.status(201).json({
                            success: true,
                            message: "تم إنشاء البانر ورفعه بنجاح",
                            type: req.params.type,
                            banner
                        });
                    }
                );
            }
        );
    }
);


/*
|--------------------------------------------------------------------------
| DELETE BANNER
|--------------------------------------------------------------------------
*/

router.delete("/:type/:id", (req, res) => {
    const column = getColumn(req.params.type);

    if (!column) {
        return res.status(400).json({
            success: false,
            message: "نوع البانر غير صالح"
        });
    }

    db.get(
        `SELECT ${column} FROM banners WHERE id = 1 LIMIT 1`,
        [],
        (err, row) => {
            if (err) {
                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            const banners = parseBanners(row?.[column]);

            const banner = banners.find(
                item => String(item.id) === String(req.params.id)
            );

            if (!banner) {
                return res.status(404).json({
                    success: false,
                    message: "البانر غير موجود"
                });
            }

            const updatedBanners = banners.filter(
                item => String(item.id) !== String(req.params.id)
            );

            db.run(
                `
                UPDATE banners
                SET ${column} = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = 1
                `,
                [JSON.stringify(updatedBanners)],
                err => {
                    if (err) {
                        return res.status(500).json({
                            success: false,
                            message: "حدث خطأ أثناء حذف البانر"
                        });
                    }

                    if (banner.image) {
                        const imagePath = path.join(
                            __dirname,
                            "..",
                            "public",
                            banner.image.replace(/^\/+/, "")
                        );

                        fs.unlink(imagePath, () => {});
                    }

                    res.json({
                        success: true,
                        message: "تم حذف البانر بنجاح"
                    });
                }
            );
        }
    );
});


/*
|--------------------------------------------------------------------------
| MULTER ERRORS
|--------------------------------------------------------------------------
*/

router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    if (err) {
        return res.status(400).json({
            success: false,
            message: err.message
        });
    }

    next();
});


module.exports = router;