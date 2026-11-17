
const express = require("express");
const router = express.Router();
const { db } = require("../../mydb/restaurants");

router.get("/:id", (req, res) => {
    const { id } = req.params;

    db.get(
        "SELECT * FROM restaurants WHERE id = ?",
        [id],
        (err, restaurant) => {
            if (err) {
                console.error("Restaurant DB Error:", err);

                return res.status(500).json({
                    success: false,
                    message: "حدث خطأ في قاعدة البيانات"
                });
            }

            if (!restaurant) {
                return res.status(404).json({
                    success: false,
                    message: "المطعم غير موجود"
                });
            }

            res.json({
                success: true,
                restaurant
            });
        }
    );
});

module.exports = router;